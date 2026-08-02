package main

// ============ 后端音频播放器  ============
//
// 设计目标：
//   1. 音频解码与输出全部在 Go 进程内完成，前端只负责控制
//   2. Go 后端是播放状态的唯一可信源，通过 Wails Events 向前端推送：
//        player:trackloaded {track, duration}   曲目加载完成
//        player:state        {isPlaying, position, duration}   播放/暂停/加载/停止
//        player:timeupdate   {position, duration}   ~4Hz 周期推送位置
//        player:ended        {trackId}             单曲结束（非单曲循环时）
//        player:modechange   {mode}                播放模式变更
//        player:error        {message, trackId}    解码/播放错误
//   3. 支持格式：mp3 / wav / flac
//      ogg / ape 暂不支持后端播放，LoadTrack 返回明确错误
//   4. 单曲循环由后端处理（无缝重播）；顺序/随机模式由前端在 player:ended 后选下一首
//   5. 音量（synth 模式）由 beep effects.Volume 直接控制 Go 进程输出
//
// 线程模型：
//   - Wails 方法处理 goroutine、timeupdate ticker、ended 回调 goroutine 均会访问 Player
//   - p.mu 保护 Player 状态字段；访问 decoded 的 Position/Seek/Close 需额外 speaker.Lock()
//   - 锁顺序恒为 p.mu → speaker.Lock()，ended 回调通过 `go` 异步处理避免在 speaker 锁内回调

import (
	"context"
	"fmt"
	"log"
	"math"
	"os"
	"strconv"
	"sync"
	"time"

	"MusicLite/internal/format"
	"MusicLite/internal/storage"

	"github.com/gopxl/beep"
	"github.com/gopxl/beep/effects"
	"github.com/gopxl/beep/flac"
	"github.com/gopxl/beep/mp3"
	"github.com/gopxl/beep/speaker"
	"github.com/gopxl/beep/wav"
	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// playerSampleRate 后端输出统一重采样的采样率
const playerSampleRate beep.SampleRate = 44100

// playerTimeUpdateInterval 周期推送播放位置给前端的间隔
const playerTimeUpdateInterval = 250 * time.Millisecond

// PlayerState 暴露给前端的播放器快照
type PlayerState struct {
	Track     *format.MscData `json:"track"`     // 当前曲目（nil 表示无曲目）
	IsPlaying bool            `json:"isPlaying"` // 是否正在播放
	Position  float64         `json:"position"`  // 当前位置（秒）
	Duration  float64         `json:"duration"`  // 总时长（秒）
	Volume    int             `json:"volume"`    // 音量 0-100
	PlayMode  string          `json:"playMode"`  // 播放模式 none | loopOne | random
}

// Player 后端音频播放器
type Player struct {
	mu     sync.Mutex
	ctx    context.Context
	db     *storage.Database
	app    *App
	ready  bool // speaker 是否初始化成功
	closed chan struct{}

	track    *format.MscData       // 当前曲目元数据
	decoded  beep.StreamSeekCloser // 解码器（可 Seek）
	srcFmt   beep.Format           // 原始格式（用于采样换算）
	ctrl     *beep.Ctrl            // 暂停/恢复
	eq       *Equalizer            // 10 频段均衡器（管线中的 DSP 节点）
	vol      *effects.Volume       // 音量
	paused   bool                  // 是否处于暂停态
	volume   int                   // 0-100
	playMode string                // none | loopOne | random
	queue    *PlayQueue             // 播放队列（非空时优先驱动进曲）
}

// NewPlayer 创建播放器实例（不初始化设备，等 startup 拿到 ctx 后调用 Start）
func NewPlayer(db *storage.Database, app *App) *Player {
	p := &Player{
		db:       db,
		app:      app,
		volume:   70,
		playMode: "none",
		closed:   make(chan struct{}),
	}
	p.queue = NewPlayQueue(db, app)
	return p
}

// Queue 返回播放队列实例（供 App 绑定方法调用）
func (p *Player) Queue() *PlayQueue {
	return p.queue
}

// Equalizer 返回均衡器实例（供 App 绑定方法调用）
func (p *Player) Equalizer() *Equalizer {
	return p.eq
}

// Start 初始化音频设备并启动 timeupdate 推送循环（在 app.startup 中调用）
func (p *Player) Start(ctx context.Context) {
	p.ctx = ctx
	// 初始化 speaker：固定 44100Hz，缓冲 1/10 秒
	if err := speaker.Init(playerSampleRate, playerSampleRate.N(time.Second/10)); err != nil {
		log.Printf("[Player] speaker.Init 失败: %v（后端播放不可用）", err)
		p.ready = false
	} else {
		p.ready = true
		log.Printf("[Player] speaker 已初始化 @ %dHz", playerSampleRate)
	}
	go p.timeUpdateLoop()
}

// Stop 关闭播放器（在 app.shutdown 中调用）
func (p *Player) Stop() {
	close(p.closed)
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.decoded != nil {
		p.decoded.Close()
		p.decoded = nil
	}
	if p.ready {
		speaker.Clear()
	}
}

// ============ 对前端暴露的 App 方法（绑定到 Wails） ============

// PlayerLoad 加载并准备播放一首曲目（加载后处于暂停态，需调用 PlayerPlay 开始）
func (a *App) PlayerLoad(track format.MscData) error {
	return a.player.loadTrack(track)
}

// PlayerPlay 恢复播放
func (a *App) PlayerPlay() {
	a.player.resume()
}

// PlayerPause 暂停播放
func (a *App) PlayerPause() {
	a.player.pause()
}

// PlayerToggle 切换播放/暂停
func (a *App) PlayerToggle() {
	a.player.toggle()
}

// PlayerSeek 跳转到指定秒数
func (a *App) PlayerSeek(seconds float64) error {
	return a.player.seek(seconds)
}

// PlayerStop 停止并清空当前曲目
func (a *App) PlayerStop() {
	a.player.stop()
}

// PlayerGetState 返回当前播放器状态快照
func (a *App) PlayerGetState() PlayerState {
	return a.player.snapshot()
}

// PlayerTogglePlayMode 切换播放模式并返回新模式
func (a *App) PlayerTogglePlayMode() string {
	return a.player.togglePlayMode()
}

// PlayerGetPlayMode 返回当前播放模式
func (a *App) PlayerGetPlayMode() string {
	p := a.player
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.playMode
}

// PlayerRestart 从头重新播放当前曲目（前端在 loopOne 之外需要时可用）
func (a *App) PlayerRestart() error {
	return a.player.restart()
}

// ============ 均衡器绑定方法 ============

// EqBandCount 常量前端不可见，前端通过 PlayerGetEqBandCount 获取
// PlayerGetEqBandCount 返回频段数量
func (a *App) PlayerGetEqBandCount() int {
	return EqBandCount
}

// PlayerGetEqFreqs 返回各频段中心频率（Hz）
func (a *App) PlayerGetEqFreqs() []float64 {
	freqs := make([]float64, EqBandCount)
	copy(freqs, EqCenterFreqs[:])
	return freqs
}

// PlayerSetEqBand 设置某频段增益（dB，-12~+12）
func (a *App) PlayerSetEqBand(index int, gainDB float64) {
	eq := a.player.Equalizer()
	if eq != nil {
		eq.SetBand(index, gainDB)
	}
}

// PlayerSetEqGains 一次性设置全部频段增益（长度须等于频段数）
func (a *App) PlayerSetEqGains(gains []float64) {
	eq := a.player.Equalizer()
	if eq != nil {
		eq.SetGains(gains)
	}
}

// PlayerGetEqGains 返回当前各频段增益（dB）
func (a *App) PlayerGetEqGains() []float64 {
	eq := a.player.Equalizer()
	if eq == nil {
		return make([]float64, EqBandCount)
	}
	g := eq.GetGains()
	out := make([]float64, EqBandCount)
	copy(out, g[:])
	return out
}

// PlayerSetEqEnabled 启用/旁路均衡器
func (a *App) PlayerSetEqEnabled(on bool) {
	eq := a.player.Equalizer()
	if eq != nil {
		eq.SetEnabled(on)
	}
}

// PlayerGetEqEnabled 返回均衡器启用状态
func (a *App) PlayerGetEqEnabled() bool {
	eq := a.player.Equalizer()
	if eq == nil {
		return false
	}
	return eq.IsEnabled()
}

// PlayerResetEq 重置全部频段为 0 dB（不平路状态，仍保持启用/旁路）
func (a *App) PlayerResetEq() {
	eq := a.player.Equalizer()
	if eq != nil {
		eq.SetGains(make([]float64, EqBandCount))
	}
}

// ============ 播放队列绑定方法 ============

// QueueAddTrack 按曲目 ID 加入队列尾部，返回加入的项（失败返回空项）
func (a *App) QueueAddTrack(id int64) QueueItem {
	item, _ := a.player.queue.AddTrack(id)
	return item
}

// QueueAddAll 批量加入队列
func (a *App) QueueAddAll(ids []int64) int {
	return a.player.queue.AddAll(ids)
}

// QueueAddAllFromLibrary 把整个音乐库加入队列（"播放全部"用）
func (a *App) QueueAddAllFromLibrary() int {
	return a.player.queue.AddAllFromLibrary()
}

// QueueRemoveAt 删除指定下标的队列项
func (a *App) QueueRemoveAt(index int) bool {
	return a.player.queue.RemoveAt(index)
}

// QueueClear 清空队列
func (a *App) QueueClear() {
	a.player.queue.Clear()
}

// QueueShuffle 洗牌（保留当前播放项位置）
func (a *App) QueueShuffle() {
	a.player.queue.Shuffle()
}

// QueueMove 拖拽排序：from → to
func (a *App) QueueMove(from, to int) bool {
	return a.player.queue.Move(from, to)
}

// QueueJumpTo 跳转到指定下标并播放该项
func (a *App) QueueJumpTo(index int) error {
	if item, ok := a.player.queue.JumpTo(index); ok {
		// 同曲不重载：若点击的正是当前播放的曲目，仅恢复播放，避免重复解码导致撕裂/加速
		a.player.mu.Lock()
		curTrack := a.player.track
		isSame := curTrack != nil && curTrack.ID == item.Track.ID
		a.player.mu.Unlock()
		if isSame {
			a.player.resume()
			return nil
		}
		if err := a.player.loadTrack(item.Track); err != nil {
			return err
		}
		a.player.resume()
		return nil
	}
	return fmt.Errorf("队列下标越界")
}

// QueueGetStatus 返回队列快照
func (a *App) QueueGetStatus() QueueStatus {
	return a.player.queue.Status()
}

// QueueGetNext 取下一项（不前进指针），用于前端手动"下一首"决策；无则返回空项
func (a *App) QueueGetNext() QueueItem {
	item, _ := a.player.queue.GetNext(true)
	return item
}

// QueueGetPrev 取上一项；无则返回空项
func (a *App) QueueGetPrev() QueueItem {
	item, _ := a.player.queue.GetPrev(true)
	return item
}

// SetApplicationVolume 设置应用音量（synth 模式：控制 Windows 音量合成器中本进程的音量）
// 播放迁移到 Go 后端后，音频由 Go 进程直接输出，音量合成器里的会话 PID 就是本进程自身，
// 因此用 os.Getpid() 匹配音频会话即可命中。同时同步更新后端 Player 的 beep 增益，
// 让两者保持一致（合成器滑块是主控，beep 增益作为应用内二次校准）。
func (a *App) SetApplicationVolume(vol int) error {
	// 钳制范围
	if vol < 0 {
		vol = 0
	}
	if vol > 100 {
		vol = 100
	}
	// 1. 主控：Windows 音量合成器本进程会话音量（PID = 自身）
	if err := setAppVolumeByPid(os.Getpid(), vol); err != nil {
		log.Printf("[Volume] SetApplicationVolume 合成器设置失败: %v", err)
		return fmt.Errorf("设置合成器音量失败: %w", err)
	}
	// 2. 同步：后端 Player 的 beep 增益（保持应用内音量与合成器一致）
	a.player.SetVolume(vol)
	log.Printf("[Volume] SetApplicationVolume(%d) OK", vol)
	return nil
}

// GetApplicationVolume 获取应用音量（synth 模式：读取 Windows 音量合成器中本进程的音量）
func (a *App) GetApplicationVolume() (int, error) {
	vol, err := getAppVolumeByPid(os.Getpid())
	if err != nil {
		log.Printf("[Volume] GetApplicationVolume 合成器读取失败: %v，回退到 Player 缓存值", err)
		// 合成器读取失败（例如尚未播放，音频会话未建立）时回退到 Player 缓存值
		return a.player.GetVolume(), nil
	}
	log.Printf("[Volume] GetApplicationVolume vol=%d", vol)
	return vol, nil
}

// ============ Player 内部实现 ============

// loadTrack 解码并加载曲目，构建播放管线（加载后处于暂停态）
func (p *Player) loadTrack(track format.MscData) error {
	if !p.ready {
		return fmt.Errorf("音频设备未初始化，后端播放不可用")
	}
	if track.ID <= 0 {
		return fmt.Errorf("无效的曲目 ID")
	}

	filePath, err := p.db.GetTrackFilePath(strconv.FormatInt(track.ID, 10))
	if err != nil {
		return fmt.Errorf("获取曲目文件路径失败: %w", err)
	}
	if _, err := os.Stat(filePath); err != nil {
		return fmt.Errorf("曲目文件不存在: %w", err)
	}

	// 停止旧管线
	p.stopPipeline()

	f, err := os.Open(filePath)
	if err != nil {
		return fmt.Errorf("打开音频文件失败: %w", err)
	}

	decoded, format, err := p.decode(track.Format, f)
	if err != nil {
		f.Close()
		return err
	}

	p.mu.Lock()
	p.decoded = decoded
	p.srcFmt = format
	p.track = &track
	p.paused = true
	p.mu.Unlock()

	// 构建管线：decoded -> resample -> equalizer -> ctrl(paused) -> volume -> speaker
	p.rebuildPipeline(true)

	// 同步队列：确保当前播放的曲目在队列中（不在则自动加入），并标记为当前项
	if p.queue != nil {
		p.queue.EnsureCurrent(track.ID)
	}

	// 推送加载完成 + 暂停态
	p.emitTrackLoaded()
	p.emitState()
	return nil
}

// decode 根据格式选择解码器
func (p *Player) decode(fmtStr format.NormalMscFormat, f *os.File) (beep.StreamSeekCloser, beep.Format, error) {
	switch fmtStr {
	case format.Mp3:
		return mp3.Decode(f)
	case format.Wav:
		return wav.Decode(f)
	case format.Flac:
		return flac.Decode(f)
	default:
		f.Close()
		return nil, beep.Format{}, fmt.Errorf("后端播放暂不支持 %s 格式（仅支持 mp3/wav/flac）", fmtStr)
	}
}

// rebuildPipeline 重建播放管线并提交到 speaker（startPaused 控制初始暂停态）
// 管线：decoded → resample → equalizer → ctrl(paused) → volume → speaker
// 调用前需确保 p.decoded 已设置；调用者持有或未持有 p.mu 均可（内部不取锁）
func (p *Player) rebuildPipeline(startPaused bool) {
	p.mu.Lock()
	if p.decoded == nil {
		p.mu.Unlock()
		return
	}
	decoded := p.decoded
	srcFmt := p.srcFmt
	vol := p.volume
	paused := startPaused
	p.mu.Unlock()

	resampled := beep.Resample(4, srcFmt.SampleRate, playerSampleRate, decoded)
	// 均衡器插入在 resample 之后、ctrl 之前：EQ 在最终输出采样率上工作
	// 复用同一个 EQ 实例（保留用户设置的增益），仅重新指向上游 streamer
	p.mu.Lock()
	eq := p.eq
	p.mu.Unlock()
	if eq == nil {
		eq = NewEqualizer(resampled, playerSampleRate)
	} else {
		eq.SetSource(resampled)
		eq.Reset() // 切歌时清空滤波器状态，避免上一首的瞬态残留
	}
	ctrl := &beep.Ctrl{Streamer: eq, Paused: paused}
	volEff := &effects.Volume{
		Streamer: ctrl,
		Base:     2,
		Volume:   volumeToGain(vol),
		Silent:   vol <= 0,
	}

	p.mu.Lock()
	p.ctrl = ctrl
	p.eq = eq
	p.vol = volEff
	p.paused = paused
	p.mu.Unlock()

	// 提交到 speaker，结束后回调 handleEnded
	speaker.Play(beep.Seq(volEff, beep.Callback(func() {
		go p.handleEnded()
	})))
}

// stopPipeline 停止并清理当前播放管线（不清理 track 元数据）
func (p *Player) stopPipeline() {
	p.mu.Lock()
	decoded := p.decoded
	ctrl := p.ctrl
	p.mu.Unlock()

	if ctrl != nil && p.ready {
		speaker.Lock()
		ctrl.Paused = true
		speaker.Unlock()
	}
	if p.ready {
		speaker.Clear()
	}
	if decoded != nil {
		decoded.Close()
	}

	p.mu.Lock()
	p.decoded = nil
	p.ctrl = nil
	p.vol = nil
	p.paused = true
	p.mu.Unlock()
}

// resume 恢复播放
func (p *Player) resume() {
	if !p.ready {
		return
	}
	p.mu.Lock()
	ctrl := p.ctrl
	track := p.track
	wasPaused := p.paused
	if ctrl == nil {
		p.mu.Unlock()
		return
	}
	speaker.Lock()
	ctrl.Paused = false
	speaker.Unlock()
	p.paused = false
	p.mu.Unlock()

	if wasPaused && track != nil && track.ID > 0 && p.app != nil {
		p.app.RecordPlayStart(track.ID)
	}
	p.emitState()
}

// pause 暂停播放
func (p *Player) pause() {
	if !p.ready {
		return
	}
	p.mu.Lock()
	ctrl := p.ctrl
	track := p.track
	wasPlaying := !p.paused
	if ctrl == nil {
		p.mu.Unlock()
		return
	}
	speaker.Lock()
	ctrl.Paused = true
	speaker.Unlock()
	p.paused = true
	p.mu.Unlock()

	if wasPlaying && track != nil && track.ID > 0 && p.app != nil {
		p.app.RecordPlayPause(track.ID)
	}
	p.emitState()
}

// toggle 切换播放/暂停
func (p *Player) toggle() {
	p.mu.Lock()
	isPaused := p.paused
	p.mu.Unlock()
	if isPaused {
		p.resume()
	} else {
		p.pause()
	}
}

// seek 跳转到指定秒数
func (p *Player) seek(seconds float64) error {
	if !p.ready {
		return fmt.Errorf("音频设备未初始化")
	}
	p.mu.Lock()
	decoded := p.decoded
	srcFmt := p.srcFmt
	eq := p.eq
	if decoded == nil {
		p.mu.Unlock()
		return fmt.Errorf("无曲目加载")
	}
	pos := int(seconds * float64(srcFmt.SampleRate))
	if pos < 0 {
		pos = 0
	}
	speaker.Lock()
	err := decoded.Seek(pos)
	speaker.Unlock()
	p.mu.Unlock()
	if err != nil {
		return fmt.Errorf("跳转失败: %w", err)
	}
	// 跳转后清空 EQ 滤波器状态，避免位置不连续带来的瞬态伪影
	if eq != nil {
		eq.Reset()
	}
	p.emitTimeUpdate()
	return nil
}

// stop 停止并清空当前曲目
func (p *Player) stop() {
	trackID := int64(0)
	p.mu.Lock()
	if p.track != nil {
		trackID = p.track.ID
	}
	wasPlaying := !p.paused
	p.mu.Unlock()

	if wasPlaying && trackID > 0 && p.app != nil {
		p.app.RecordPlayPause(trackID)
	}

	p.stopPipeline()

	p.mu.Lock()
	p.track = nil
	p.mu.Unlock()

	if p.ctx != nil {
		runtime.EventsEmit(p.ctx, "player:state", map[string]any{
			"isPlaying": false,
			"position":  0,
			"duration":  0,
			"trackId":   0,
		})
	}
}

// restart 从头重新播放当前曲目
func (p *Player) restart() error {
	p.mu.Lock()
	if p.decoded == nil {
		p.mu.Unlock()
		return fmt.Errorf("无曲目加载")
	}
	decoded := p.decoded
	track := p.track
	p.mu.Unlock()

	speaker.Lock()
	err := decoded.Seek(0)
	speaker.Unlock()
	if err != nil {
		return fmt.Errorf("重播跳转失败: %w", err)
	}

	// 重建 Seq（旧 Seq 已结束，需要重新提交到 speaker）
	p.rebuildPipeline(false)

	if track != nil && track.ID > 0 && p.app != nil {
		p.app.RecordPlayStart(track.ID)
	}
	p.emitState()
	return nil
}

// togglePlayMode 切换播放模式
func (p *Player) togglePlayMode() string {
	p.mu.Lock()
	modes := []string{"none", "loopOne", "random"}
	idx := 0
	for i, m := range modes {
		if m == p.playMode {
			idx = i
			break
		}
	}
	p.playMode = modes[(idx+1)%len(modes)]
	mode := p.playMode
	p.mu.Unlock()

	if p.ctx != nil {
		runtime.EventsEmit(p.ctx, "player:modechange", mode)
	}
	return mode
}

// handleEnded 曲目自然结束回调（在独立 goroutine 中执行，可安全获取 speaker 锁）
func (p *Player) handleEnded() {
	p.mu.Lock()
	if p.decoded == nil {
		p.mu.Unlock()
		return
	}
	mode := p.playMode
	track := p.track
	p.paused = true
	trackID := int64(0)
	if track != nil {
		trackID = track.ID
	}
	queue := p.queue
	p.mu.Unlock()

	// 单曲循环：从头重播（后端无缝处理，不通知前端 ended）
	if mode == "loopOne" {
		if err := p.restart(); err != nil {
			log.Printf("[Player] 单曲循环重播失败: %v", err)
		}
		return
	}

	// 记录听歌时长
	if trackID > 0 && p.app != nil {
		p.app.RecordPlayPause(trackID)
	}

	// 队列驱动进曲：队列非空时自动推进到下一首（循环队列），
	// 由后端直接加载并播放，前端通过 player:queuenext 同步队列高亮
	if queue != nil && !queue.IsEmpty() {
		if item, ok := queue.AdvanceNext(true); ok {
			if err := p.loadTrack(item.Track); err != nil {
				log.Printf("[Player] 队列下一首加载失败: %v", err)
			} else {
				p.resume()
				if p.ctx != nil {
					status := queue.Status()
					runtime.EventsEmit(p.ctx, "player:queuenext", map[string]any{
						"trackId":    item.Track.ID,
						"queueIndex": status.CurrentIndex,
					})
				}
			}
			return
		}
	}

	// 队列为空：通知前端选下一首（顺序/随机从音乐库选）
	if p.ctx != nil {
		runtime.EventsEmit(p.ctx, "player:ended", trackID)
		runtime.EventsEmit(p.ctx, "player:state", map[string]any{
			"isPlaying": false,
			"position":  p.safePosition(),
			"duration":  p.safeDuration(),
			"trackId":   trackID,
		})
	}
}

// ============ 状态查询 ============

// snapshot 返回当前状态快照
func (p *Player) snapshot() PlayerState {
	p.mu.Lock()
	track := p.track
	isPlaying := !p.paused && p.decoded != nil
	volume := p.volume
	mode := p.playMode
	decoded := p.decoded
	srcFmt := p.srcFmt
	p.mu.Unlock()

	state := PlayerState{
		Track:     track,
		IsPlaying: isPlaying,
		Volume:    volume,
		PlayMode:  mode,
	}
	if decoded != nil {
		speaker.Lock()
		pos := decoded.Position()
		length := decoded.Len()
		speaker.Unlock()
		if srcFmt.SampleRate > 0 {
			state.Position = float64(pos) / float64(srcFmt.SampleRate)
			state.Duration = float64(length) / float64(srcFmt.SampleRate)
		}
	}
	return state
}

func (p *Player) safePosition() float64 {
	p.mu.Lock()
	decoded := p.decoded
	srcFmt := p.srcFmt
	p.mu.Unlock()
	if decoded == nil || srcFmt.SampleRate == 0 {
		return 0
	}
	speaker.Lock()
	pos := decoded.Position()
	speaker.Unlock()
	return float64(pos) / float64(srcFmt.SampleRate)
}

func (p *Player) safeDuration() float64 {
	p.mu.Lock()
	decoded := p.decoded
	srcFmt := p.srcFmt
	p.mu.Unlock()
	if decoded == nil || srcFmt.SampleRate == 0 {
		return 0
	}
	speaker.Lock()
	length := decoded.Len()
	speaker.Unlock()
	return float64(length) / float64(srcFmt.SampleRate)
}

// ============ 事件推送 ============

func (p *Player) emitTrackLoaded() {
	p.mu.Lock()
	track := p.track
	p.mu.Unlock()
	if p.ctx == nil || track == nil {
		return
	}
	runtime.EventsEmit(p.ctx, "player:trackloaded", map[string]any{
		"track":    track,
		"duration": p.safeDuration(),
	})
}

func (p *Player) emitState() {
	if p.ctx == nil {
		return
	}
	p.mu.Lock()
	trackID := int64(0)
	if p.track != nil {
		trackID = p.track.ID
	}
	isPlaying := !p.paused && p.decoded != nil
	p.mu.Unlock()
	runtime.EventsEmit(p.ctx, "player:state", map[string]any{
		"isPlaying": isPlaying,
		"position":  p.safePosition(),
		"duration":  p.safeDuration(),
		"trackId":   trackID,
	})
}

func (p *Player) emitTimeUpdate() {
	if p.ctx == nil {
		return
	}
	p.mu.Lock()
	hasTrack := p.decoded != nil
	p.mu.Unlock()
	if !hasTrack {
		return
	}
	runtime.EventsEmit(p.ctx, "player:timeupdate", map[string]float64{
		"position": p.safePosition(),
		"duration": p.safeDuration(),
	})
}

// timeUpdateLoop 周期推送播放位置
func (p *Player) timeUpdateLoop() {
	ticker := time.NewTicker(playerTimeUpdateInterval)
	defer ticker.Stop()
	for {
		select {
		case <-p.closed:
			return
		case <-ticker.C:
			// 仅在播放中推送，暂停/无曲目时不打扰前端
			p.mu.Lock()
			shouldPush := !p.paused && p.decoded != nil
			p.mu.Unlock()
			if shouldPush {
				p.emitTimeUpdate()
			}
		}
	}
}

// ============ 音量（synth 模式由后端 Player 控制） ============

// SetVolume 设置音量 0-100
func (p *Player) SetVolume(vol int) {
	if vol < 0 {
		vol = 0
	}
	if vol > 100 {
		vol = 100
	}
	p.mu.Lock()
	p.volume = vol
	volEff := p.vol
	p.mu.Unlock()
	if volEff != nil && p.ready {
		speaker.Lock()
		volEff.Volume = volumeToGain(vol)
		volEff.Silent = vol <= 0
		speaker.Unlock()
	}
}

// GetVolume 返回当前音量 0-100
func (p *Player) GetVolume() int {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.volume
}

// SetInitialVolume 启动时从设置同步初始音量
func (p *Player) SetInitialVolume(vol int) {
	p.mu.Lock()
	p.volume = vol
	p.mu.Unlock()
}

// volumeToGain 将 0-100 的百分比转为 effects.Volume 的增益值（Base=2）
// 100% → 0（原样输出），50% → -1（半功率），0% → Silent
func volumeToGain(vol int) float64 {
	if vol <= 0 {
		return 0
	}
	if vol >= 100 {
		return 0
	}
	return math.Log2(float64(vol) / 100.0)
}
