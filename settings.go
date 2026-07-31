package main

import (
	"encoding/json"
	"os"
	"path/filepath"
)

// Settings 应用设置结构体
type Settings struct {
	Theme        string `json:"theme"`         // "dark" | "light" | "accent"
	PlayerFont   string `json:"player_font"`   // 播放器字体
	LyricsFont   string `json:"lyrics_font"`   // 歌词字体
	UIScale      int    `json:"ui_scale"`      // 界面缩放比例 (20-500)，默认 100
	LyricsScale  int    `json:"lyrics_scale"`  // 歌词缩放比例 (20-500)，默认 100
	LastTrackID  int64  `json:"last_track_id"` // 上次播放的曲目ID
	LastPosition int64  `json:"last_position"` // 上次播放位置（秒）
	Volume       int    `json:"volume"`        // 音量 0-100
	AccentColor  string `json:"accent_color"`  // 自定义主题色（十六进制，如 #1DB954）
	Language     string `json:"language"`      // 界面语言："zh-CN" | "en"
}

// DefaultSettings 返回默认设置
func DefaultSettings() Settings {
	return Settings{
		Theme:        "dark",
		PlayerFont:   "system-ui",
		LyricsFont:   "Consolas, Monaco, monospace",
		UIScale:      135,
		LyricsScale:  135,
		LastTrackID:  0,
		LastPosition: 0,
		Volume:       70,
		AccentColor:  "#1DB954",
		Language:     "zh-CN",
	}
}

// settingsFilePath 返回设置文件路径（%APPDATA%/MusicLite/settings.json）
func settingsFilePath() string {
	appData := os.Getenv("APPDATA")
	if appData == "" {
		appData = "."
	}
	dir := filepath.Join(appData, "MusicLite")
	os.MkdirAll(dir, 0755)
	return filepath.Join(dir, "settings.json")
}

// settingsDir 返回设置文件所在目录（%APPDATA%/MusicLite）
func settingsDir() string {
	return filepath.Dir(settingsFilePath())
}

// LoadSettings 加载设置（文件不存在则返回默认设置）
func (a *App) LoadSettings() Settings {
	path := settingsFilePath()
	data, err := os.ReadFile(path)
	if err != nil {
		return DefaultSettings()
	}

	var s Settings
	if err := json.Unmarshal(data, &s); err != nil {
		return DefaultSettings()
	}

	// 用默认值补齐可能缺失的字段（兼容旧版设置文件）
	def := DefaultSettings()
	if s.Language == "" {
		s.Language = def.Language
	}
	// 旧版 base_font_size (12-22px) → 新版 ui_scale (20-200%)
	// 基准 14px，比例 = round(value / 14 * 100)
	if s.UIScale == 0 {
		// 尝试从旧字段迁移
		type legacySettings struct {
			BaseFontSize   int `json:"base_font_size"`
			LyricsFontSize int `json:"lyrics_font_size"`
		}
		var legacy legacySettings
		if json.Unmarshal(data, &legacy) == nil && legacy.BaseFontSize > 0 {
			s.UIScale = legacy.BaseFontSize * 100 / 14
			if s.UIScale < 20 {
				s.UIScale = 20
			}
			if s.UIScale > 500 {
				s.UIScale = 500
			}
		} else {
			s.UIScale = def.UIScale
		}
	}
	if s.LyricsScale == 0 {
		type legacySettings struct {
			LyricsFontSize int `json:"lyrics_font_size"`
		}
		var legacy legacySettings
		if json.Unmarshal(data, &legacy) == nil && legacy.LyricsFontSize > 0 {
			s.LyricsScale = legacy.LyricsFontSize * 100 / 16
			if s.LyricsScale < 20 {
				s.LyricsScale = 20
			}
			if s.LyricsScale > 500 {
				s.LyricsScale = 500
			}
		} else {
			s.LyricsScale = def.LyricsScale
		}
	}

	return s
}

// SaveSettings 保存设置
func (a *App) SaveSettings(s Settings) error {
	data, err := json.MarshalIndent(s, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(settingsFilePath(), data, 0644)
}

// ResetSettings 返回默认设置（不立即写盘，由前端再次调用 SaveSettings 持久化）
func (a *App) ResetSettings() Settings {
	return DefaultSettings()
}
