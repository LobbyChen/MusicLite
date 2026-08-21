//go:build !android

package app

import (
	"fmt"
	"log"
	"strings"
	"sync"

	hook "github.com/robotn/gohook"
)

// HotkeyConfig 单个快捷键配置
type HotkeyConfig struct {
	Enabled bool   `json:"enabled"` // 是否启用
	Keys    string `json:"keys"`    // 组合键字符串，如 "Ctrl+Shift+P"
}

// HotkeyManager 全局快捷键管理器
type HotkeyManager struct {
	mu       sync.RWMutex
	config   map[string]HotkeyConfig // action → config
	player   *Player
	app      *MusicService
	active   bool
	modsDown map[string]bool // 当前按下的修饰键
}

// NewHotkeyManager 创建快捷键管理器
func NewHotkeyManager(app *MusicService, player *Player) *HotkeyManager {
	return &HotkeyManager{
		app:      app,
		player:   player,
		config:   make(map[string]HotkeyConfig),
		modsDown: make(map[string]bool),
	}
}

// UpdateConfig 从 Settings 更新快捷键配置（线程安全，无需重启 hook）
func (hm *HotkeyManager) UpdateConfig(s Settings) {
	hm.mu.Lock()
	defer hm.mu.Unlock()
	hm.config["playpause"] = s.HotkeyPlayPause
	hm.config["next"] = s.HotkeyNext
	hm.config["prev"] = s.HotkeyPrev
}

// Start 启动全局键盘 hook
func (hm *HotkeyManager) Start() {
	hm.mu.Lock()
	if hm.active {
		hm.mu.Unlock()
		return
	}
	hm.active = true
	hm.mu.Unlock()

	evChan := hook.Start()
	go hm.eventLoop(evChan)
	log.Println("[Hotkey] 全局快捷键已启动")
}

// Stop 停止全局键盘 hook
func (hm *HotkeyManager) Stop() {
	hm.mu.Lock()
	if !hm.active {
		hm.mu.Unlock()
		return
	}
	hm.active = false
	hm.mu.Unlock()
	hook.End()
	log.Println("[Hotkey] 全局快捷键已停止")
}

// eventLoop 处理键盘事件
func (hm *HotkeyManager) eventLoop(evChan <-chan hook.Event) {
	var (
		// lastKeyDown 去抖：同一个非修饰键在一次 press→hold→up 循环中只触发一次（避免 KeyHold 连续触发多次）
		lastTriggeredRaw uint16
	)
	for ev := range evChan {
		switch ev.Kind {
		case hook.KeyDown, hook.KeyHold:
			if mod, ok := modifierRawcodes[ev.Rawcode]; ok {
				hm.mu.Lock()
				hm.modsDown[mod] = true
				hm.mu.Unlock()
				continue
			}
			// 非修饰键按下 → 立即匹配（比 KeyUp 更灵敏）
			// 同一个 rawcode 的 KeyHold 不重复触发（防止长按连发）
			if ev.Kind == hook.KeyHold && ev.Rawcode == lastTriggeredRaw {
				continue
			}
			if hm.checkHotkey(ev) {
				lastTriggeredRaw = ev.Rawcode
			}
		case hook.KeyUp:
			if mod, ok := modifierRawcodes[ev.Rawcode]; ok {
				hm.mu.Lock()
				hm.modsDown[mod] = false
				hm.mu.Unlock()
				continue
			}
			// 非修饰键弹起 → 去抖重置
			if ev.Rawcode == lastTriggeredRaw {
				lastTriggeredRaw = 0
			}
		}
	}
}

// checkHotkey 检查按键事件是否匹配某个已启用的快捷键
// 返回 true 表示成功匹配并触发了动作（用于去抖）
func (hm *HotkeyManager) checkHotkey(ev hook.Event) bool {
	// 获取键名
	key, ok := rawcodeToName[ev.Rawcode]
	if !ok {
		if ev.Keychar != 0 && ev.Keychar != hook.CharUndefined {
			ch := strings.ToLower(string(ev.Keychar))
			if len(ch) == 1 && (ch[0] >= 'a' && ch[0] <= 'z' || ch[0] >= '0' && ch[0] <= '9') {
				key = ch
			}
		}
	}
	if key == "" {
		return false
	}

	// 按规范顺序构建组合键字符串
	hm.mu.RLock()
	var mods []string
	if hm.modsDown["ctrl"] {
		mods = append(mods, "ctrl")
	}
	if hm.modsDown["shift"] {
		mods = append(mods, "shift")
	}
	if hm.modsDown["alt"] {
		mods = append(mods, "alt")
	}
	if hm.modsDown["win"] {
		mods = append(mods, "win")
	}
	config := make(map[string]HotkeyConfig, len(hm.config))
	for k, v := range hm.config {
		config[k] = v
	}
	hm.mu.RUnlock()

	mods = append(mods, key)
	combo := strings.Join(mods, "+")

	// 比对每个动作：playpause（播放/暂停切换）/ next（下一曲）/ prev（上一曲）
	actions := []string{"playpause", "next", "prev"}
	for _, action := range actions {
		cfg, ok := config[action]
		if !ok || !cfg.Enabled || cfg.Keys == "" {
			continue
		}
		if normalizeHotkey(cfg.Keys) == combo {
			hm.triggerAction(action)
			return true
		}
	}
	return false
}

// triggerAction 触发对应的播放器动作
func (hm *HotkeyManager) triggerAction(action string) {
	p := hm.player
	if p == nil {
		return
	}
	switch action {
	case "playpause":
		// 播放/暂停切换：未在播放 → resume；正在播放 → pause
		// 优化：IsPaused() 和 HasTrack() 内部是原子操作，无需加 p.mu 锁
		if !p.IsPaused() && p.HasTrack() {
			p.pause()
		} else {
			p.resume()
		}
	case "next":
		queue := p.Queue()
		if queue != nil && !queue.IsEmpty() {
			p.mu.Lock()
			mode := p.playMode
			p.mu.Unlock()
			var item QueueItem
			var ok bool
			if mode == "random" {
				item, ok = queue.AdvanceRandom(true)
			} else {
				item, ok = queue.AdvanceNext(true)
			}
			if ok {
				if err := p.loadTrack(item.Track); err == nil {
					p.resume()
				}
			}
		}
	case "prev":
		queue := p.Queue()
		if queue != nil && !queue.IsEmpty() {
			status := queue.Status()
			prev := status.CurrentIndex - 1
			if prev < 0 {
				prev = len(status.Items) - 1
			}
			if item, ok := queue.JumpTo(prev); ok {
				if err := p.loadTrack(item.Track); err == nil {
					p.resume()
				}
			}
		}
	}
}

// normalizeHotkey 将用户输入的快捷键字符串规范化为小写 + 规范顺序
// "Ctrl+Shift+P" → "ctrl+shift+p"
func normalizeHotkey(s string) string {
	s = strings.TrimSpace(strings.ToLower(s))
	parts := strings.Split(s, "+")
	modOrder := map[string]int{"ctrl": 0, "shift": 1, "alt": 2, "win": 3}
	var mods []string
	var key string
	for _, p := range parts {
		p = strings.TrimSpace(p)
		if _, isMod := modOrder[p]; isMod {
			mods = append(mods, p)
		} else if p != "" {
			key = p
		}
	}
	// 按规范顺序排序修饰键
	for i := 0; i < len(mods); i++ {
		for j := i + 1; j < len(mods); j++ {
			if modOrder[mods[i]] > modOrder[mods[j]] {
				mods[i], mods[j] = mods[j], mods[i]
			}
		}
	}
	result := strings.Join(mods, "+")
	if key != "" {
		if result != "" {
			result += "+"
		}
		result += key
	}
	return result
}

// HotkeyApply 更新后端快捷键配置（Wails 绑定，前端保存设置时调用）
func (a *MusicService) HotkeyApply() {
	if a.hotkeyManager == nil {
		return
	}
	settings := a.LoadSettings()
	a.hotkeyManager.UpdateConfig(settings)
}

// HotkeyFormatKey 格式化快捷键显示文本（Wails 绑定，前端用于显示）
func (a *MusicService) HotkeyFormatKey(keys string) string {
	return normalizeHotkey(keys)
}

// HotkeyParseFromJS 从前端的 keydown 事件数据解析快捷键字符串
// 前端传入的格式: {ctrl: true, shift: false, alt: false, meta: false, key: "p"}
func (a *MusicService) HotkeyParseFromJS(ctrl, shift, alt, meta bool, key string) string {
	var parts []string
	if ctrl {
		parts = append(parts, "Ctrl")
	}
	if shift {
		parts = append(parts, "Shift")
	}
	if alt {
		parts = append(parts, "Alt")
	}
	if meta {
		parts = append(parts, "Win")
	}
	if key != "" {
		// 标准化键名
		keyLower := strings.ToLower(key)
		switch keyLower {
		case "control", "ctrl":
			return strings.Join(parts, "+")
		case "shift":
			return strings.Join(parts, "+")
		case "alt", "menu":
			return strings.Join(parts, "+")
		case "meta", "win", "os":
			return strings.Join(parts, "+")
		}
		parts = append(parts, keyLower)
	}
	return strings.Join(parts, "+")
}

// HotkeyGetConfig 返回当前快捷键配置
func (a *MusicService) HotkeyGetConfig() map[string]HotkeyConfig {
	if a.hotkeyManager == nil {
		return nil
	}
	a.hotkeyManager.mu.RLock()
	defer a.hotkeyManager.mu.RUnlock()
	result := make(map[string]HotkeyConfig, len(a.hotkeyManager.config))
	for k, v := range a.hotkeyManager.config {
		result[k] = v
	}
	return result
}

// HotkeyGetActionList 返回支持的快捷键动作列表（前端用于生成 UI）
func (a *MusicService) HotkeyGetActionList() []map[string]string {
	return []map[string]string{
		{"action": "playpause", "label_zh": "播放 / 暂停", "label_en": "Play / Pause"},
		{"action": "next", "label_zh": "下一曲", "label_en": "Next Track"},
		{"action": "prev", "label_zh": "上一曲", "label_en": "Previous Track"},
	}
}

// 用于格式化错误信息
func formatHotkeyError(action string) string {
	return fmt.Sprintf("快捷键配置无效: %s", action)
}
