package hotkey

import (
	"log"
	"strings"
	"sync"

	"MusicLite/internal/playback"
	"MusicLite/internal/settings"

	hook "github.com/robotn/gohook"
)

// Manager 管理全局快捷键。
type Manager struct {
	mu       sync.RWMutex
	config   map[string]settings.HotkeyConfig
	player   *playback.Player
	active   bool
	modsDown map[string]bool
}

func NewManager(player *playback.Player) *Manager {
	return &Manager{
		player:   player,
		config:   make(map[string]settings.HotkeyConfig),
		modsDown: make(map[string]bool),
	}
}

// UpdateConfig 从设置同步快捷键配置（无需重启 hook）。
func (m *Manager) UpdateConfig(s settings.Settings) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.config["playpause"] = s.HotkeyPlayPause
	m.config["next"] = s.HotkeyNext
	m.config["prev"] = s.HotkeyPrev
}

func (m *Manager) Start() {
	m.mu.Lock()
	if m.active {
		m.mu.Unlock()
		return
	}
	m.active = true
	m.mu.Unlock()

	evChan := hook.Start()
	go m.eventLoop(evChan)
	log.Println("[Hotkey] 全局快捷键已启动")
}

func (m *Manager) Stop() {
	m.mu.Lock()
	if !m.active {
		m.mu.Unlock()
		return
	}
	m.active = false
	m.mu.Unlock()

	hook.End()
	log.Println("[Hotkey] 全局快捷键已停止")
}

func (m *Manager) eventLoop(evChan <-chan hook.Event) {
	var lastTriggeredRaw uint16
	for ev := range evChan {
		switch ev.Kind {
		case hook.KeyDown, hook.KeyHold:
			if mod, ok := modifierRawcodes[ev.Rawcode]; ok {
				m.mu.Lock()
				m.modsDown[mod] = true
				m.mu.Unlock()
				continue
			}
			if ev.Kind == hook.KeyHold && ev.Rawcode == lastTriggeredRaw {
				continue
			}
			if m.checkHotkey(ev) {
				lastTriggeredRaw = ev.Rawcode
			}
		case hook.KeyUp:
			if mod, ok := modifierRawcodes[ev.Rawcode]; ok {
				m.mu.Lock()
				m.modsDown[mod] = false
				m.mu.Unlock()
				continue
			}
			if ev.Rawcode == lastTriggeredRaw {
				lastTriggeredRaw = 0
			}
		}
	}
}

func (m *Manager) checkHotkey(ev hook.Event) bool {
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

	m.mu.RLock()
	var mods []string
	if m.modsDown["ctrl"] {
		mods = append(mods, "ctrl")
	}
	if m.modsDown["shift"] {
		mods = append(mods, "shift")
	}
	if m.modsDown["alt"] {
		mods = append(mods, "alt")
	}
	if m.modsDown["win"] {
		mods = append(mods, "win")
	}
	config := make(map[string]settings.HotkeyConfig, len(m.config))
	for k, v := range m.config {
		config[k] = v
	}
	m.mu.RUnlock()

	combo := strings.Join(append(mods, key), "+")
	for _, action := range []string{"playpause", "next", "prev"} {
		cfg, ok := config[action]
		if !ok || !cfg.Enabled || cfg.Keys == "" {
			continue
		}
		if normalizeHotkey(cfg.Keys) == combo {
			m.triggerAction(action)
			return true
		}
	}
	return false
}

func (m *Manager) triggerAction(action string) {
	if m.player == nil {
		return
	}
	switch action {
	case "playpause":
		m.player.Toggle()
	case "next":
		m.player.Next()
	case "prev":
		m.player.Prev()
	}
}

// FormatKey 将用户输入的快捷键字符串规范化为小写 + 规范顺序。
func FormatKey(s string) string {
	return normalizeHotkey(s)
}

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

// ParseFromJS 从前端 keydown 事件数据解析快捷键字符串。
func ParseFromJS(ctrl, shift, alt, meta bool, key string) string {
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
		keyLower := strings.ToLower(key)
		switch keyLower {
		case "control", "ctrl", "shift", "alt", "menu", "meta", "win", "os":
			return strings.Join(parts, "+")
		}
		parts = append(parts, keyLower)
	}
	return strings.Join(parts, "+")
}

// GetConfig 返回当前快捷键配置快照。
func (m *Manager) GetConfig() map[string]settings.HotkeyConfig {
	m.mu.RLock()
	defer m.mu.RUnlock()
	result := make(map[string]settings.HotkeyConfig, len(m.config))
	for k, v := range m.config {
		result[k] = v
	}
	return result
}

// ActionList 返回支持的快捷键动作列表。
func ActionList() []map[string]string {
	return []map[string]string{
		{"action": "playpause", "label_zh": "播放 / 暂停", "label_en": "Play / Pause"},
		{"action": "next", "label_zh": "下一曲", "label_en": "Next Track"},
		{"action": "prev", "label_zh": "上一曲", "label_en": "Previous Track"},
	}
}
