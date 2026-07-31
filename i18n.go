package main

// ============ 后端 i18n：对话框标题等后端文案 ============
//
// 前端 i18n 在 frontend/src/js/i18n.js 中实现，后端只需翻译对话框标题等少量文案。
// 语言从 Settings.Language 字段获取。

// 后端翻译条目
type backendStrings struct {
	SelectMusicFile   string // "选择音乐文件"
	ExportSettings    string // "导出 MusicLite 设置"
	ImportSettings    string // "导入 MusicLite 设置"
	MusicFileFilter   string // "Music File (*.mp3, *.ogg, *.flac, *.wav, *.ape)"
	SettingsFilter    string // "MusicLite 设置包 (*.msclte.zip)"
	TrayShow          string // "显示主窗口"
	TrayPlayPause     string // "播放/暂停"
	TrayQuit          string // "退出"
	TrayTooltip       string // "MusicLite - 轻量级音乐播放器"
}

// 后端翻译词典
var backendTranslations = map[string]backendStrings{
	"zh-CN": {
		SelectMusicFile: "选择音乐文件",
		ExportSettings:  "导出 MusicLite 设置",
		ImportSettings:  "导入 MusicLite 设置",
		MusicFileFilter: "Music File (*.mp3, *.ogg, *.flac, *.wav, *.ape)",
		SettingsFilter:  "MusicLite 设置包 (*.msclte.zip)",
		TrayShow:        "显示主窗口",
		TrayPlayPause:   "播放/暂停",
		TrayQuit:        "退出",
		TrayTooltip:     "MusicLite - 轻量级音乐播放器",
	},
	"en": {
		SelectMusicFile: "Select Music Files",
		ExportSettings:  "Export MusicLite Settings",
		ImportSettings:  "Import MusicLite Settings",
		MusicFileFilter: "Music File (*.mp3, *.ogg, *.flac, *.wav, *.ape)",
		SettingsFilter:  "MusicLite Settings Package (*.msclte.zip)",
		TrayShow:        "Show Window",
		TrayPlayPause:   "Play/Pause",
		TrayQuit:        "Quit",
		TrayTooltip:     "MusicLite - Lightweight Music Player",
	},
}

// getBackendStrings 根据当前设置的语言返回后端文案
func (a *App) getBackendStrings() backendStrings {
	s := a.LoadSettings()
	lang := s.Language
	if lang == "" {
		lang = "zh-CN"
	}
	if strs, ok := backendTranslations[lang]; ok {
		return strs
	}
	return backendTranslations["zh-CN"]
}
