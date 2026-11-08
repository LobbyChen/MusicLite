package i18n

import (
	"embed"
	"encoding/json"
	"os"
	"path/filepath"
	"sync"
)

//go:embed i18n.json
var embeddedFS embed.FS

// I18nData 统一翻译数据结构（前后端共享）。
type I18nData struct {
	Version   int                          `json:"version"`
	Languages map[string]map[string]string `json:"languages"`
}

// LangKeyDiff 单个语言的键差异。
type LangKeyDiff struct {
	LangCode     string   `json:"lang_code"`
	LangNative   string   `json:"lang_native"`
	NewKeys      []string `json:"new_keys"`
	ChangedKeys  []string `json:"changed_keys"`
	ObsoleteKeys []string `json:"obsolete_keys"`
}

// I18nNewKeysReport 返回给前端的差异报告。
type I18nNewKeysReport struct {
	HasNew        bool          `json:"has_new"`
	TotalNew      int           `json:"total_new"`
	TotalChg      int           `json:"total_chg"`
	TotalObsolete int           `json:"total_obsolete"`
	NewLangs      []string      `json:"new_langs"`
	Diffs         []LangKeyDiff `json:"diffs"`
}

// I18nMergeResult 合并执行结果。
type I18nMergeResult struct {
	OK      bool   `json:"ok"`
	Message string `json:"message"`
}

// BackendStrings 后端使用的文案子集。
type BackendStrings struct {
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

// Manager 管理内嵌与外部 i18n.json。
type Manager struct {
	dir    string
	mu     sync.RWMutex
	cached *I18nData
}

func NewManager(dir string) *Manager {
	return &Manager{dir: dir}
}

func (m *Manager) filePath() string {
	return filepath.Join(m.dir, "i18n.json")
}

func (m *Manager) loadEmbedded() *I18nData {
	data := &I18nData{Languages: map[string]map[string]string{}}
	if b, err := embeddedFS.ReadFile("i18n.json"); err == nil {
		_ = json.Unmarshal(b, data)
	}
	if data.Languages == nil {
		data.Languages = map[string]map[string]string{}
	}
	return data
}

func (m *Manager) loadExternal() *I18nData {
	b, err := os.ReadFile(m.filePath())
	if err != nil {
		return nil
	}
	var d I18nData
	if json.Unmarshal(b, &d) != nil || d.Languages == nil {
		return nil
	}
	return &d
}

// EnsureFile 首次启动时把内嵌 i18n.json 解压到用户数据目录。
func (m *Manager) EnsureFile() {
	if _, err := os.Stat(m.filePath()); err == nil {
		return
	}
	b, err := embeddedFS.ReadFile("i18n.json")
	if err != nil {
		return
	}
	_ = os.MkdirAll(m.dir, 0o755)
	_ = os.WriteFile(m.filePath(), b, 0o644)
}

// Data 返回当前翻译数据（优先外部文件）。
func (m *Manager) Data() I18nData {
	m.mu.RLock()
	if m.cached != nil {
		v := *m.cached
		m.mu.RUnlock()
		return v
	}
	m.mu.RUnlock()

	m.mu.Lock()
	defer m.mu.Unlock()
	if m.cached != nil {
		return *m.cached
	}
	data := m.loadEmbedded()
	if ext := m.loadExternal(); ext != nil {
		data = ext
	}
	m.cached = data
	return *data
}

// Invalidate 清空缓存，合并写回后调用。
func (m *Manager) Invalidate() {
	m.mu.Lock()
	m.cached = nil
	m.mu.Unlock()
}

// CheckNewKeys 比较内嵌版本与外部文件差异。
func (m *Manager) CheckNewKeys() I18nNewKeysReport {
	emb := m.loadEmbedded()
	ext := m.loadExternal()
	return diffI18n(emb, ext)
}

// ConfirmMerge 按用户选择合并并写回外部文件。
func (m *Manager) ConfirmMerge(keepCustom, removeObsolete bool) I18nMergeResult {
	emb := m.loadEmbedded()
	ext := m.loadExternal()

	if ext == nil {
		b, err := embeddedFS.ReadFile("i18n.json")
		if err != nil {
			return I18nMergeResult{OK: false, Message: "Failed to read embedded i18n.json"}
		}
		_ = os.MkdirAll(m.dir, 0o755)
		if err := os.WriteFile(m.filePath(), b, 0o644); err != nil {
			return I18nMergeResult{OK: false, Message: "Failed to write i18n.json: " + err.Error()}
		}
		m.Invalidate()
		return I18nMergeResult{OK: true, Message: "Embedded i18n written."}
	}

	merged := mergeI18n(emb, ext, keepCustom, removeObsolete)
	b, err := json.MarshalIndent(merged, "", "  ")
	if err != nil {
		return I18nMergeResult{OK: false, Message: "Marshal failed: " + err.Error()}
	}
	if err := os.WriteFile(m.filePath(), b, 0o644); err != nil {
		return I18nMergeResult{OK: false, Message: "Write failed: " + err.Error()}
	}
	m.Invalidate()
	return I18nMergeResult{OK: true, Message: "Merged successfully."}
}

// BackendStrings 返回后端所需文案。
func (m *Manager) BackendStrings(lang string) BackendStrings {
	data := m.Data()
	if lang == "" {
		lang = "zh-CN"
	}
	dict, ok := data.Languages[lang]
	if !ok {
		dict = data.Languages["zh-CN"]
	}
	get := func(key, fallback string) string {
		if v, ok := dict[key]; ok && v != "" {
			return v
		}
		return fallback
	}
	return BackendStrings{
		SelectMusicFile:  get("backend.selectMusicFile", "选择音乐文件"),
		ExportSettings:   get("backend.exportSettings", "导出 MusicLite 设置"),
		ImportSettings:   get("backend.importSettings", "导入 MusicLite 设置"),
		MusicFileFilter:  get("backend.musicFileFilter", "音频文件"),
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

func mergeI18n(embedded, external *I18nData, keepCustom, removeObsolete bool) *I18nData {
	if external == nil || external.Languages == nil {
		return embedded
	}
	merged := &I18nData{Version: embedded.Version, Languages: map[string]map[string]string{}}
	if external.Version > merged.Version {
		merged.Version = external.Version
	}
	for lang, dict := range external.Languages {
		copied := map[string]string{}
		for k, v := range dict {
			copied[k] = v
		}
		merged.Languages[lang] = copied
	}
	for lang, embDict := range embedded.Languages {
		extDict, ok := merged.Languages[lang]
		if !ok {
			copied := map[string]string{}
			for k, v := range embDict {
				copied[k] = v
			}
			merged.Languages[lang] = copied
			continue
		}
		for k, v := range embDict {
			existing, exists := extDict[k]
			if !exists {
				extDict[k] = v
			} else if !keepCustom && existing != v {
				extDict[k] = v
			}
		}
	}
	if removeObsolete {
		for lang, extDict := range merged.Languages {
			embDict, ok := embedded.Languages[lang]
			if !ok {
				continue
			}
			for k := range extDict {
				if _, exists := embDict[k]; !exists {
					delete(extDict, k)
				}
			}
		}
	}
	return merged
}

func diffI18n(embedded, external *I18nData) I18nNewKeysReport {
	rep := I18nNewKeysReport{Diffs: []LangKeyDiff{}}
	if embedded == nil || embedded.Languages == nil {
		return rep
	}
	langName := func(dict map[string]string, code string) string {
		if n, ok := dict["lang.name"]; ok && n != "" {
			return n
		}
		return code
	}
	var extLangs map[string]map[string]string
	if external != nil && external.Languages != nil {
		extLangs = external.Languages
	}
	for code := range embedded.Languages {
		if extLangs == nil {
			rep.NewLangs = append(rep.NewLangs, code)
			continue
		}
		if _, ok := extLangs[code]; !ok {
			rep.NewLangs = append(rep.NewLangs, code)
		}
	}
	for code, embDict := range embedded.Languages {
		extDict, ok := extLangs[code]
		if !ok {
			newKeys := make([]string, 0, len(embDict))
			for k := range embDict {
				newKeys = append(newKeys, k)
			}
			rep.TotalNew += len(newKeys)
			rep.Diffs = append(rep.Diffs, LangKeyDiff{
				LangCode:   code,
				LangNative: langName(embDict, code),
				NewKeys:    newKeys,
			})
			continue
		}
		var newKeys, chgKeys, obsoleteKeys []string
		for k, v := range embDict {
			ev, exists := extDict[k]
			if !exists {
				newKeys = append(newKeys, k)
			} else if ev != v {
				chgKeys = append(chgKeys, k)
			}
		}
		for k := range extDict {
			if _, exists := embDict[k]; !exists {
				obsoleteKeys = append(obsoleteKeys, k)
			}
		}
		if len(newKeys) > 0 || len(chgKeys) > 0 || len(obsoleteKeys) > 0 {
			rep.TotalNew += len(newKeys)
			rep.TotalChg += len(chgKeys)
			rep.TotalObsolete += len(obsoleteKeys)
			rep.Diffs = append(rep.Diffs, LangKeyDiff{
				LangCode:     code,
				LangNative:   langName(extDict, code),
				NewKeys:      newKeys,
				ChangedKeys:  chgKeys,
				ObsoleteKeys: obsoleteKeys,
			})
		}
	}
	rep.HasNew = len(rep.NewLangs) > 0 || rep.TotalNew > 0 || rep.TotalChg > 0 || rep.TotalObsolete > 0
	return rep
}
