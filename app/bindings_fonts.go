package app

import (
	"sort"
	"strings"
)

// GetInstalledFonts 返回系统中安装的字体名称列表（去重、排序）。
// 平台差异由 fonts_windows.go / fonts_notwindows.go 中的 readInstalledFonts 提供。
func (s *MusicService) GetInstalledFonts() []string {
	set := make(map[string]struct{})
	readInstalledFonts(set)

	list := make([]string, 0, len(set))
	for name := range set {
		list = append(list, name)
	}
	sort.Slice(list, func(i, j int) bool {
		return strings.ToLower(list[i]) < strings.ToLower(list[j])
	})

	if len(list) == 0 {
		// 任何平台读取失败时的通用兜底列表（中西文常用字体混合）
		list = []string{
			"Microsoft YaHei", "SimHei", "SimSun", "KaiTi", "FangSong",
			"PingFang SC", "Hiragino Sans GB", "Heiti SC", "Songti SC",
			"Noto Sans CJK SC", "Noto Serif CJK SC", "WenQuanYi Zen Hei", "WenQuanYi Micro Hei",
			"Segoe UI", "Consolas", "Monaco", "Courier New", "Arial",
		}
	}
	return list
}
