package app

import "MusicLite/internal/i18n"

func (s *MusicService) GetI18nData() i18n.I18nData {
	return s.i18n.Data()
}

func (s *MusicService) CheckI18nNewKeys() i18n.I18nNewKeysReport {
	return s.i18n.CheckNewKeys()
}

func (s *MusicService) ConfirmI18nMerge(keepCustom, removeObsolete bool) i18n.I18nMergeResult {
	return s.i18n.ConfirmMerge(keepCustom, removeObsolete)
}

// SetI18nAutoAction 持久化用户选择的自动合并策略。
func (s *MusicService) SetI18nAutoAction(action string, cleanObsolete bool) {
	cfg := s.store.Load()
	cfg.I18nAutoAction = action
	cfg.I18nAutoCleanObsolete = cleanObsolete
	_ = s.store.Save(cfg)
}

// I18nAutoActionResult 自动合并策略读取结果。
type I18nAutoActionResult struct {
	Action        string `json:"action"`
	CleanObsolete bool   `json:"cleanObsolete"`
}

func (s *MusicService) GetI18nAutoAction() I18nAutoActionResult {
	cfg := s.store.Load()
	return I18nAutoActionResult{
		Action:        cfg.I18nAutoAction,
		CleanObsolete: cfg.I18nAutoCleanObsolete,
	}
}
