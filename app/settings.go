package app

import (
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
)

// Settings 应用设置结构体
type Settings struct {
	Theme          string `json:"theme"`           // "dark" | "light" | "accent" | "custom"
	PlayerFont     string `json:"player_font"`     // 播放器字体
	LyricsFont     string `json:"lyrics_font"`     // 歌词字体
	UIScale        int    `json:"ui_scale"`        // 界面缩放比例 (20-500)，默认 100
	LyricsScale    int    `json:"lyrics_scale"`    // 歌词缩放比例 (20-500)，默认 100
	LastTrackID    int64  `json:"last_track_id"`   // 上次播放的曲目ID
	LastPosition   int64  `json:"last_position"`   // 上次播放位置（秒）
	Volume         int    `json:"volume"`          // 音量 0-100
	AccentColor    string `json:"accent_color"`    // 自定义主题色（十六进制，如 #1DB954）
	Language       string `json:"language"`        // 界面语言："zh-CN" | "en"
	LyricAnimation string `json:"lyric_animation"` // 全屏歌词切换动画："fade" | "slide-up" | "slide-left" | "zoom" | "none"
	ListMode       string `json:"list_mode"`       // 音乐库列表模式："card" | "list"
	AnimationLevel int    `json:"animation_level"` // 界面动画级别：0=无 1=基础 2=增强(默认) 3=华丽
	VolumeMode     string `json:"volume_mode"`     // 音量模式："synth"（合成器，默认）| "master"（系统主音量）
	MaxLyricLines  int    `json:"max_lyric_lines"` // 同一时间戳最多允许同时显示歌词行数（1-10，默认1）
	SortMode       string `json:"sort_mode"`       // 音乐库排序方式："recent"（默认）| "title" | "artist"
	// 背景（全页面生效：图片或视频）
	BgType          string  `json:"bg_type"`           // "none" | "image" | "video"
	BgURL           string  `json:"bg_url"`            // 图片为 dataURL；视频为本地绝对文件路径（file:// 或纯路径）
	BgFit           string  `json:"bg_fit"`            // "cover" 铺满全屏 | "contain" 完整显示 | "fill" 拉伸填满 | "none" 原尺寸居中 | "scaledown" 智能缩放
	BgOpacity       float64 `json:"bg_opacity"`        // 背景不透明度 0-1，默认 0.9
	BgOverlay       float64 `json:"bg_overlay"`        // 前景遮罩（暗/浅色）强度 0-1，默认 0.2（提高文字对比度）
	BgBlur          int     `json:"bg_blur"`           // 背景模糊程度 0-30（像素），默认 0
	BgLoop          bool    `json:"bg_loop"`           // 视频是否循环（默认 true）
	BgMuted         bool    `json:"bg_muted"`          // 视频是否静音（默认 true，推荐开启避免干扰）
	BgGlassDisabled bool    `json:"bg_glass_disabled"` // 有背景时关闭所有容器毛玻璃（backdrop-filter）效果，避免边界与撕裂
	WindowAlpha     float64 `json:"window_alpha"`      // 整窗透明度 0.01-1.0，默认 1；对桌面透出实现 Aero 效果
	AeroBlur        int     `json:"aero_blur"`         // Aero 透明模式下的背景模糊量（px，0-40，默认 0）；0=关闭模糊
	// 设计令牌（设计器实时调整，持久化到 settings.json）
	DesignRadius     float64 `json:"design_radius"`      // 圆角（px，0-28，默认 10）
	DesignBlur       int     `json:"design_blur"`        // 毛玻璃模糊量（px，0-40，默认 16）
	DesignAnimMult   float64 `json:"design_anim_mult"`   // 动画速度倍率（0.3-2.5，默认 1.0）
	DesignShadow     float64 `json:"design_shadow"`      // 浮层阴影强度（0-1，默认 0.45）
	DesignGlow       float64 `json:"design_glow"`        // 主题色辉光范围（0-1，默认 0.35）
	DesignTextGlow   float64 `json:"design_text_glow"`   // 字体晕影强度（0-1，默认 0）
	TitlebarText     string  `json:"titlebar_text"`      // 自定义标题栏文字（空则使用默认 "MusicLite Cuckoo"）
	SmartEQEnabled   bool    `json:"smart_eq_enabled"`   // 智能均衡器开关
	SmartEQIntensity float64 `json:"smart_eq_intensity"` // 智能均衡器补偿强度 0-1
	// 设置界面布局与新 UI
	SettingsLayout string `json:"settings_layout"` // 设置界面布局："scroll"（默认）| "columns" | "tabs"
	NewUIEnabled   bool   `json:"new_ui_enabled"`  // 新风格 UI 开关
	VoidMode       bool   `json:"void_mode"`       // 虚空模式：界面颠倒 + 全黑 + 鼠标手电筒（需自行寻找退出按钮）
	// 全局快捷键（3 个）
	HotkeyPlayPause HotkeyConfig `json:"hotkey_playpause"` // 播放 / 暂停切换
	HotkeyNext      HotkeyConfig `json:"hotkey_next"`      // 下一曲
	HotkeyPrev      HotkeyConfig `json:"hotkey_prev"`      // 上一曲
}

// DefaultSettings 返回默认设置
func DefaultSettings() Settings {
	return Settings{
		Theme:            "dark",
		PlayerFont:       "system-ui",
		LyricsFont:       "Consolas, Monaco, monospace",
		UIScale:          135,
		LyricsScale:      135,
		LastTrackID:      0,
		LastPosition:     0,
		Volume:           70,
		AccentColor:      "#1DB954",
		Language:         "zh-CN",
		LyricAnimation:   "fade",
		ListMode:         "card",
		AnimationLevel:   2,
		VolumeMode:       "synth",
		MaxLyricLines:    1,
		SortMode:         "recent",
		BgType:           "none",
		BgURL:            "",
		BgFit:            "cover",
		BgOpacity:        0.9,
		BgOverlay:        0.2,
		BgBlur:           0,
		BgLoop:           true,
		BgMuted:          true,
		BgGlassDisabled:  false,
		WindowAlpha:      1.0,
		AeroBlur:         0,
		DesignRadius:     10,
		DesignBlur:       16,
		DesignAnimMult:   1.0,
		DesignShadow:     0.45,
		DesignGlow:       0.35,
		DesignTextGlow:   0,
		TitlebarText:     "MusicLite Cuckoo",
		SmartEQEnabled:   false,
		SmartEQIntensity: 0.7,
		SettingsLayout:   "scroll",
		NewUIEnabled:     false,
		HotkeyPlayPause:  HotkeyConfig{Enabled: false, Keys: ""},
		HotkeyNext:       HotkeyConfig{Enabled: false, Keys: ""},
		HotkeyPrev:       HotkeyConfig{Enabled: false, Keys: ""},
	}
}

// settingsFilePath 返回设置文件路径（跨平台用户数据目录/MusicLite/settings.json）
func settingsFilePath() string {
	dir := filepath.Join(getUserDataDir(), "MusicLite")
	os.MkdirAll(dir, 0755)
	return filepath.Join(dir, "settings.json")
}

// settingsDir 返回设置文件所在目录（跨平台用户数据目录/MusicLite）
func settingsDir() string {
	return filepath.Dir(settingsFilePath())
}

// LoadSettings 加载设置（文件不存在则返回默认设置）
func (a *MusicService) LoadSettings() Settings {
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
	if s.LyricAnimation == "" {
		s.LyricAnimation = def.LyricAnimation
	}
	// 兼容旧版设置：
	// - 旧字段 enable_animations:false → animation_level:0（无动画）
	// - 旧字段 enable_animations:true / 缺失 → animation_level:2（增强，默认）
	// - 新字段 animation_level 已存在且值合法（0-3）→ 直接采用
	{
		hasNew := false
		var raw map[string]json.RawMessage
		if json.Unmarshal(data, &raw) == nil {
			if _, ok := raw["animation_level"]; ok {
				hasNew = true
			}
		}
		if !hasNew {
			// 迁移旧字段 enable_animations
			type legacyAnim struct {
				EnableAnimations *bool `json:"enable_animations"`
			}
			var leg legacyAnim
			if json.Unmarshal(data, &leg) == nil && leg.EnableAnimations != nil {
				if !*leg.EnableAnimations {
					s.AnimationLevel = 0
				} else {
					s.AnimationLevel = 2
				}
			} else {
				s.AnimationLevel = def.AnimationLevel
			}
		}
		// 边界校验
		if s.AnimationLevel < 0 || s.AnimationLevel > 3 {
			s.AnimationLevel = def.AnimationLevel
		}
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

	// VolumeMode 兼容旧版（缺失时默认 "synth"）
	if s.VolumeMode != "master" && s.VolumeMode != "synth" {
		s.VolumeMode = def.VolumeMode
	}
	// MaxLyricLines 兼容旧版设置文件（缺失时用默认值）
	if s.MaxLyricLines < 1 {
		s.MaxLyricLines = def.MaxLyricLines
	}
	if s.MaxLyricLines > 10 {
		s.MaxLyricLines = 10
	}
	// SortMode 兼容旧版设置文件（缺失或非法时用默认值 "recent"）
	if s.SortMode != "recent" && s.SortMode != "title" && s.SortMode != "artist" {
		s.SortMode = def.SortMode
	}
	// SmartEQ 兼容旧版设置文件（缺失时用默认值补齐，越界时钳制到合法范围）
	{
		var raw3 map[string]json.RawMessage
		_ = json.Unmarshal(data, &raw3)
		has3 := func(key string) bool { _, ok := raw3[key]; return ok }
		if !has3("smart_eq_enabled") {
			s.SmartEQEnabled = def.SmartEQEnabled
		}
		if !has3("smart_eq_intensity") {
			s.SmartEQIntensity = def.SmartEQIntensity
		} else if s.SmartEQIntensity < 0 || s.SmartEQIntensity > 1 {
			s.SmartEQIntensity = def.SmartEQIntensity
		}
	}
	// SettingsLayout / NewUIEnabled 兼容旧版设置文件
	{
		var raw4 map[string]json.RawMessage
		_ = json.Unmarshal(data, &raw4)
		has4 := func(key string) bool { _, ok := raw4[key]; return ok }
		if !has4("settings_layout") {
			s.SettingsLayout = def.SettingsLayout
		} else if s.SettingsLayout != "scroll" && s.SettingsLayout != "columns" && s.SettingsLayout != "tabs" {
			s.SettingsLayout = def.SettingsLayout
		}
		if !has4("new_ui_enabled") {
			s.NewUIEnabled = def.NewUIEnabled
		}
		if !has4("void_mode") {
			s.VoidMode = def.VoidMode
		}
	}
	// 设计令牌：兼容旧版设置文件（缺失时用默认值补齐，越界时钳制到合法范围）
	// 用 raw map 检测字段是否存在，避免把"用户主动设为 0"误判为缺失
	{
		var raw2 map[string]json.RawMessage
		_ = json.Unmarshal(data, &raw2)
		has := func(key string) bool { _, ok := raw2[key]; return ok }
		if !has("design_radius") {
			s.DesignRadius = def.DesignRadius
		} else if s.DesignRadius < 0 || s.DesignRadius > 28 {
			s.DesignRadius = def.DesignRadius
		}
		if !has("design_blur") {
			s.DesignBlur = def.DesignBlur
		} else if s.DesignBlur < 0 || s.DesignBlur > 40 {
			s.DesignBlur = def.DesignBlur
		}
		if !has("design_anim_mult") {
			s.DesignAnimMult = def.DesignAnimMult
		} else if s.DesignAnimMult < 0.3 || s.DesignAnimMult > 2.5 {
			s.DesignAnimMult = def.DesignAnimMult
		}
		if !has("design_shadow") {
			s.DesignShadow = def.DesignShadow
		} else if s.DesignShadow < 0 || s.DesignShadow > 1 {
			s.DesignShadow = def.DesignShadow
		}
		if !has("design_glow") {
			s.DesignGlow = def.DesignGlow
		} else if s.DesignGlow < 0 || s.DesignGlow > 1 {
			s.DesignGlow = def.DesignGlow
		}
		if !has("design_text_glow") {
			s.DesignTextGlow = def.DesignTextGlow
		} else if s.DesignTextGlow < 0 || s.DesignTextGlow > 1 {
			s.DesignTextGlow = def.DesignTextGlow
		}
	}
	// 背景字段兼容旧版设置文件（缺失时用默认值补齐，越界时钳制到合法范围）
	{
		var raw5 map[string]json.RawMessage
		_ = json.Unmarshal(data, &raw5)
		has5 := func(key string) bool { _, ok := raw5[key]; return ok }
		if !has5("bg_type") {
			s.BgType = def.BgType
		} else if s.BgType != "none" && s.BgType != "image" && s.BgType != "video" {
			s.BgType = def.BgType
		}
		if !has5("bg_url") {
			s.BgURL = def.BgURL
		}
		if !has5("bg_fit") {
			s.BgFit = def.BgFit
		} else if s.BgFit != "cover" && s.BgFit != "contain" && s.BgFit != "fill" && s.BgFit != "none" && s.BgFit != "scaledown" {
			s.BgFit = def.BgFit
		}
		if !has5("bg_opacity") {
			s.BgOpacity = def.BgOpacity
		} else if s.BgOpacity < 0 || s.BgOpacity > 1 {
			s.BgOpacity = def.BgOpacity
		}
		if !has5("bg_overlay") {
			s.BgOverlay = def.BgOverlay
		} else if s.BgOverlay < 0 || s.BgOverlay > 1 {
			s.BgOverlay = def.BgOverlay
		}
		if !has5("bg_blur") {
			s.BgBlur = def.BgBlur
		} else if s.BgBlur < 0 || s.BgBlur > 30 {
			s.BgBlur = def.BgBlur
		}
		if !has5("bg_loop") {
			s.BgLoop = def.BgLoop
		}
		if !has5("bg_muted") {
			s.BgMuted = def.BgMuted
		}
		if !has5("bg_glass_disabled") {
			s.BgGlassDisabled = def.BgGlassDisabled
		}
		if !has5("window_alpha") {
			s.WindowAlpha = def.WindowAlpha
		} else if s.WindowAlpha < 0.01 || s.WindowAlpha > 1.0 {
			s.WindowAlpha = def.WindowAlpha
		}
		if !has5("aero_blur") {
			s.AeroBlur = def.AeroBlur
		} else if s.AeroBlur < 0 || s.AeroBlur > 40 {
			s.AeroBlur = def.AeroBlur
		}
	}
	// SortMode 兼容旧版设置文件（缺失或非法时用默认值 "recent"，补充 album 模式）
	if s.SortMode != "recent" && s.SortMode != "title" && s.SortMode != "artist" && s.SortMode != "album" {
		s.SortMode = def.SortMode
	}

	return s
}

// SaveSettings 保存设置
func (a *MusicService) SaveSettings(s Settings) error {
	data, err := json.MarshalIndent(s, "", "  ")
	if err != nil {
		return err
	}
	if err := os.WriteFile(settingsFilePath(), data, 0644); err != nil {
		return err
	}
	// 同步全局快捷键配置到 HotkeyManager（无需重启 hook，热更新）
	if a.hotkeyManager != nil {
		a.hotkeyManager.UpdateConfig(s)
	}
	return nil
}

// ResetSettings 返回默认设置（不立即写盘，由前端再次调用 SaveSettings 持久化）
func (a *MusicService) ResetSettings() Settings {
	return DefaultSettings()
}

// GetVersionInfo 返回构建期注入的版本信息（version / commit / build number）
func (a *MusicService) GetVersionInfo() VersionInfo {
	return VersionInfo{
		Version:  Version,
		BuildSHA: BuildSHA,
		BuildNum: BuildNum,
	}
}

// OpenAppDataFolder 在系统文件管理器中打开程序数据文件夹（%APPDATA%/MusicLite）
func (a *MusicService) OpenAppDataFolder() error {
	dir := settingsDir()
	if err := os.MkdirAll(dir, 0755); err != nil {
		return err
	}
	switch runtime.GOOS {
	case "windows":
		return exec.Command("explorer.exe", dir).Start()
	case "darwin":
		return exec.Command("open", dir).Start()
	default:
		return exec.Command("xdg-open", dir).Start()
	}
}

// GitHubRepoURL 项目 GitHub 仓库地址
const GitHubRepoURL = "https://github.com/LobbyChen/MusicLite"

// OpenGitHubRepo 在系统默认浏览器中打开项目 GitHub 仓库页面
func (a *MusicService) OpenGitHubRepo() error {
	return openURL(GitHubRepoURL)
}

// openURL 跨平台在系统默认浏览器中打开指定 URL
func openURL(url string) error {
	switch runtime.GOOS {
	case "windows":
		return exec.Command("rundll32.exe", "url.dll,FileProtocolHandler", url).Start()
	case "darwin":
		return exec.Command("open", url).Start()
	default:
		return exec.Command("xdg-open", url).Start()
	}
}
