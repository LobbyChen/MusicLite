package app

// ============ 10 频段图形均衡器（biquad peaking filter）============
//
// 设计目标：
//   1. 真正作用于音频流：在新管线（FFmpeg → RAM PCM → PCMReader → oto）
//      中由 PCMReader.Read 调用 ProcessFloat32LE 就地处理缓冲区
//      PCM → EQ → 音量 → oto
//   2. 10 个频段：31 / 62 / 125 / 250 / 500 / 1k / 2k / 4k / 8k / 16k Hz
//      每段增益 -12 ~ +12 dB，Q ≈ 1.41（约 1 octave 带宽）
//   3. 系数按 RBJ Audio EQ Cookbook 公式计算（peaking filter），
//      用 Direct Form II Transposed 结构实现，数值稳定
//   4. 立体声：左右声道各自维护独立的状态变量
//   5. 采样率感知：采样率变化时自动重算系数
//
// 线程模型：
//   - SetBand / SetEnabled / SetGains 可能从前端 goroutine 调用，
//     ProcessFloat32LE 在 oto 音频回调 goroutine 调用，
//     故 gains/enabled/dirty 用 mu 保护
//   - 系数重算与状态共享：Process 单线程消费，SetBand 仅改参数并标记 dirty，
//     下次 Process 调用前在锁内重算系数（避免在热路径做浮点运算）

import (
	"math"
	"sync"
	"unsafe"
)

// EqBandCount 频段数量
const EqBandCount = 10

// EqCenterFreqs 10 频段中心频率（Hz）
var EqCenterFreqs = [EqBandCount]float64{31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000}

// EqMaxGain 单段最大增益（dB），±范围
const EqMaxGain = 12.0

// biquadCoeffs 单个二阶节系数（Direct Form II Transposed）
// y[n] = (b0*x[n] + s1) / a0
// s1   = b1*x[n] - a1*y[n] + s2
// s2   = b2*x[n] - a2*y[n]
type biquadCoeffs struct {
	b0, b1, b2 float64
	a0, a1, a2 float64
}

// biquadState 单通道滤波器状态
type biquadState struct {
	z1, z2 float64
}

// process 单样本滤波（Direct Form II Transposed）
func (c *biquadCoeffs) process(s *biquadState, x float64) float64 {
	y := (c.b0*x + s.z1) / c.a0
	s.z1 = c.b1*x - c.a1*y + s.z2
	s.z2 = c.b2*x - c.a2*y
	return y
}

// peakingCoeffs 按 RBJ Cookbook 计算 peaking filter 系数
// f0: 中心频率, fs: 采样率, gainDB: 增益, Q: 品质因数
func peakingCoeffs(f0, fs, gainDB, Q float64) biquadCoeffs {
	if f0 <= 0 || fs <= 0 {
		// 退化：直通（单位增益）
		return biquadCoeffs{b0: 1, b1: 0, b2: 0, a0: 1, a1: 0, a2: 0}
	}
	// 钳制 f0 到 Nyquist 以内
	nyq := fs / 2
	if f0 >= nyq {
		f0 = nyq * 0.999
	}
	A := math.Pow(10, gainDB/40.0)
	w0 := 2 * math.Pi * f0 / fs
	cosw := math.Cos(w0)
	sinw := math.Sin(w0)
	alpha := sinw / (2 * Q)
	if alpha <= 0 {
		return biquadCoeffs{b0: 1, b1: 0, b2: 0, a0: 1, a1: 0, a2: 0}
	}
	b0 := 1 + alpha*A
	b1 := -2 * cosw
	b2 := 1 - alpha*A
	a0 := 1 + alpha/A
	a1 := -2 * cosw
	a2 := 1 - alpha/A
	// 归一化（让 a0=1，提前除掉，process 时少一次除法）
	return biquadCoeffs{
		b0: b0 / a0,
		b1: b1 / a0,
		b2: b2 / a0,
		a0: 1,
		a1: a1 / a0,
		a2: a2 / a0,
	}
}

// Equalizer 10 频段图形均衡器
type Equalizer struct {
	sampleRate int

	mu      sync.Mutex           // 保护 gains/enabled/dirty
	gains   [EqBandCount]float64 // dB
	enabled bool
	dirty   bool // 参数变化后需要重算系数
	coeffs  [EqBandCount]biquadCoeffs
	// 立体声：每频段每通道一个状态 → [band][channel]state
	states [EqBandCount][2]biquadState
}

// NewEqualizer 创建均衡器，sampleRate 为输出采样率（Hz）
func NewEqualizer(sampleRate int) *Equalizer {
	eq := &Equalizer{
		sampleRate: sampleRate,
		enabled:    false, // 默认旁路
		dirty:      true,
	}
	eq.recomputeCoeffs()
	return eq
}

// recomputeCoeffs 根据当前 gains 与采样率重算所有频段系数（调用者持锁）
func (eq *Equalizer) recomputeCoeffs() {
	fs := float64(eq.sampleRate)
	// 1 octave 带宽 → Q ≈ 1.41；增益为 0 时系数退化为直通
	for i := 0; i < EqBandCount; i++ {
		g := 0.0
		if eq.enabled {
			g = eq.gains[i]
		}
		eq.coeffs[i] = peakingCoeffs(EqCenterFreqs[i], fs, g, 1.41)
	}
	eq.dirty = false
}

// SetBand 设置某频段增益（dB），范围 -EqMaxGain ~ +EqMaxGain
func (eq *Equalizer) SetBand(index int, gainDB float64) {
	if index < 0 || index >= EqBandCount {
		return
	}
	if gainDB < -EqMaxGain {
		gainDB = -EqMaxGain
	}
	if gainDB > EqMaxGain {
		gainDB = EqMaxGain
	}
	eq.mu.Lock()
	eq.gains[index] = gainDB
	eq.dirty = true
	eq.mu.Unlock()
}

// SetGains 一次性设置全部频段增益（dB），len 必须等于 EqBandCount
func (eq *Equalizer) SetGains(gains []float64) {
	eq.mu.Lock()
	defer eq.mu.Unlock()
	for i := 0; i < EqBandCount; i++ {
		g := 0.0
		if i < len(gains) {
			g = gains[i]
		}
		if g < -EqMaxGain {
			g = -EqMaxGain
		}
		if g > EqMaxGain {
			g = EqMaxGain
		}
		eq.gains[i] = g
	}
	eq.dirty = true
}

// SetEnabled 启用/旁路均衡器
func (eq *Equalizer) SetEnabled(on bool) {
	eq.mu.Lock()
	eq.enabled = on
	eq.dirty = true
	eq.mu.Unlock()
}

// IsEnabled 返回启用状态
func (eq *Equalizer) IsEnabled() bool {
	eq.mu.Lock()
	defer eq.mu.Unlock()
	return eq.enabled
}

// GetGains 返回当前各频段增益（dB）
func (eq *Equalizer) GetGains() [EqBandCount]float64 {
	eq.mu.Lock()
	defer eq.mu.Unlock()
	return eq.gains
}

// SetSampleRate 更新采样率（采样率变化时需重算系数）
func (eq *Equalizer) SetSampleRate(sr int) {
	eq.mu.Lock()
	if sr != eq.sampleRate {
		eq.sampleRate = sr
		eq.dirty = true
	}
	eq.mu.Unlock()
}

// Reset 清空滤波器内部状态（切歌时调用，避免残留瞬态）
func (eq *Equalizer) Reset() {
	eq.mu.Lock()
	for i := 0; i < EqBandCount; i++ {
		eq.states[i][0] = biquadState{}
		eq.states[i][1] = biquadState{}
	}
	eq.mu.Unlock()
}

// ProcessFloat32LE 就地处理 Float32LE 交错立体声 PCM 缓冲区。
// 一帧 = 4 字节 L + 4 字节 R = 8 字节；尾部不足一帧的字节保持原样。
// 由 PCMReader.Read 在音频回调线程调用，单线程消费。
func (eq *Equalizer) ProcessFloat32LE(buf []byte) {
	n := len(buf)
	n -= n % 8 // 对齐到完整立体声帧
	if n < 8 {
		return
	}
	buf = buf[:n]

	eq.mu.Lock()
	enabled := eq.enabled
	dirty := eq.dirty
	if dirty {
		eq.recomputeCoeffs()
	}
	// 判断是否所有增益为 0（可跳过计算）
	allZero := !enabled
	if enabled {
		allZero = true
		for i := 0; i < EqBandCount; i++ {
			if eq.gains[i] != 0 {
				allZero = false
				break
			}
		}
	}
	coeffs := eq.coeffs
	states := &eq.states
	eq.mu.Unlock()

	// 旁路或全 0 增益：直通
	if allZero {
		return
	}

	// 将 byte 缓冲区视作 float32 切片（小端交错：L,R,L,R,...）
	f32 := unsafe.Slice((*float32)(unsafe.Pointer(&buf[0])), n/4)
	frames := n / 8
	for i := 0; i < frames; i++ {
		l := float64(f32[i*2])
		r := float64(f32[i*2+1])
		for b := 0; b < EqBandCount; b++ {
			c := &coeffs[b]
			l = c.process(&states[b][0], l)
			r = c.process(&states[b][1], r)
		}
		f32[i*2] = float32(l)
		f32[i*2+1] = float32(r)
	}
}
