package app

// ============ 后端 i18n：统一文案加载机制 ============
//
// 初始 i18n.json 通过 go:embed 打包进二进制；首次启动时解压到
// %APPDATA%/MusicLite/i18n.json。
//
// 启动流程（用户确认合并模式）：
//   1. main.go 调用 EnsureI18nFile()：
//        - 外部文件不存在 → 直接解压内嵌版本（无需询问）
//        - 外部文件存在 → 只读取内容，不做任何合并或写回操作
//   2. 前端 DOM ready 后，调用 CheckI18nNewKeys()：
//        - 以内嵌为基准 vs 用户外部文件，统计"新增的语言/新增的键/值变更"，
//          按语言分组后把差异列表返回给前端
//        - 无差异 → 返回 has_new=false，前端不弹窗
//        - 有差异 → 返回 has_new=true + 差异摘要，前端弹确认框询问用户是否覆盖
//   3. 用户点击"是" → 前端调用 ConfirmI18nMerge(keepCustom=true)：
//        - keepCustom=true  → mergeI18n 策略：内嵌补齐缺失键，不覆盖用户已自定义的值
//        - 合并后写回外部文件，并使 Go 侧缓存失效，让下次 GetI18nData 读到最新数据
//   4. 前端完成合并后自行 reload 翻译（重新调 GetI18nData + applyTranslations）。
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
	Version   int                          `json:"version"`
	Languages map[string]map[string]string `json:"languages"`
}

// LangKeyDiff 单个语言的键差异
type LangKeyDiff struct {
	LangCode     string   `json:"lang_code"`     // 如 zh-CN / en-US
	LangNative   string   `json:"lang_native"`   // 该语言的 lang.name 翻译，用于 UI 展示
	NewKeys      []string `json:"new_keys"`      // 内嵌比用户多出来的键（用户缺失，需要补全）
	ChangedKeys  []string `json:"changed_keys"`  // 两边都有但内嵌新版本值不同的键
	ObsoleteKeys []string `json:"obsolete_keys"` // 用户有但内嵌没有的键（冗余/旧版残留，可选清理）
}

// I18nNewKeysReport 返回给前端的差异报告
type I18nNewKeysReport struct {
	HasNew        bool          `json:"has_new"`        // 是否存在任何差异（新语言/新键/值变更/冗余键）
	TotalNew      int           `json:"total_new"`      // 新键总数（跨语言汇总）
	TotalChg      int           `json:"total_chg"`      // 值变化键总数（跨语言汇总）
	TotalObsolete int           `json:"total_obsolete"` // 冗余键总数（跨语言汇总）
	NewLangs      []string      `json:"new_langs"`      // 内嵌比用户多出来的语言代码
	Diffs         []LangKeyDiff `json:"diffs"`          // 按语言分组的具体差异
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

// loadExternalI18n 读取用户外部 i18n.json，失败返回 nil
func loadExternalI18n() *I18nData {
	p := i18nFilePath()
	b, err := os.ReadFile(p)
	if err != nil {
		return nil
	}
	var d I18nData
	if json.Unmarshal(b, &d) != nil || d.Languages == nil {
		return nil
	}
	return &d
}

// mergeI18n 将内嵌版本中"外部文件缺失的语言和键"补进外部文件
// keepCustom=true  → 不覆盖外部文件已有的值（保留用户/导入包的自定义）
// keepCustom=false → 内嵌值覆盖外部文件中同键不同值的条目
// removeObsolete=true → 删除外部文件中"内嵌没有的键"（旧版残留/冗余键）
// 返回合并后的数据
func mergeI18n(embedded, external *I18nData, keepCustom bool, removeObsolete bool) *I18nData {
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

	// 先把外部文件的内容复制进来（保留用户自定义起点）
	for lang, dict := range external.Languages {
		copied := map[string]string{}
		for k, v := range dict {
			copied[k] = v
		}
		merged.Languages[lang] = copied
	}

	// 再用内嵌版本补齐：缺失的语言整体补上；已有语言按 keepCustom 决定是否覆盖
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
		// 外部文件有这个语言，逐键处理
		for k, v := range embeddedDict {
			existing, exists := extDict[k]
			if !exists {
				extDict[k] = v
			} else if !keepCustom && existing != v {
				// 用户选择"强制覆盖"时，同键不同值也用内嵌值覆盖
				extDict[k] = v
			}
		}
	}

	// 清理冗余键：删除用户有但内嵌没有的键（仅在内嵌存在该语言时才清理）
	if removeObsolete {
		for lang, extDict := range merged.Languages {
			embDict, ok := embedded.Languages[lang]
			if !ok {
				// 内嵌没有这个语言（用户自定义语言），不清理
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

// diffI18n 比较内嵌 vs 用户外部文件，返回差异报告。
// external 为 nil 时视为"全量新增"（前端一般不会走到这里，因为 EnsureI18nFile 首次启动会直接解压）。
func diffI18n(embedded, external *I18nData) I18nNewKeysReport {
	rep := I18nNewKeysReport{
		Diffs: []LangKeyDiff{},
	}
	if embedded == nil || embedded.Languages == nil {
		return rep
	}

	langName := func(dict map[string]string, code string) string {
		if n, ok := dict["lang.name"]; ok && n != "" {
			return n
		}
		return code
	}

	// 新语言：内嵌有但外部没有
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

	// 每个已有语言的键级差异
	for code, embDict := range embedded.Languages {
		extDict, ok := extLangs[code]
		if !ok {
			// 整门新语言，单独列在 NewLangs 下；同时把它的所有键都视作"新键"，
			// 放在 Diffs 里，UI 可以统一展示。
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
		// 1) 遍历内嵌：找出"用户缺失的键"和"值变更的键"
		for k, v := range embDict {
			ev, exists := extDict[k]
			if !exists {
				newKeys = append(newKeys, k)
			} else if ev != v {
				chgKeys = append(chgKeys, k)
			}
		}
		// 2) 遍历用户：找出"内嵌没有的键"（冗余/旧版残留）
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

// loadI18nData 加载 i18n 数据
// 当外部文件存在时优先使用外部文件（即使它缺少新键，前端会主动触发合并流程来补齐）。
// 外部文件不存在/损坏时直接回落到内嵌版本。
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

	// 尝试加载外部文件
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

// resetI18nCache 清空缓存，用于合并写回外部文件后，让下次 GetI18nData 重新读取
func resetI18nCache() {
	cachedI18nLock.Lock()
	defer cachedI18nLock.Unlock()
	cachedI18n = nil
}

// EnsureI18nFile 启动时调用：
//   - 外部文件不存在 → 解压内嵌版本
//   - 外部文件存在   → 不做任何合并/写回，留给前端通过 CheckI18nNewKeys + ConfirmI18nMerge 处理
func EnsureI18nFile() {
	externalPath := i18nFilePath()

	if _, err := os.Stat(externalPath); err == nil {
		// 外部文件已存在：启动时不自动合并
		return
	}

	// 首次启动：直接解压内嵌版本
	embeddedBytes, _ := embeddedI18nFS.ReadFile("i18n.json")
	_ = os.MkdirAll(settingsDir(), 0755)
	_ = os.WriteFile(externalPath, embeddedBytes, 0644)
}

// ================ 暴露给前端的方法（挂在 MusicService 上）================

// CheckI18nNewKeys 检查内嵌 i18n 相对于用户外部文件是否存在新键/值变更，返回差异报告。
// 前端据此决定是否弹窗询问用户覆盖。
func (a *MusicService) CheckI18nNewKeys() I18nNewKeysReport {
	emb := loadEmbeddedI18n()
	ext := loadExternalI18n()
	return diffI18n(emb, ext)
}

// I18nMergeResult 合并执行结果
type I18nMergeResult struct {
	OK      bool   `json:"ok"`
	Message string `json:"message"` // 成功 / 失败提示（会走前端本地 i18n，这里只给英文兜底文案）
}

// ConfirmI18nMerge 用户确认覆盖后执行合并。
// keepCustom=true     → 仅补齐缺失的语言/键，保留用户已自定义值（推荐默认）
// keepCustom=false    → 同键不同值也强制用内嵌值覆盖（慎用）
// removeObsolete=true → 删除用户文件中"内嵌没有的键"（旧版残留/冗余键）
// 写回外部文件并使后端缓存失效，返回 I18nMergeResult。
func (a *MusicService) ConfirmI18nMerge(keepCustom bool, removeObsolete bool) I18nMergeResult {
	emb := loadEmbeddedI18n()
	ext := loadExternalI18n()

	if ext == nil {
		// 外部文件不存在，首次启动场景一般不会走到这里；兜底直接写内嵌。
		externalPath := i18nFilePath()
		_ = os.MkdirAll(settingsDir(), 0755)
		embeddedBytes, _ := embeddedI18nFS.ReadFile("i18n.json")
		if err := os.WriteFile(externalPath, embeddedBytes, 0644); err != nil {
			return I18nMergeResult{OK: false, Message: "Failed to write i18n.json: " + err.Error()}
		}
		resetI18nCache()
		return I18nMergeResult{OK: true, Message: "Embedded i18n written."}
	}

	merged := mergeI18n(emb, ext, keepCustom, removeObsolete)
	mergedBytes, err := json.MarshalIndent(merged, "", "  ")
	if err != nil {
		return I18nMergeResult{OK: false, Message: "Marshal failed: " + err.Error()}
	}

	if err := os.WriteFile(i18nFilePath(), mergedBytes, 0644); err != nil {
		return I18nMergeResult{OK: false, Message: "Write failed: " + err.Error()}
	}

	// 写回成功：清空 Go 侧缓存，下次 GetI18nData 会重新读取最新合并结果
	resetI18nCache()
	return I18nMergeResult{OK: true, Message: "Merged successfully."}
}

// GetI18nData 暴露给前端：返回完整翻译数据
func (a *MusicService) GetI18nData() I18nData {
	return *loadI18nData()
}

// SetI18nAutoAction 持久化用户在 i18n 弹窗中勾选的"下次自动"选择
// action: "" / "skip" / "fill" / "overwrite"
// cleanObsolete: 自动模式下是否清理冗余键
func (a *MusicService) SetI18nAutoAction(action string, cleanObsolete bool) {
	s := a.LoadSettings()
	s.I18nAutoAction = action
	s.I18nAutoCleanObsolete = cleanObsolete
	_ = a.SaveSettings(s)
}

// I18nAutoActionResult 返回用户已设置的自动 i18n 合并动作
type I18nAutoActionResult struct {
	Action          string `json:"action"`            // "" / "skip" / "fill" / "overwrite"
	CleanObsolete   bool   `json:"cleanObsolete"`   // 自动模式下是否清理冗余键
}

// GetI18nAutoAction 读取用户已设置的自动 i18n 合并动作
// 返回 Action="" 表示未设置（应弹窗），"skip"/"fill"/"overwrite" 表示自动应用
func (a *MusicService) GetI18nAutoAction() I18nAutoActionResult {
	s := a.LoadSettings()
	return I18nAutoActionResult{
		Action:        s.I18nAutoAction,
		CleanObsolete: s.I18nAutoCleanObsolete,
	}
}

// getBackendStrings 根据当前设置的语言返回后端文案
func (a *MusicService) getBackendStrings() backendStrings {
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
