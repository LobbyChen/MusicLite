//go:build windows

package app

import (
	"encoding/base64"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"golang.org/x/sys/windows/registry"
)

// findFontFilePath 在注册表中查找字体名对应的字体文件路径
// 返回完整路径（通常在 C:\Windows\Fonts\ 下）
func findFontFilePath(fontName string) (string, error) {
	// 在注册表中搜索匹配的字体条目
	for _, root := range []registry.Key{registry.LOCAL_MACHINE, registry.CURRENT_USER} {
		path, ok := searchFontInRegistry(root, `SOFTWARE\Microsoft\Windows NT\CurrentVersion\Fonts`, fontName)
		if ok {
			return path, nil
		}
	}
	return "", fmt.Errorf("字体 %s 未在注册表中找到", fontName)
}

// searchFontInRegistry 在指定注册表路径中搜索字体文件
func searchFontInRegistry(root registry.Key, regPath, targetName string) (string, bool) {
	k, err := registry.OpenKey(root, regPath, registry.QUERY_VALUE)
	if err != nil {
		return "", false
	}
	defer k.Close()

	names, err := k.ReadValueNames(0)
	if err != nil {
		return "", false
	}

	targetLower := strings.ToLower(targetName)
	for _, name := range names {
		// 键名格式: "Microsoft YaHei (TrueType)" → 字体名 = "Microsoft YaHei"
		clean := name
		if i := strings.LastIndex(clean, " ("); i > 0 {
			clean = clean[:i]
		}
		// 按 & 或 , 拆分多个字体族名
		parts := strings.FieldsFunc(clean, func(r rune) bool {
			return r == '&' || r == ','
		})
		for _, p := range parts {
			p = strings.TrimSpace(p)
			if strings.ToLower(p) == targetLower {
				// 读取值（字体文件名）
				val, _, err := k.GetStringValue(name)
				if err != nil {
					continue
				}
				// val 可能是 "msyh.ttc" 或绝对路径
				fullPath := val
				if !filepath.IsAbs(val) {
					fullPath = filepath.Join(os.Getenv("WINDIR"), "Fonts", val)
				}
				if _, err := os.Stat(fullPath); err == nil {
					return fullPath, true
				}
			}
		}
	}
	return "", false
}

// installFontFromBase64 将 base64 编码的字体文件安装到用户字体目录
// Windows: 复制到 %LOCALAPPDATA%\Microsoft\Windows\Fonts\ 并注册到 HKCU 注册表
func installFontFromBase64(fontName, b64data string) error {
	data, err := base64.StdEncoding.DecodeString(b64data)
	if err != nil {
		return fmt.Errorf("base64 解码失败: %w", err)
	}

	// 用户字体目录
	localAppData := os.Getenv("LOCALAPPDATA")
	if localAppData == "" {
		return fmt.Errorf("无法获取 LOCALAPPDATA")
	}
	userFontsDir := filepath.Join(localAppData, "Microsoft", "Windows", "Fonts")
	os.MkdirAll(userFontsDir, 0755)

	// 根据字体名生成文件名（尝试常见扩展名）
	// 实际扩展名未知，统一用 .ttf 作为默认；如果已有同名 .ttc/.otf 则覆盖
	fileName := sanitizeFileName(fontName) + ".ttf"
	destPath := filepath.Join(userFontsDir, fileName)

	// 写入字体文件
	if err := os.WriteFile(destPath, data, 0644); err != nil {
		return fmt.Errorf("写入字体文件失败: %w", err)
	}

	// 注册到 HKCU 注册表
	regPath := `SOFTWARE\Microsoft\Windows NT\CurrentVersion\Fonts`
	k, _, err := registry.CreateKey(registry.CURRENT_USER, regPath, registry.SET_VALUE|registry.QUERY_VALUE)
	if err != nil {
		return fmt.Errorf("打开注册表失败: %w", err)
	}
	defer k.Close()

	regValueName := fontName + " (TrueType)"
	if err := k.SetStringValue(regValueName, destPath); err != nil {
		return fmt.Errorf("注册字体失败: %w", err)
	}

	// 通知系统字体变化（广播 WM_FONTCHANGE）
	broadcastFontChange()

	return nil
}
