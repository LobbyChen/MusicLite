//go:build android

package app

import "strings"

// HotkeyConfig 单个快捷键配置
type HotkeyConfig struct {
	Enabled bool   `json:"enabled"`
	Keys    string `json:"keys"`
}

// HotkeyManager 全局快捷键管理器（Android 存根，无实际功能）
type HotkeyManager struct{}

// NewHotkeyManager 创建存根管理器
func NewHotkeyManager(app *MusicService, player *Player) *HotkeyManager {
	return &HotkeyManager{}
}

// UpdateConfig 存根：接受配置但不执行
func (hm *HotkeyManager) UpdateConfig(s Settings) {}

// Start 存根：无操作
func (hm *HotkeyManager) Start() {}

// Stop 存根：无操作
func (hm *HotkeyManager) Stop() {}

// HotkeyApply 存根：无操作
func (a *MusicService) HotkeyApply() {}

// HotkeyFormatKey 格式化快捷键显示文本（纯字符串逻辑，与桌面端一致）
func (a *MusicService) HotkeyFormatKey(keys string) string {
	return normalizeHotkey(keys)
}

// HotkeyParseFromJS 从前端的 keydown 事件数据解析快捷键字符串
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

// HotkeyGetConfig 返回空配置
func (a *MusicService) HotkeyGetConfig() map[string]HotkeyConfig {
	return make(map[string]HotkeyConfig)
}

// HotkeyGetActionList 返回支持的快捷键动作列表
func (a *MusicService) HotkeyGetActionList() []map[string]string {
	return []map[string]string{
		{"action": "playpause", "label_zh": "播放 / 暂停", "label_en": "Play / Pause"},
		{"action": "next", "label_zh": "下一曲", "label_en": "Next Track"},
		{"action": "prev", "label_zh": "上一曲", "label_en": "Previous Track"},
	}
}

// normalizeHotkey 规范化快捷键字符串（纯字符串逻辑，与桌面端一致）
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
