//go:build android

package app

import (
	"fmt"
	"sync"

	"MusicLite/internal/format"
	"MusicLite/internal/storage"
)

// ============ 播放器（Android 存根）============
//
// Android 下音频解码与输出由前端 <audio> 元素完成，后端 Player 仅提供
// 接口存根让 Wails 绑定可编译。队列功能保留真实实现（前端队列面板依赖）。
//
// 与 player.go（!android）互斥：桌面端走 FFmpeg CGO + oto 真实实现，
// Android 走此存根。PlayerState 类型保持定义一致供 Wails 绑定生成。

// PlayerState 暴露给前端的播放器快照
type PlayerState struct {
	Track     *format.MscData `json:"track"`
	IsPlaying bool            `json:"isPlaying"`
	Position  float64         `json:"position"`
	Duration  float64         `json:"duration"`
	Volume    int             `json:"volume"`
	PlayMode  string          `json:"playMode"`
}

// Player 播放器（Android 存根，仅维护内存状态与队列）
type Player struct {
	mu       sync.Mutex
	db       *storage.Database
	app      *MusicService
	queue    *PlayQueue
	track    *format.MscData
	playMode string
	volume   int
}

// NewPlayer 创建播放器实例
func NewPlayer(db *storage.Database, app *MusicService) *Player {
	p := &Player{
		db:       db,
		app:      app,
		playMode: "none",
		volume:   70,
	}
	p.queue = NewPlayQueue(db, app)
	return p
}

// Queue 返回播放队列
func (p *Player) Queue() *PlayQueue { return p.queue }

// Equalizer 返回均衡器（Android 下不支持，返回 nil）
func (p *Player) Equalizer() *Equalizer { return nil }

// SmartEQ 返回智能均衡器（Android 下不支持，返回 nil）
func (p *Player) SmartEQ() *SmartEQ { return nil }

// Start 启动播放器（Android 存根：无音频设备需初始化）
func (p *Player) Start() {}

// Stop 停止播放器
func (p *Player) Stop() {
	p.mu.Lock()
	p.track = nil
	p.mu.Unlock()
}

// ============ Player 内部方法（存根）============

func (p *Player) loadTrack(track format.MscData) error {
	p.mu.Lock()
	p.track = &track
	p.mu.Unlock()
	if p.queue != nil {
		p.queue.EnsureCurrent(track.ID)
	}
	return nil
}

func (p *Player) resume()  {}
func (p *Player) pause()   {}
func (p *Player) toggle() {}

func (p *Player) seek(seconds float64) error {
	_ = seconds
	return nil
}

func (p *Player) stop() {
	p.mu.Lock()
	p.track = nil
	p.mu.Unlock()
}

func (p *Player) restart() error {
	return nil
}

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
	return mode
}

func (p *Player) snapshot() PlayerState {
	p.mu.Lock()
	track := p.track
	mode := p.playMode
	p.mu.Unlock()
	return PlayerState{
		Track:    track,
		PlayMode: mode,
		Volume:   p.volume,
	}
}

func (p *Player) SetVolume(vol int) {
	if vol < 0 {
		vol = 0
	}
	if vol > 100 {
		vol = 100
	}
	p.mu.Lock()
	p.volume = vol
	p.mu.Unlock()
}

func (p *Player) GetVolume() int {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.volume
}

func (p *Player) SetInitialVolume(vol int) {
	p.SetVolume(vol)
}

func (p *Player) SetSmartEQDefaults(enabled bool, intensity float64) {}

func (p *Player) HasTrack() bool {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.track != nil
}

func (p *Player) IsPaused() bool {
	return true
}

func (p *Player) IsIdle() bool {
	return true
}

// ============ 对前端暴露的 App 方法（Wails 绑定）============

func (a *MusicService) PlayerLoad(track format.MscData) error { return a.player.loadTrack(track) }
func (a *MusicService) PlayerPlay()                           { a.player.resume() }
func (a *MusicService) PlayerPause()                          { a.player.pause() }
func (a *MusicService) PlayerToggle()                         { a.player.toggle() }
func (a *MusicService) PlayerSeek(seconds float64) error      { return a.player.seek(seconds) }
func (a *MusicService) PlayerStop()                           { a.player.stop() }
func (a *MusicService) PlayerGetState() PlayerState           { return a.player.snapshot() }
func (a *MusicService) PlayerTogglePlayMode() string          { return a.player.togglePlayMode() }
func (a *MusicService) PlayerGetPlayMode() string {
	a.player.mu.Lock()
	defer a.player.mu.Unlock()
	return a.player.playMode
}
func (a *MusicService) PlayerRestart() error { return a.player.restart() }

// 均衡器方法 Stub（Android 下不支持）
func (a *MusicService) PlayerGetEqBandCount() int                 { return 0 }
func (a *MusicService) PlayerGetEqFreqs() []float64               { return []float64{} }
func (a *MusicService) PlayerSetEqBand(index int, gainDB float64) {}
func (a *MusicService) PlayerSetEqGains(gains []float64)          {}
func (a *MusicService) PlayerGetEqGains() []float64               { return []float64{} }
func (a *MusicService) PlayerSetEqEnabled(on bool)                {}
func (a *MusicService) PlayerGetEqEnabled() bool                  { return false }
func (a *MusicService) PlayerResetEq()                            {}
func (a *MusicService) PlayerSetSmartEQEnabled(on bool)           {}
func (a *MusicService) PlayerGetSmartEQEnabled() bool             { return false }
func (a *MusicService) PlayerSetSmartEQIntensity(v float64)       {}
func (a *MusicService) PlayerGetSmartEQIntensity() float64        { return 0 }

// 队列与音量方法（队列功能保留真实实现）
func (a *MusicService) QueueAddTrack(id int64) QueueItem {
	item, _ := a.player.queue.AddTrack(id)
	return item
}
func (a *MusicService) QueueAddAll(ids []int64) int  { return a.player.queue.AddAll(ids) }
func (a *MusicService) QueueAddAllFromLibrary() int  { return a.player.queue.AddAllFromLibrary() }
func (a *MusicService) QueueRemoveAt(index int) bool { return a.player.queue.RemoveAt(index) }
func (a *MusicService) QueueClear()                  { a.player.queue.Clear() }
func (a *MusicService) QueueShuffle()                { a.player.queue.Shuffle() }
func (a *MusicService) QueueMove(from, to int) bool  { return a.player.queue.Move(from, to) }
func (a *MusicService) QueueJumpTo(index int) error {
	if item, ok := a.player.queue.JumpTo(index); ok {
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
func (a *MusicService) QueueGetStatus() QueueStatus { return a.player.queue.Status() }
func (a *MusicService) QueueGetNext() QueueItem {
	item, _ := a.player.queue.GetNext(true)
	return item
}
func (a *MusicService) QueueGetPrev() QueueItem {
	item, _ := a.player.queue.GetPrev(true)
	return item
}
func (a *MusicService) SetApplicationVolume(vol int) error {
	a.player.SetVolume(vol)
	return nil
}
func (a *MusicService) GetApplicationVolume() (int, error) {
	return a.player.GetVolume(), nil
}
