//go:build windows

package app

import (
	"log"
	"strings"

	"golang.org/x/sys/windows/registry"
)

// readInstalledFonts Windows 实现：读注册表 HKLM/HKCU 字体键
func readInstalledFonts(out map[string]struct{}) {
	readRegistryFonts(registry.LOCAL_MACHINE, `SOFTWARE\Microsoft\Windows NT\CurrentVersion\Fonts`, out)
	readRegistryFonts(registry.CURRENT_USER, `SOFTWARE\Microsoft\Windows NT\CurrentVersion\Fonts`, out)
}

// readRegistryFonts 打开指定注册表路径读取字体名；失败时静默跳过
func readRegistryFonts(root registry.Key, path string, out map[string]struct{}) {
	k, err := registry.OpenKey(root, path, registry.QUERY_VALUE)
	if err != nil {
		log.Printf("打开注册表字体键失败 %s: %v", path, err)
		return
	}
	defer k.Close()
	names, err := k.ReadValueNames(0)
	if err != nil {
		log.Printf("读取注册表字体值失败 %s: %v", path, err)
		return
	}
	for _, name := range names {
		// 键名格式: "Microsoft YaHei & Microsoft YaHei UI (TrueType)"、"Arial (TrueType)"
		// 去掉尾部 (TrueType)/(OpenType) 等后缀，再按 &/& /, 拆分字体族名
		clean := name
		if i := strings.LastIndex(clean, " ("); i > 0 {
			clean = clean[:i]
		}
		// 多个字体族名用 & 或 , 分隔（如 "微软雅黑 & 微软雅黑 UI"）
		parts := strings.FieldsFunc(clean, func(r rune) bool {
			return r == '&' || r == ','
		})
		for _, p := range parts {
			p = strings.TrimSpace(p)
			if p == "" {
				continue
			}
			out[p] = struct{}{}
		}
	}
}
