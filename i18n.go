package main

// ============ 后端 i18n：统一文案加载机制 ============
//
// 初始 i18n.json 通过 go:embed 打包进二进制；首次启动时解压到
// %APPDATA%/MusicLite/i18n.json；再次启动优先使用外部文件，
// 允许用户/导入包覆盖默认文案，避免硬编码翻译。
//
// 前端通过 App.GetI18nData() 获取完整翻译数据；后端通过
// getBackendStrings() 获取自身所需字段。

import (
	"embed"
	"encoding/json"
	"os"
	"path/filepath"
	"sync"
)

//go:embed i18n.json
var embeddedI18nFS embed.FS

// i18nFilePath 外部 i18n.json 路径（%APPDATA%/MusicLite/i18n.json）
func i18nFilePath() string {
	return filepath.Join(settingsDir(), "i18n.json")
}

// I18nData 统一翻译数据结构（前后端共享）
type I18nData struct {
	Version  int                                  `json:"version"`
	Languages map[string]map[string]string         `json:"languages"`
}

// backendStrings 后端使用的文案子集（从 I18nData 提取）
type backendStrings struct {
	SelectMusicFile string
	ExportSettings  string
	ImportSettings  string
	MusicFileFilter string
	SettingsFilter  string
	TrayShow        string
	TrayPlayPause   string
	TrayQuit        string
	TrayTooltip     string
}

var (
	cachedI18n     *I18nData
	cachedI18nLock sync.RWMutex
)

// loadI18nData 加载 i18n 数据：优先外部文件，回退内嵌
func loadI18nData() *I18nData {
	cachedI18nLock.RLock()
	if cachedI18n != nil {
		data := cachedI18n
		cachedI18nLock.RUnlock()
		return data
	}
	cachedI18nLock.RUnlock()

	cachedI18nLock.Lock()
	defer cachedI18nLock.Unlock()

	// 双重检查
	if cachedI18n != nil {
		return cachedI18n
	}

	data := &I18nData{Languages: map[string]map[string]string{}}

	// 1. 先加载内嵌版本作为兜底
	embeddedBytes, err := embeddedI18nFS.ReadFile("i18n.json")
	if err == nil {
		_ = json.Unmarshal(embeddedBytes, data)
	}

	// 2. 尝试加载外部文件覆盖
	externalPath := i18nFilePath()
	if externalBytes, err := os.ReadFile(externalPath); err == nil {
		var external I18nData
		if json.Unmarshal(externalBytes, &external) == nil && external.Languages != nil {
			data = &external
		}
	} else {
		// 3. 外部文件不存在：首次启动，解压内嵌版本
		_ = os.MkdirAll(settingsDir(), 0755)
		_ = os.WriteFile(externalPath, embeddedBytes, 0644)
	}

	cachedI18n = data
	return data
}

// ensureI18nFile 启动时调用：确保外部 i18n.json 存在
// 外部文件不存在时从内嵌解压；存在则不做任何操作（保留用户/导入覆盖）
func ensureI18nFile() {
	externalPath := i18nFilePath()
	if _, err := os.Stat(externalPath); err == nil {
		// 外部文件已存在，保留
		return
	}
	// 首次启动：解压内嵌版本
	embeddedBytes, err := embeddedI18nFS.ReadFile("i18n.json")
	if err != nil {
		return
	}
	_ = os.MkdirAll(settingsDir(), 0755)
	_ = os.WriteFile(externalPath, embeddedBytes, 0644)
}

// GetI18nData 暴露给前端：返回完整翻译数据
func (a *App) GetI18nData() I18nData {
	return *loadI18nData()
}

// getBackendStrings 根据当前设置的语言返回后端文案
func (a *App) getBackendStrings() backendStrings {
	data := loadI18nData()
	s := a.LoadSettings()
	lang := s.Language
	if lang == "" {
		lang = "zh-CN"
	}

	dict, ok := data.Languages[lang]
	if !ok {
		dict, ok = data.Languages["zh-CN"]
		if !ok {
			return backendStrings{}
		}
	}

	get := func(key, fallback string) string {
		if v, ok := dict[key]; ok && v != "" {
			return v
		}
		return fallback
	}

	return backendStrings{
		SelectMusicFile: get("backend.selectMusicFile", "选择音乐文件"),
		ExportSettings:  get("backend.exportSettings", "导出 MusicLite 设置"),
		ImportSettings:  get("backend.importSettings", "导入 MusicLite 设置"),
		MusicFileFilter: get("backend.musicFileFilter", "Music File (*.mp3, *.ogg, *.flac, *.wav, *.ape)"),
		SettingsFilter:  get("backend.settingsFilter", "MusicLite 设置包 (*.msclte.zip)"),
		TrayShow:        get("backend.trayShow", "显示主窗口"),
		TrayPlayPause:   get("backend.trayPlayPause", "播放/暂停"),
		TrayQuit:        get("backend.trayQuit", "退出"),
		TrayTooltip:     get("backend.trayTooltip", "MusicLite"),
	}
}
