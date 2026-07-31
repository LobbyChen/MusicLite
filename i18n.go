package main

// ============ 后端 i18n：统一文案加载机制 ============
//
// 初始 i18n.json 通过 go:embed 打包进二进制；首次启动时解压到
// %APPDATA%/MusicLite/i18n.json；再次启动时将外部文件与内嵌版本
// 合并——以内嵌为基准补齐外部文件缺失的语言和键，但不覆盖用户
// 已自定义的值。这样既能保留用户/导入包的修改，又能让新版本的
// 新增语言和键对用户可用。
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
	Version   int                              `json:"version"`
	Languages map[string]map[string]string     `json:"languages"`
}

// backendStrings 后端使用的文案子集（从 I18nData 提取）
type backendStrings struct {
	SelectMusicFile  string
	ExportSettings   string
	ImportSettings   string
	MusicFileFilter  string
	SettingsFilter   string
	TrayShow         string
	TrayPlayPause    string
	TrayQuit         string
	TrayTooltip      string
	PickImageFile    string
	PickLyricsFile   string
	ImageFileFilter  string
	LyricsFileFilter string
}

var (
	cachedI18n     *I18nData
	cachedI18nLock sync.RWMutex
)

// loadEmbeddedI18n 加载内嵌的 i18n.json
func loadEmbeddedI18n() *I18nData {
	data := &I18nData{Languages: map[string]map[string]string{}}
	embeddedBytes, err := embeddedI18nFS.ReadFile("i18n.json")
	if err == nil {
		_ = json.Unmarshal(embeddedBytes, data)
	}
	if data.Languages == nil {
		data.Languages = map[string]map[string]string{}
	}
	return data
}

// mergeI18n 将内嵌版本中"外部文件缺失的语言和键"补进外部文件
// 不覆盖外部文件已有的值（保留用户/导入包的自定义）
// 返回合并后的数据
func mergeI18n(embedded, external *I18nData) *I18nData {
	if external == nil || external.Languages == nil {
		return embedded
	}
	merged := &I18nData{
		// version 取较大值，保证新版升级后 version 也能更新
		Version:   embedded.Version,
		Languages: map[string]map[string]string{},
	}
	if external.Version > merged.Version {
		merged.Version = external.Version
	}

	// 先把外部文件的内容复制进来（保留用户自定义）
	for lang, dict := range external.Languages {
		copied := map[string]string{}
		for k, v := range dict {
			copied[k] = v
		}
		merged.Languages[lang] = copied
	}

	// 再用内嵌版本补齐：缺失的语言整体补上；已有语言中缺失的键补上
	for lang, embeddedDict := range embedded.Languages {
		extDict, ok := merged.Languages[lang]
		if !ok {
			// 外部文件完全没有这个语言 → 整体从内嵌复制
			copied := map[string]string{}
			for k, v := range embeddedDict {
				copied[k] = v
			}
			merged.Languages[lang] = copied
			continue
		}
		// 外部文件有这个语言，逐键补齐缺失项
		for k, v := range embeddedDict {
			if _, exists := extDict[k]; !exists {
				extDict[k] = v
			}
		}
	}

	return merged
}

// loadI18nData 加载 i18n 数据（已由 ensureI18nFile 合并并写回外部文件）
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

	embedded := loadEmbeddedI18n()
	data := embedded

	// 尝试加载外部文件（ensureI18nFile 已经做过合并）
	externalPath := i18nFilePath()
	if externalBytes, err := os.ReadFile(externalPath); err == nil {
		var external I18nData
		if json.Unmarshal(externalBytes, &external) == nil && external.Languages != nil {
			data = &external
		}
	}

	cachedI18n = data
	return data
}

// ensureI18nFile 启动时调用：确保外部 i18n.json 存在并与内嵌版本合并
// - 外部文件不存在：解压内嵌版本
// - 外部文件存在：以内嵌为基准补齐缺失的语言和键（不覆盖已有值），写回外部文件
func ensureI18nFile() {
	embedded := loadEmbeddedI18n()
	externalPath := i18nFilePath()

	if _, err := os.Stat(externalPath); err != nil {
		// 首次启动：直接解压内嵌版本
		embeddedBytes, _ := embeddedI18nFS.ReadFile("i18n.json")
		_ = os.MkdirAll(settingsDir(), 0755)
		_ = os.WriteFile(externalPath, embeddedBytes, 0644)
		return
	}

	// 外部文件已存在：加载并合并
	externalBytes, err := os.ReadFile(externalPath)
	if err != nil {
		return
	}
	var external I18nData
	if json.Unmarshal(externalBytes, &external) != nil {
		// 外部文件损坏：回退为内嵌版本
		embeddedBytes, _ := embeddedI18nFS.ReadFile("i18n.json")
		_ = os.WriteFile(externalPath, embeddedBytes, 0644)
		return
	}

	merged := mergeI18n(embedded, &external)

	// 写回外部文件（仅在内容有变化时写入，避免每次启动都改文件时间）
	if mergedBytes, err := json.MarshalIndent(merged, "", "  "); err == nil {
		// 简单对比：合并后字节数与原文件不同就写回
		// （更精确的对比需要反序列化后逐项比较，这里用字节数近似）
		if len(mergedBytes) != len(externalBytes) {
			_ = os.WriteFile(externalPath, mergedBytes, 0644)
		} else {
			// 字节数相同也可能内容有差异（键顺序），做一次序列化对比
			reExternal, _ := json.MarshalIndent(&external, "", "  ")
			if string(reExternal) != string(mergedBytes) {
				_ = os.WriteFile(externalPath, mergedBytes, 0644)
			}
		}
	}
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
		SelectMusicFile:  get("backend.selectMusicFile", "选择音乐文件"),
		ExportSettings:   get("backend.exportSettings", "导出 MusicLite 设置"),
		ImportSettings:   get("backend.importSettings", "导入 MusicLite 设置"),
		MusicFileFilter:  get("backend.musicFileFilter", "Music File (*.mp3, *.ogg, *.flac, *.wav, *.ape)"),
		SettingsFilter:   get("backend.settingsFilter", "MusicLite 设置包 (*.msclte.zip)"),
		TrayShow:         get("backend.trayShow", "显示主窗口"),
		TrayPlayPause:    get("backend.trayPlayPause", "播放/暂停"),
		TrayQuit:         get("backend.trayQuit", "退出"),
		TrayTooltip:      get("backend.trayTooltip", "MusicLite"),
		PickImageFile:    get("backend.pickImageFile", "选择封面图片"),
		PickLyricsFile:   get("backend.pickLyricsFile", "选择歌词文件"),
		ImageFileFilter:  get("backend.imageFileFilter", "Image Files (*.png, *.jpg, *.jpeg, *.gif, *.bmp, *.webp)"),
		LyricsFileFilter: get("backend.lyricsFileFilter", "Lyrics Files (*.lrc, *.txt)"),
	}
}
