package playback

import (
	"errors"
	"log"
	"math"
	"strconv"
	"sync"
	"sync/atomic"
	"time"
	"unsafe"

	"MusicLite/internal/equalizer"
	"MusicLite/internal/metadata"
	"MusicLite/internal/storage"

	"github.com/ebitengine/oto/v3"
)

const (
	playerSampleRate = 44100
	bytesPerFrame    = 8 // Float32 * 2 channels
	seekFlushBytes   = 160 * 1024
	timeUpdatePeriod = 250 * time.Millisecond
)

// EventSink 将播放器事件转发到 Wails 前端。
type EventSink interface {
	EmitEvent(name string, data ...any)
}

// StatsRecorder 记录听歌时长。
type StatsRecorder interface {
	RecordPlayStart(trackID int64)
	RecordPlayPause(trackID int64)
}

// PlayerState 是暴露给前端的播放器快照。
type PlayerState struct {
	Track     *metadata.MscData `json:"track"`
	IsPlaying bool              `json:"isPlaying"`
	Position  float64           `json:"position"`
	Duration  float64           `json:"duration"`
	Volume    int               `json:"volume"`
	PlayMode  string            `json:"playMode"`
}

// Player 是流式音频播放器。
type Player struct {
	mu sync.Mutex

	db    *storage.Database
	sink  EventSink
	stats StatsRecorder

	ready    bool
	closed   chan struct{}
	stopOnce sync.Once

	track *metadata.MscData

	ringPtr atomic.Pointer[streamRing]
	worker  *decodeWorker
	dec     *Decoder
	ring    *streamRing

	durationMicros atomic.Int64
	posBaseMicros  atomic.Int64
	playedBytes    atomic.Int64

	isPlaying atomic.Bool
	isPaused  atomic.Bool
	volume    atomic.Int32
	muteBytes atomic.Int64
	endedSent atomic.Bool

	playMode string
	queue    *Queue
	eq       *equalizer.Equalizer

	otoCtx    *oto.Context
	otoPlayer *oto.Player

	endCh chan struct{}
}

// NewPlayer 创建播放器。queue 与 eq 在内部初始化。
func NewPlayer(db *storage.Database, sink EventSink, urls URLProvider, stats StatsRecorder) *Player {
	p := &Player{
		db:       db,
		sink:     sink,
		stats:    stats,
		playMode: "none",
		closed:   make(chan struct{}),
		endCh:    make(chan struct{}, 1),
		eq:       equalizer.NewEqualizer(playerSampleRate),
	}
	p.queue = NewQueue(db, urls)
	p.volume.Store(70)
	p.isPaused.Store(true)
	return p
}

func (p *Player) Queue() *Queue                   { return p.queue }
func (p *Player) Equalizer() *equalizer.Equalizer { return p.eq }

// Start 初始化 oto 音频上下文与后台循环。
func (p *Player) Start() {
	op := &oto.NewContextOptions{
		SampleRate:   playerSampleRate,
		ChannelCount: 2,
		Format:       oto.FormatFloat32LE,
		BufferSize:   50 * time.Millisecond,
	}
	ctx, ready, err := oto.NewContext(op)
	if err != nil {
		log.Printf("[Player] oto 初始化失败: %v", err)
		return
	}
	<-ready

	p.mu.Lock()
	p.otoCtx = ctx
	p.ready = true
	p.mu.Unlock()

	go p.timeUpdateLoop()
	go p.eventLoop()
}

// Stop 释放播放器与音频设备。
func (p *Player) Stop() {
	p.stopOnce.Do(func() {
		p.isPlaying.Store(false)
		p.isPaused.Store(true)
		p.muteBytes.Store(0)
		p.stopPlayback()
		close(p.closed)
		p.mu.Lock()
		p.otoCtx = nil
		p.mu.Unlock()
	})
}

func (p *Player) stopPlayback() {
	p.mu.Lock()
	otoPlayer := p.otoPlayer
	worker := p.worker
	ring := p.ring
	dec := p.dec
	p.otoPlayer = nil
	p.worker = nil
	p.ring = nil
	p.dec = nil
	p.ringPtr.Store(nil)
	p.mu.Unlock()

	if otoPlayer != nil {
		otoPlayer.Close()
	}
	if ring != nil {
		ring.close()
	}
	if worker != nil {
		worker.stop()
	}
	if dec != nil {
		dec.Close()
	}
}

// LoadTrack 打开曲目并准备流式解码。加载后处于暂停态。
func (p *Player) LoadTrack(track metadata.MscData) error {
	if !p.ready {
		return errors.New("音频设备未初始化")
	}
	if track.ID <= 0 {
		return errors.New("无效曲目")
	}

	filePath, err := p.db.GetTrackFilePath(strconv.FormatInt(track.ID, 10))
	if err != nil {
		return err
	}

	dec, err := OpenDecoder(filePath)
	if err != nil {
		return err
	}
	duration := dec.Duration()
	ring := newStreamRing(streamRingSize)
	worker := newDecodeWorker(dec, ring)

	p.stopPlayback()

	p.mu.Lock()
	p.track = trackPtr(track)
	p.dec = dec
	p.ring = ring
	p.worker = worker
	p.ringPtr.Store(ring)
	p.durationMicros.Store(int64(duration * 1e6))
	p.posBaseMicros.Store(0)
	p.playedBytes.Store(0)
	p.endedSent.Store(false)
	p.muteBytes.Store(0)
	p.isPlaying.Store(false)
	p.isPaused.Store(true)

	if p.otoCtx != nil {
		p.otoPlayer = p.otoCtx.NewPlayer(&PCMReader{p: p})
		p.otoPlayer.Play() // 暂停态下 PCMReader 输出静音
	}
	p.mu.Unlock()

	worker.start()
	p.eq.Reset()
	p.queue.EnsureCurrent(track.ID)

	log.Printf("[Player] 已加载曲目 %q (时长 %.1fs, 流式解码)", filePath, duration)
	p.emitTrackLoaded()
	p.emitState()
	return nil
}

func trackPtr(track metadata.MscData) *metadata.MscData {
	c := track
	return &c
}

func (p *Player) Resume() {
	if !p.ready || p.ringPtr.Load() == nil {
		return
	}

	wasPaused := p.isPaused.Load()
	p.isPaused.Store(false)
	p.isPlaying.Store(true)

	p.mu.Lock()
	if p.otoPlayer == nil && p.otoCtx != nil {
		p.otoPlayer = p.otoCtx.NewPlayer(&PCMReader{p: p})
	}
	if p.otoPlayer != nil {
		p.otoPlayer.Play()
	}
	track := p.track
	p.mu.Unlock()

	if wasPaused && track != nil && p.stats != nil {
		p.stats.RecordPlayStart(track.ID)
	}
	p.emitState()
}

func (p *Player) Pause() {
	if !p.ready {
		return
	}
	wasPlaying := p.isPlaying.Load() && !p.isPaused.Load()
	p.isPaused.Store(true)
	p.isPlaying.Store(false)

	p.mu.Lock()
	track := p.track
	p.mu.Unlock()

	if wasPlaying && track != nil && p.stats != nil {
		p.stats.RecordPlayPause(track.ID)
	}
	p.emitState()
}

func (p *Player) Toggle() {
	if p.isPaused.Load() {
		p.Resume()
	} else {
		p.Pause()
	}
}

// Seek 跳转到指定秒数。
func (p *Player) Seek(seconds float64) error {
	ring := p.ringPtr.Load()
	if ring == nil {
		return errors.New("无曲目")
	}
	if seconds < 0 {
		seconds = 0
	}
	if dur := p.safeDuration(); dur > 0 && seconds > dur {
		seconds = dur
	}

	p.posBaseMicros.Store(int64(seconds * 1e6))
	p.playedBytes.Store(0)
	p.muteBytes.Store(seekFlushBytes)
	p.endedSent.Store(false)

	gen := ring.reset()

	p.mu.Lock()
	worker := p.worker
	p.mu.Unlock()
	if worker != nil {
		worker.requestSeek(seconds, gen)
	}

	p.emitTimeUpdate()
	return nil
}

// StopTrack 停止当前曲目并释放播放资源（不影响音频设备）。
func (p *Player) StopTrack() {
	p.mu.Lock()
	track := p.track
	p.track = nil
	p.mu.Unlock()

	var trackID int64
	if track != nil {
		trackID = track.ID
	}

	wasPlaying := p.isPlaying.Load() && !p.isPaused.Load()
	if wasPlaying && trackID > 0 && p.stats != nil {
		p.stats.RecordPlayPause(trackID)
	}

	p.isPlaying.Store(false)
	p.isPaused.Store(true)
	p.muteBytes.Store(0)
	p.stopPlayback()

	if p.sink != nil {
		p.sink.EmitEvent("player:state", map[string]any{
			"isPlaying": false,
			"position":  0.0,
			"duration":  0.0,
			"trackId":   int64(0),
		})
	}
}

func (p *Player) Restart() error {
	if p.ringPtr.Load() == nil {
		return errors.New("无曲目")
	}
	if err := p.Seek(0); err != nil {
		return err
	}

	p.isPlaying.Store(true)
	p.isPaused.Store(false)

	p.mu.Lock()
	if p.otoPlayer == nil && p.otoCtx != nil {
		p.otoPlayer = p.otoCtx.NewPlayer(&PCMReader{p: p})
	}
	if p.otoPlayer != nil {
		p.otoPlayer.Play()
	}
	track := p.track
	p.mu.Unlock()

	if track != nil && p.stats != nil {
		p.stats.RecordPlayStart(track.ID)
	}
	p.emitState()
	return nil
}

// Next 切换到队列下一首（顺序或随机）。
func (p *Player) Next() {
	if p.queue == nil || p.queue.IsEmpty() {
		return
	}
	mode := p.playModeValue()
	var item QueueItem
	var ok bool
	if mode == "random" {
		item, ok = p.queue.AdvanceRandom(true)
	} else {
		item, ok = p.queue.AdvanceNext(true)
	}
	if ok {
		if err := p.LoadTrack(item.Track); err == nil {
			p.Resume()
		}
	}
}

// Prev 切换到队列上一首。
func (p *Player) Prev() {
	if p.queue == nil || p.queue.IsEmpty() {
		return
	}
	status := p.queue.Status()
	prev := status.CurrentIndex - 1
	if prev < 0 {
		prev = len(status.Items) - 1
	}
	if item, ok := p.queue.JumpTo(prev); ok {
		if err := p.LoadTrack(item.Track); err == nil {
			p.Resume()
		}
	}
}

func (p *Player) playModeValue() string {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.playMode
}

func (p *Player) TogglePlayMode() string {
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

	if p.sink != nil {
		p.sink.EmitEvent("player:modechange", mode)
	}
	return mode
}

func (p *Player) PlayMode() string {
	return p.playModeValue()
}

func (p *Player) handleEnded() {
	snapRing := p.ringPtr.Load()
	if snapRing == nil {
		return
	}
	if !snapRing.isEOF() {
		// 用户可能已经 seek 或 restart
		return
	}

	mode := p.playModeValue()
	p.mu.Lock()
	track := p.track
	queue := p.queue
	p.mu.Unlock()

	var trackID int64
	if track != nil {
		trackID = track.ID
	}

	if mode == "loopOne" {
		_ = p.Restart()
		return
	}

	if trackID > 0 && p.stats != nil {
		p.stats.RecordPlayPause(trackID)
	}

	if queue != nil && !queue.IsEmpty() {
		var item QueueItem
		var ok bool
		if mode == "random" {
			item, ok = queue.AdvanceRandom(true)
		} else {
			item, ok = queue.AdvanceNext(true)
		}
		if ok {
			if err := p.LoadTrack(item.Track); err == nil {
				p.Resume()
				if p.sink != nil {
					status := queue.Status()
					p.sink.EmitEvent("player:queuenext", map[string]any{
						"trackId":    item.Track.ID,
						"queueIndex": status.CurrentIndex,
					})
				}
			}
			return
		}
	}

	if p.sink != nil {
		p.sink.EmitEvent("player:ended", trackID)
		p.emitState()
	}
}

func (p *Player) State() PlayerState {
	p.mu.Lock()
	var track *metadata.MscData
	if p.track != nil {
		c := *p.track
		track = &c
	}
	volume := int(p.volume.Load())
	mode := p.playMode
	p.mu.Unlock()

	return PlayerState{
		Track:     track,
		IsPlaying: p.isPlaying.Load() && !p.isPaused.Load(),
		Position:  p.safePosition(),
		Duration:  p.safeDuration(),
		Volume:    volume,
		PlayMode:  mode,
	}
}

func (p *Player) safePosition() float64 {
	base := float64(p.posBaseMicros.Load()) / 1e6
	played := float64(p.playedBytes.Load()) / float64(playerSampleRate*bytesPerFrame)
	return base + played
}

func (p *Player) safeDuration() float64 {
	return float64(p.durationMicros.Load()) / 1e6
}

func (p *Player) emitTrackLoaded() {
	if p.sink == nil {
		return
	}
	p.mu.Lock()
	track := p.track
	p.mu.Unlock()
	if track == nil {
		return
	}
	c := *track
	p.sink.EmitEvent("player:trackloaded", map[string]any{
		"track":    &c,
		"duration": p.safeDuration(),
	})
}

func (p *Player) emitState() {
	if p.sink == nil {
		return
	}
	var trackID int64
	p.mu.Lock()
	if p.track != nil {
		trackID = p.track.ID
	}
	p.mu.Unlock()

	p.sink.EmitEvent("player:state", map[string]any{
		"isPlaying": p.isPlaying.Load() && !p.isPaused.Load(),
		"position":  p.safePosition(),
		"duration":  p.safeDuration(),
		"trackId":   trackID,
	})
}

func (p *Player) emitTimeUpdate() {
	if p.sink == nil || p.ringPtr.Load() == nil {
		return
	}
	p.sink.EmitEvent("player:timeupdate", map[string]float64{
		"position": p.safePosition(),
		"duration": p.safeDuration(),
	})
}

func (p *Player) timeUpdateLoop() {
	ticker := time.NewTicker(timeUpdatePeriod)
	defer ticker.Stop()
	for {
		select {
		case <-p.closed:
			return
		case <-ticker.C:
			if p.isPlaying.Load() && !p.isPaused.Load() {
				p.emitTimeUpdate()
			}
		}
	}
}

func (p *Player) eventLoop() {
	for {
		select {
		case <-p.closed:
			return
		case <-p.endCh:
			p.handleEnded()
		}
	}
}

func (p *Player) SetVolume(vol int) {
	if vol < 0 {
		vol = 0
	}
	if vol > 100 {
		vol = 100
	}
	p.volume.Store(int32(vol))
}

func (p *Player) GetVolume() int {
	return int(p.volume.Load())
}

func (p *Player) SetInitialVolume(vol int) {
	p.volume.Store(int32(vol))
}

func (p *Player) HasTrack() bool {
	return p.ringPtr.Load() != nil
}

func (p *Player) IsPaused() bool {
	return p.isPaused.Load()
}

func (p *Player) IsIdle() bool {
	return p.ringPtr.Load() == nil || p.isPaused.Load()
}

func volumeToGain(vol int) float64 {
	if vol <= 0 {
		return 0
	}
	if vol >= 100 {
		return 1.0
	}
	return math.Pow(float64(vol)/100.0, 2.0)
}

// PCMReader 是 oto 的音频回调。必须尽可能无锁、无阻塞。
type PCMReader struct {
	p *Player
}

func (r *PCMReader) Read(buf []byte) (int, error) {
	if len(buf) == 0 {
		return 0, nil
	}
	p := r.p
	zero := func() {
		for i := range buf {
			buf[i] = 0
		}
	}

	if p.isPaused.Load() {
		zero()
		return len(buf), nil
	}

	if mute := p.muteBytes.Load(); mute > 0 {
		zero()
		if mute <= int64(len(buf)) {
			p.muteBytes.Store(0)
		} else {
			p.muteBytes.Add(-int64(len(buf)))
		}
		return len(buf), nil
	}

	ring := p.ringPtr.Load()
	if ring == nil {
		zero()
		return len(buf), nil
	}

	n := ring.read(buf)
	if n < len(buf) {
		for i := n; i < len(buf); i++ {
			buf[i] = 0
		}
	}

	if n > 0 {
		p.playedBytes.Add(int64(n))
		if p.eq != nil {
			p.eq.ProcessFloat32LE(buf[:n])
		}
		gain := volumeToGain(int(p.volume.Load()))
		if gain < 0.99 && n >= 4 {
			f32 := unsafe.Slice((*float32)(unsafe.Pointer(&buf[0])), n/4)
			for i := range f32 {
				f32[i] *= float32(gain)
			}
		}
		return len(buf), nil
	}

	if ring.isEOF() && p.isPlaying.Load() && !p.isPaused.Load() {
		if p.endedSent.CompareAndSwap(false, true) {
			p.isPlaying.Store(false)
			p.isPaused.Store(true)
			select {
			case p.endCh <- struct{}{}:
			default:
			}
		}
	}
	return len(buf), nil
}
