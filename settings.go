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
	LastTrackID  int64  `json:"last_track_id"` // 上次播放的曲目ID
	LastPosition int64  `json:"last_position"` // 上次播放位置（秒）
	Volume       int    `json:"volume"`        // 音量 0-100
}

// DefaultSettings 返回默认设置
func DefaultSettings() Settings {
	return Settings{
		Theme:        "dark",
		PlayerFont:   "system-ui",
		LyricsFont:   "Consolas, Monaco, monospace",
		LastTrackID:  0,
		LastPosition: 0,
		Volume:       70,
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