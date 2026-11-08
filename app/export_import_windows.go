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

// findFontFilePath 在注册表中查找字体名对应的字体文件路径。
func findFontFilePath(fontName string) (string, error) {
	for _, root := range []registry.Key{registry.LOCAL_MACHINE, registry.CURRENT_USER} {
		path, ok := searchFontInRegistry(root, `SOFTWARE\Microsoft\Windows NT\CurrentVersion\Fonts`, fontName)
		if ok {
			return path, nil
		}
	}
	return "", fmt.Errorf("字体 %s 未在注册表中找到", fontName)
}

// searchFontInRegistry 在指定注册表路径中搜索字体文件。
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
		clean := name
		if i := strings.LastIndex(clean, " ("); i > 0 {
			clean = clean[:i]
		}
		parts := strings.FieldsFunc(clean, func(r rune) bool {
			return r == '&' || r == ','
		})
		for _, p := range parts {
			p = strings.TrimSpace(p)
			if strings.ToLower(p) != targetLower {
				continue
			}
			val, _, err := k.GetStringValue(name)
			if err != nil {
				continue
			}
			fullPath := val
			if !filepath.IsAbs(val) {
				fullPath = filepath.Join(os.Getenv("WINDIR"), "Fonts", val)
			}
			if _, err := os.Stat(fullPath); err == nil {
				return fullPath, true
			}
		}
	}
	return "", false
}

// installFontFromBase64 将 base64 字体安装到用户字体目录并注册到 HKCU。
func installFontFromBase64(fontName, b64data string) error {
	data, err := base64.StdEncoding.DecodeString(b64data)
	if err != nil {
		return fmt.Errorf("base64 解码失败: %w", err)
	}

	localAppData := os.Getenv("LOCALAPPDATA")
	if localAppData == "" {
		return fmt.Errorf("无法获取 LOCALAPPDATA")
	}
	userFontsDir := filepath.Join(localAppData, "Microsoft", "Windows", "Fonts")
	_ = os.MkdirAll(userFontsDir, 0o755)

	fileName := sanitizeFileName(fontName) + ".ttf"
	destPath := filepath.Join(userFontsDir, fileName)

	if err := os.WriteFile(destPath, data, 0o644); err != nil {
		return fmt.Errorf("写入字体文件失败: %w", err)
	}

	regPath := `SOFTWARE\Microsoft\Windows NT\CurrentVersion\Fonts`
	k, _, err := registry.CreateKey(registry.CURRENT_USER, regPath, registry.SET_VALUE|registry.QUERY_VALUE)
	if err != nil {
		return fmt.Errorf("打开注册表失败: %w", err)
	}
	defer k.Close()

	if err := k.SetStringValue(fontName+" (TrueType)", destPath); err != nil {
		return fmt.Errorf("注册字体失败: %w", err)
	}

	broadcastFontChange()
	return nil
}
