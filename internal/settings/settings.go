package settings

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"

	"MusicLite/internal/platform"
)

// HotkeyConfig 单个快捷键配置。
type HotkeyConfig struct {
	Enabled bool   `json:"enabled"`
	Keys    string `json:"keys"`
}

// Settings 应用设置结构体。
type Settings struct {
	Theme          string `json:"theme"`
	PlayerFont     string `json:"player_font"`
	LyricsFont     string `json:"lyrics_font"`
	UIScale        int    `json:"ui_scale"`
	LyricsScale    int    `json:"lyrics_scale"`
	LastTrackID    int64  `json:"last_track_id"`
	LastPosition   int64  `json:"last_position"`
	Volume         int    `json:"volume"`
	AccentColor    string `json:"accent_color"`
	Language       string `json:"language"`
	LyricAnimation string `json:"lyric_animation"`
	ListMode       string `json:"list_mode"`
	AnimationLevel int    `json:"animation_level"`
	VolumeMode     string `json:"volume_mode"`
	MaxLyricLines  int    `json:"max_lyric_lines"`
	SortMode       string `json:"sort_mode"`

	BgType          string  `json:"bg_type"`
	BgURL           string  `json:"bg_url"`
	BgFit           string  `json:"bg_fit"`
	BgOpacity       float64 `json:"bg_opacity"`
	BgOverlay       float64 `json:"bg_overlay"`
	BgBlur          int     `json:"bg_blur"`
	BgLoop          bool    `json:"bg_loop"`
	BgMuted         bool    `json:"bg_muted"`
	BgGlassDisabled bool    `json:"bg_glass_disabled"`
	WindowAlpha     float64 `json:"window_alpha"`
	AeroBlur        int     `json:"aero_blur"`
	PlayerBgBlur    int     `json:"player_bg_blur"`

	DesignRadius   float64 `json:"design_radius"`
	DesignBlur     int     `json:"design_blur"`
	DesignAnimMult float64 `json:"design_anim_mult"`
	DesignShadow   float64 `json:"design_shadow"`
	DesignGlow     float64 `json:"design_glow"`
	DesignTextGlow float64 `json:"design_text_glow"`
	TitlebarText   string  `json:"titlebar_text"`

	NewUIEnabled bool `json:"new_ui_enabled"`
	OnlyMode     bool `json:"only_mode"`

	// CustomThemeMode 自定义主题色使用的明暗基调：dark / light
	CustomThemeMode string `json:"custom_theme_mode"`

	I18nAutoAction        string `json:"i18n_auto_action"`
	I18nAutoCleanObsolete bool   `json:"i18n_auto_clean_obsolete"`

	UpdateThreadCount   int                  `json:"update_thread_count"`
	UpdateDownloadState *UpdateDownloadState `json:"update_download_state,omitempty"`
	UpdateProxyMode     string               `json:"update_proxy_mode"`
	GhProxyURL          string               `json:"gh_proxy_url"`

	HotkeyPlayPause HotkeyConfig `json:"hotkey_playpause"`
	HotkeyNext      HotkeyConfig `json:"hotkey_next"`
	HotkeyPrev      HotkeyConfig `json:"hotkey_prev"`
}

// UpdateDownloadState 持久化的更新下载状态（为后续更新模块保留字段）。
type UpdateDownloadState struct {
	URL          string `json:"url"`
	FileName     string `json:"fileName"`
	OutputPath   string `json:"outputPath"`
	LatestVer    string `json:"latestVer"`
	FileSize     int64  `json:"fileSize"`
	Downloaded   int64  `json:"downloaded"`
	Status       string `json:"status"`
	ErrorMessage string `json:"errorMessage,omitempty"`
}

// DefaultSettings 返回默认设置。
func DefaultSettings() Settings {
	return Settings{
		Theme:             "dark",
		PlayerFont:        "system-ui",
		LyricsFont:        "Consolas, Monaco, monospace",
		UIScale:           135,
		LyricsScale:       135,
		Volume:            70,
		AccentColor:       "#1DB954",
		Language:          "zh-CN",
		LyricAnimation:    "fade",
		ListMode:          "card",
		AnimationLevel:    2,
		VolumeMode:        "synth",
		MaxLyricLines:     1,
		SortMode:          "recent",
		BgType:            "none",
		BgFit:             "cover",
		BgOpacity:         0.9,
		BgOverlay:         0.2,
		BgLoop:            true,
		BgMuted:           true,
		WindowAlpha:       1.0,
		PlayerBgBlur:      20,
		DesignRadius:      10,
		DesignBlur:        16,
		DesignAnimMult:    1.0,
		DesignShadow:      0.45,
		DesignGlow:        0.35,
		TitlebarText:      "MusicLite Cuckoo",
		UpdateThreadCount: 16,
		UpdateProxyMode:   "official",
		GhProxyURL:        "https://v6.gh-proxy.org/",
		CustomThemeMode:   "dark",
	}
}

// Store 负责 settings.json 的读写。
type Store struct {
	path string
}

func NewStore() *Store {
	return &Store{path: filepath.Join(platform.AppDataDir(), "settings.json")}
}

func NewStoreAt(path string) *Store {
	return &Store{path: path}
}

func (s *Store) Path() string {
	return s.path
}

func (s *Store) Dir() string {
	return filepath.Dir(s.path)
}

// InitLanguageForFirstRun 首次启动（settings.json 尚不存在）时，
// 按系统语言写入默认界面语言：zh-* 使用简体中文，其余语言使用英文。
func (s *Store) InitLanguageForFirstRun() {
	if _, err := os.Stat(s.path); err == nil {
		return
	}
	cfg := DefaultSettings()
	cfg.Language = platform.SystemLanguage()
	_ = s.Save(cfg)
}

// Load 加载设置；文件缺失或损坏时返回默认设置，并做旧字段迁移。
func (s *Store) Load() Settings {
	data, err := os.ReadFile(s.path)
	if err != nil {
		return DefaultSettings()
	}

	var out Settings
	if err := json.Unmarshal(data, &out); err != nil {
		return DefaultSettings()
	}

	def := DefaultSettings()
	if out.Language == "" {
		out.Language = def.Language
	}
	if out.LyricAnimation == "" {
		out.LyricAnimation = def.LyricAnimation
	}

	// 旧字段 enable_animations → animation_level
	{
		hasNew := false
		var raw map[string]json.RawMessage
		if json.Unmarshal(data, &raw) == nil {
			_, hasNew = raw["animation_level"]
		}
		if !hasNew {
			type legacyAnim struct {
				EnableAnimations *bool `json:"enable_animations"`
			}
			var leg legacyAnim
			if json.Unmarshal(data, &leg) == nil && leg.EnableAnimations != nil {
				if !*leg.EnableAnimations {
					out.AnimationLevel = 0
				} else {
					out.AnimationLevel = 2
				}
			} else {
				out.AnimationLevel = def.AnimationLevel
			}
		}
		if out.AnimationLevel < 0 || out.AnimationLevel > 3 {
			out.AnimationLevel = def.AnimationLevel
		}
	}

	// 旧字段 base_font_size / lyrics_font_size → ui_scale / lyrics_scale
	if out.UIScale == 0 {
		type legacy struct {
			BaseFontSize int `json:"base_font_size"`
		}
		var leg legacy
		if json.Unmarshal(data, &leg) == nil && leg.BaseFontSize > 0 {
			out.UIScale = leg.BaseFontSize * 100 / 14
			if out.UIScale < 20 {
				out.UIScale = 20
			}
			if out.UIScale > 500 {
				out.UIScale = 500
			}
		} else {
			out.UIScale = def.UIScale
		}
	}
	if out.LyricsScale == 0 {
		type legacy struct {
			LyricsFontSize int `json:"lyrics_font_size"`
		}
		var leg legacy
		if json.Unmarshal(data, &leg) == nil && leg.LyricsFontSize > 0 {
			out.LyricsScale = leg.LyricsFontSize * 100 / 16
			if out.LyricsScale < 20 {
				out.LyricsScale = 20
			}
			if out.LyricsScale > 500 {
				out.LyricsScale = 500
			}
		} else {
			out.LyricsScale = def.LyricsScale
		}
	}

	if out.VolumeMode != "master" && out.VolumeMode != "synth" {
		out.VolumeMode = def.VolumeMode
	}
	if out.CustomThemeMode != "light" && out.CustomThemeMode != "dark" {
		out.CustomThemeMode = def.CustomThemeMode
	}
	if out.MaxLyricLines < 1 {
		out.MaxLyricLines = def.MaxLyricLines
	}
	if out.MaxLyricLines > 10 {
		out.MaxLyricLines = 10
	}
	if out.SortMode != "recent" && out.SortMode != "title" && out.SortMode != "artist" {
		out.SortMode = def.SortMode
	}

	// 设计令牌：用 raw map 判断字段是否存在，避免把用户主动设为 0 误判为缺失。
	{
		var raw map[string]json.RawMessage
		_ = json.Unmarshal(data, &raw)
		has := func(key string) bool { _, ok := raw[key]; return ok }

		if !has("design_radius") {
			out.DesignRadius = def.DesignRadius
		} else if out.DesignRadius < 0 || out.DesignRadius > 28 {
			out.DesignRadius = def.DesignRadius
		}
		if !has("design_blur") {
			out.DesignBlur = def.DesignBlur
		} else if out.DesignBlur < 0 || out.DesignBlur > 40 {
			out.DesignBlur = def.DesignBlur
		}
		if !has("design_anim_mult") {
			out.DesignAnimMult = def.DesignAnimMult
		} else if out.DesignAnimMult < 0.3 || out.DesignAnimMult > 2.5 {
			out.DesignAnimMult = def.DesignAnimMult
		}
		if !has("design_shadow") {
			out.DesignShadow = def.DesignShadow
		} else if out.DesignShadow < 0 || out.DesignShadow > 1 {
			out.DesignShadow = def.DesignShadow
		}
		if !has("design_glow") {
			out.DesignGlow = def.DesignGlow
		} else if out.DesignGlow < 0 || out.DesignGlow > 1 {
			out.DesignGlow = def.DesignGlow
		}
		if !has("design_text_glow") {
			out.DesignTextGlow = def.DesignTextGlow
		} else if out.DesignTextGlow < 0 || out.DesignTextGlow > 1 {
			out.DesignTextGlow = def.DesignTextGlow
		}
	}

	// 背景字段兼容旧版设置文件。
	{
		var raw map[string]json.RawMessage
		_ = json.Unmarshal(data, &raw)
		has := func(key string) bool { _, ok := raw[key]; return ok }

		if !has("bg_type") {
			out.BgType = def.BgType
		} else if out.BgType != "none" && out.BgType != "image" && out.BgType != "video" {
			out.BgType = def.BgType
		}
		if !has("bg_url") {
			out.BgURL = def.BgURL
		}
		if !has("bg_fit") {
			out.BgFit = def.BgFit
		} else if out.BgFit != "cover" && out.BgFit != "contain" && out.BgFit != "fill" && out.BgFit != "none" && out.BgFit != "scaledown" {
			out.BgFit = def.BgFit
		}
		if !has("bg_opacity") {
			out.BgOpacity = def.BgOpacity
		} else if out.BgOpacity < 0 || out.BgOpacity > 1 {
			out.BgOpacity = def.BgOpacity
		}
		if !has("bg_overlay") {
			out.BgOverlay = def.BgOverlay
		} else if out.BgOverlay < 0 || out.BgOverlay > 1 {
			out.BgOverlay = def.BgOverlay
		}
		if !has("bg_blur") {
			out.BgBlur = def.BgBlur
		} else if out.BgBlur < 0 || out.BgBlur > 30 {
			out.BgBlur = def.BgBlur
		}
		if !has("bg_loop") {
			out.BgLoop = def.BgLoop
		}
		if !has("bg_muted") {
			out.BgMuted = def.BgMuted
		}
		if !has("bg_glass_disabled") {
			out.BgGlassDisabled = def.BgGlassDisabled
		}
		if !has("window_alpha") {
			out.WindowAlpha = def.WindowAlpha
		} else if out.WindowAlpha < 0.01 || out.WindowAlpha > 1.0 {
			out.WindowAlpha = def.WindowAlpha
		}
		if !has("aero_blur") {
			out.AeroBlur = def.AeroBlur
		} else if out.AeroBlur < 0 || out.AeroBlur > 40 {
			out.AeroBlur = def.AeroBlur
		}
		if !has("player_bg_blur") {
			out.PlayerBgBlur = def.PlayerBgBlur
		} else if out.PlayerBgBlur < 0 || out.PlayerBgBlur > 30 {
			out.PlayerBgBlur = def.PlayerBgBlur
		}
	}

	// 更新代理字段规范化。
	{
		mode := strings.ToLower(strings.TrimSpace(out.UpdateProxyMode))
		if mode != "official" && mode != "ghproxy" {
			mode = def.UpdateProxyMode
		}
		out.UpdateProxyMode = mode

		url := strings.TrimSpace(out.GhProxyURL)
		if url == "" {
			url = def.GhProxyURL
		}
		if !strings.HasSuffix(url, "/") {
			url += "/"
		}
		out.GhProxyURL = url

		if out.UpdateProxyMode == "ghproxy" && out.UpdateThreadCount > 16 {
			out.UpdateThreadCount = 16
		}
		if out.UpdateThreadCount < 1 {
			out.UpdateThreadCount = 1
		} else if out.UpdateThreadCount > 256 {
			out.UpdateThreadCount = 256
		}
	}

	return out
}

// Save 持久化设置。
func (s *Store) Save(v Settings) error {
	data, err := json.MarshalIndent(v, "", "  ")
	if err != nil {
		return err
	}
	if err := os.MkdirAll(s.Dir(), 0o755); err != nil {
		return err
	}
	return os.WriteFile(s.path, data, 0o644)
}
