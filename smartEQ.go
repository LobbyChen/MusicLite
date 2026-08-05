package main

// ============ 智能均衡器（SmartEQ）=============
//
// 数据流：
//   【主音频信号通路】              【增益参数计算通路】
//         │                              │
//         ▼                              ▼
//   [ 音频流输入 ]                 [ 用户设定音量 ]
//         │                              │
//         ▼                              ▼
//   [ 滑动窗口 FFT ]                   α (补偿强度)
//         │                              │
//         ▼                              ▼
//   [ 频段能量 Ek ]              × (乘法器) ◄── [ Ck: 等响度曲线表 ]
//         │                              ▲
//         ▼                              │
//   [ 时间平滑 Lk ]                     │
//         │                              │
//         ▼                              │
//   [ βk: 内容保护因子 ] ─────────► × (乘法器)
//                                      │
//                                      ▼
//                              Gk = α · Ck · βk
//                              (10 段目标增益向量)
//                                      │
//                ┌─────────────────────┘
//                ▼
//       [ 10 段 EQ 滤波器组 ] ◄── 应用 Gk
//                │
//                ▼
//     [ Preamp + Soft Limiter ]
//       (预放大 + 软限幅保护)
//                │
//                ▼
//          [ 输出音频 ]
//
// 实现：作为 beep.Streamer 串联在管线中
//   resampled → smartEQ → equalizer → ctrl → volume → speaker
// SmartEQ 旁路时直通，启用时做 FFT 分析 + 动态增益 + 软限幅。

import (
	"math"
	"sync"

	rawcalc "MusicLite/internal/calc"

	"github.com/gopxl/beep"
)

// ============ 常量 ============

const (
	smartEQFFTSize        = 2048  // FFT 窗口大小（采样点数）
	smartEQHopSize        = 2048  // FFT 跳跃大小（无重叠，~21 次/秒 @44100Hz）
	smartEQSmoothLambda   = 0.15  // 时间平滑系数 λ：越小越平滑
	smartEQContentGamma   = 3.0   // 内容保护敏感度 γ：越大越保护（提升至 3.0 减少激进补偿）
	smartEQSoftLimitDrive = 1.5   // 软限幅驱动强度
	smartEQMaxGain        = 6.0   // 单段最大增益（dB），自动补偿无需像手动 EQ 那么激进
)

// loudnessCurve 等响度补偿曲线 Ck（简化 ISO 226，40 phon 参考）
// 正值 = 该频段需要提升；负值 = 该频段需要衰减
// 低频和高频在低音量下人耳敏感度低，故需要更多补偿
// 值已缩减为 ISO 226 的 50%，避免过度补偿导致破音
var loudnessCurve = [EqBandCount]float64{
	7,  // 31 Hz
	4,  // 62 Hz
	2,  // 125 Hz
	1,  // 250 Hz
	0,  // 500 Hz
	0,  // 1 kHz（参考点）
	0,  // 2 kHz
	-1, // 4 kHz（人耳最敏感区域）
	1,  // 8 kHz
	4,  // 16 kHz
}

// ============ SmartEQ 结构体 ============

// SmartEQ 智能均衡器（beep.Streamer）
type SmartEQ struct {
	src        beep.Streamer
	sampleRate beep.SampleRate

	mu        sync.Mutex
	enabled   bool    // 启用/旁路
	intensity float64 // 用户可调补偿强度 0-1
	volume    int     // 当前音量 0-100（用于计算 α）

	// FFT 环形缓冲区（复用 buffer.go）
	ringBuf   *Buffer
	fftSize   int
	hopSize   int
	sampleCnt int

	// 频段能量与平滑
	Ek [EqBandCount]float64 // 瞬时频段能量
	Lk [EqBandCount]float64 // 时间平滑能量

	// 目标增益（dB）
	Gk [EqBandCount]float64

	// biquad 滤波器（复用 equalizer.go 的类型）
	coeffs      [EqBandCount]biquadCoeffs
	states      [EqBandCount][2]biquadState
	coeffsDirty bool

	// Preamp（线性增益）
	preampLinear float64

	// Hann 窗（预计算）
	hann []float64

	// 频段边界频率（用于 FFT bin 归类）
	bandLowFreq  [EqBandCount]float64
	bandHighFreq [EqBandCount]float64
}

// ============ 构造与初始化 ============

// NewSmartEQ 创建智能均衡器
func NewSmartEQ(src beep.Streamer, sampleRate beep.SampleRate) *SmartEQ {
	eq := &SmartEQ{
		src:        src,
		sampleRate: sampleRate,
		enabled:    false,
		intensity:  0.7,
		volume:     70,
		fftSize:    smartEQFFTSize,
		hopSize:    smartEQHopSize,
	}

	// 环形缓冲区：freq=fftSize, channelCount=1, windowSec=1 → bufferSize=fftSize
	eq.ringBuf = NewBuffer(uint(smartEQFFTSize), 1, 1)

	// 预计算 Hann 窗
	eq.hann = make([]float64, smartEQFFTSize)
	for i := 0; i < smartEQFFTSize; i++ {
		eq.hann[i] = 0.5 * (1 - math.Cos(2*math.Pi*float64(i)/float64(smartEQFFTSize-1)))
	}

	// 预计算频段边界（±0.5 octave 带宽）
	eq.computeBandBoundaries()
	// 初始化滤波器系数（增益全 0 = 直通）
	eq.recomputeCoeffs()

	return eq
}

// computeBandBoundaries 计算每个频段的频率边界
func (eq *SmartEQ) computeBandBoundaries() {
	for i := 0; i < EqBandCount; i++ {
		center := EqCenterFreqs[i]
		eq.bandLowFreq[i] = center / math.Sqrt(2)
		eq.bandHighFreq[i] = center * math.Sqrt(2)
		if i == 0 {
			eq.bandLowFreq[i] = 0
		}
		if i == EqBandCount-1 {
			eq.bandHighFreq[i] = float64(eq.sampleRate) / 2
		}
	}
}

// ============ 状态控制 ============

// SetSource 重新指向上游 Streamer（切歌时复用同一个 SmartEQ 实例）
func (eq *SmartEQ) SetSource(src beep.Streamer) {
	eq.mu.Lock()
	eq.src = src
	eq.mu.Unlock()
}

// SetEnabled 启用/旁路智能均衡器
func (eq *SmartEQ) SetEnabled(on bool) {
	eq.mu.Lock()
	eq.enabled = on
	eq.coeffsDirty = true
	eq.mu.Unlock()
}

// IsEnabled 返回启用状态
func (eq *SmartEQ) IsEnabled() bool {
	eq.mu.Lock()
	defer eq.mu.Unlock()
	return eq.enabled
}

// SetIntensity 设置补偿强度（0-1）
func (eq *SmartEQ) SetIntensity(v float64) {
	if v < 0 {
		v = 0
	}
	if v > 1 {
		v = 1
	}
	eq.mu.Lock()
	eq.intensity = v
	eq.mu.Unlock()
}

// GetIntensity 返回补偿强度
func (eq *SmartEQ) GetIntensity() float64 {
	eq.mu.Lock()
	defer eq.mu.Unlock()
	return eq.intensity
}

// SetVolume 更新当前音量（影响 α 计算）
func (eq *SmartEQ) SetVolume(vol int) {
	if vol < 0 {
		vol = 0
	}
	if vol > 100 {
		vol = 100
	}
	eq.mu.Lock()
	eq.volume = vol
	eq.mu.Unlock()
}

// SetSampleRate 更新采样率
func (eq *SmartEQ) SetSampleRate(sr beep.SampleRate) {
	eq.mu.Lock()
	if sr != eq.sampleRate {
		eq.sampleRate = sr
		eq.computeBandBoundaries()
		eq.coeffsDirty = true
	}
	eq.mu.Unlock()
}

// Reset 清空滤波器和分析状态（切歌/跳转时调用）
func (eq *SmartEQ) Reset() {
	eq.mu.Lock()
	for i := 0; i < EqBandCount; i++ {
		eq.states[i][0] = biquadState{}
		eq.states[i][1] = biquadState{}
		eq.Ek[i] = 0
		eq.Lk[i] = 0
	}
	eq.sampleCnt = 0
	eq.mu.Unlock()
}

// ============ 增益计算通路 ============

// computeAlpha 根据 volume 和 intensity 计算 α（补偿强度）
// 以音量 50 为中点：低于 50 → α 为正（提升，拉回来）；高于 50 → α 为负（衰减，削掉一点）
// 范围 -intensity ~ +intensity
func (eq *SmartEQ) computeAlpha() float64 {
	volFactor := (50.0 - float64(eq.volume)) / 50.0
	return volFactor * eq.intensity
}

// runFFTAnalysis 执行滑动窗口 FFT 分析并更新目标增益 Gk
// 调用者持锁
func (eq *SmartEQ) runFFTAnalysis() {
	// 1. 从环形缓冲区读取数据
	data := eq.ringBuf.GetChannelData(1)
	if len(data) != smartEQFFTSize {
		return
	}

	// 2. 应用 Hann 窗
	windowed := make([]float64, smartEQFFTSize)
	for i := 0; i < smartEQFFTSize; i++ {
		windowed[i] = data[i] * eq.hann[i]
	}

	// 3. 执行 FFT（调用 internal/calc/fft.go 的 FourierAnalysis）
	spectrum := rawcalc.FourierAnalysis(windowed, float64(eq.sampleRate))

	// 4. 计算各频段能量 Ek
	var maxE float64 = 1e-10
	for i := 0; i < EqBandCount; i++ {
		eq.Ek[i] = 0
	}
	bandCounts := [EqBandCount]int{}

	for freq, amp := range spectrum {
		energy := amp * amp
		for i := 0; i < EqBandCount; i++ {
			if freq >= eq.bandLowFreq[i] && freq < eq.bandHighFreq[i] {
				eq.Ek[i] += energy
				bandCounts[i]++
				break
			}
		}
	}
	// 平均化
	for i := 0; i < EqBandCount; i++ {
		if bandCounts[i] > 0 {
			eq.Ek[i] /= float64(bandCounts[i])
		}
		if eq.Ek[i] > maxE {
			maxE = eq.Ek[i]
		}
	}

	// 5. 时间平滑 Lk = (1-λ)·Lk_prev + λ·Ek
	for i := 0; i < EqBandCount; i++ {
		eq.Lk[i] = (1-smartEQSmoothLambda)*eq.Lk[i] + smartEQSmoothLambda*eq.Ek[i]
	}

	// 6. 计算 α
	alpha := eq.computeAlpha()

	// 7. 计算 Gk = α · Ck · βk
	for i := 0; i < EqBandCount; i++ {
		// 归一化能量 [0, 1]
		lkNorm := eq.Lk[i] / maxE
		if lkNorm > 1 {
			lkNorm = 1
		}

		// 内容保护因子 βk = 1 / (1 + γ · Lk_norm)
		// 能量越高 βk 越小 → 增益绝对值越小（防止过提升/过衰减）
		beta := 1.0 / (1.0 + smartEQContentGamma*lkNorm)

		// Ck: 等响度补偿曲线（dB）
		ck := loudnessCurve[i]

		// Gk = α · Ck · βk (dB)
		// α 正（低音量）：低频高频提升（拉回来）
		// α 负（高音量）：低频高频衰减（削掉一点）
		gk := alpha * ck * beta
		if gk > smartEQMaxGain {
			gk = smartEQMaxGain
		}
		if gk < -smartEQMaxGain {
			gk = -smartEQMaxGain
		}
		eq.Gk[i] = gk
	}

	// 8. Preamp：跟随 α 方向
	// 低音量（α 正）→ Preamp 为正（整体提升）
	// 高音量（α 负）→ Preamp 为负（整体衰减）
	// Soft Limiter 会兜底防止削波
	// 倍率降至 1.5，避免与频段增益叠加后超出软限幅线性区
	preampDB := alpha * 1.5
	eq.preampLinear = math.Pow(10, preampDB/20.0)

	// 9. 重算 biquad 系数
	eq.recomputeCoeffs()
}

// recomputeCoeffs 根据 Gk 重算 biquad 滤波器系数（调用者持锁）
func (eq *SmartEQ) recomputeCoeffs() {
	fs := float64(eq.sampleRate)
	for i := 0; i < EqBandCount; i++ {
		g := 0.0
		if eq.enabled {
			g = eq.Gk[i]
		}
		eq.coeffs[i] = peakingCoeffs(EqCenterFreqs[i], fs, g, 1.41)
	}
	eq.coeffsDirty = false
}

// ============ Stream 实现 ============

// Stream 实现 beep.Streamer
func (eq *SmartEQ) Stream(samples [][2]float64) (int, bool) {
	n, ok := eq.src.Stream(samples)
	if !ok {
		return n, false
	}

	eq.mu.Lock()
	enabled := eq.enabled
	dirty := eq.coeffsDirty
	if dirty {
		eq.recomputeCoeffs()
	}
	coeffs := eq.coeffs
	states := &eq.states
	preamp := eq.preampLinear
	hopSize := eq.hopSize
	eq.mu.Unlock()

	// 旁路：直通
	if !enabled {
		return n, ok
	}

	// 逐样本处理
	for i := 0; i < n; i++ {
		l := samples[i][0]
		r := samples[i][1]

		// 馈入 FFT 环形缓冲区（mono mix）
		mono := (l + r) * 0.5
		eq.ringBuf.WriteData(1, mono)
		eq.sampleCnt++

		// 到达 hop size 时执行 FFT 分析并更新增益
		if eq.sampleCnt >= hopSize {
			eq.sampleCnt = 0
			eq.mu.Lock()
			eq.runFFTAnalysis()
			coeffs = eq.coeffs
			preamp = eq.preampLinear
			eq.mu.Unlock()
		}

		// 应用 10 段 biquad 滤波器组
		for b := 0; b < EqBandCount; b++ {
			c := &coeffs[b]
			l = c.process(&states[b][0], l)
			r = c.process(&states[b][1], r)
		}

		// Preamp
		l *= preamp
		r *= preamp

		// Soft Limiter（tanh 软限幅，防止削波失真）
		l = math.Tanh(l*smartEQSoftLimitDrive) / smartEQSoftLimitDrive
		r = math.Tanh(r*smartEQSoftLimitDrive) / smartEQSoftLimitDrive

		samples[i][0] = l
		samples[i][1] = r
	}

	return n, ok
}

// Err 实现 beep.Streamer
func (eq *SmartEQ) Err() error {
	return eq.src.Err()
}
