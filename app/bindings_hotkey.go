package app

import (
	"MusicLite/internal/hotkey"
	"MusicLite/internal/settings"
)

// HotkeyApply 重新从设置同步快捷键配置。
func (s *MusicService) HotkeyApply() {
	if s.hotkeys == nil {
		return
	}
	s.hotkeys.UpdateConfig(s.store.Load())
}

func (s *MusicService) HotkeyFormatKey(keys string) string {
	return hotkey.FormatKey(keys)
}

func (s *MusicService) HotkeyParseFromJS(ctrl, shift, alt, meta bool, key string) string {
	return hotkey.ParseFromJS(ctrl, shift, alt, meta, key)
}

func (s *MusicService) HotkeyGetConfig() map[string]settings.HotkeyConfig {
	if s.hotkeys == nil {
		return nil
	}
	return s.hotkeys.GetConfig()
}

func (s *MusicService) HotkeyGetActionList() []map[string]string {
	return hotkey.ActionList()
}
