//go:build !windows

package app

import (
	"bufio"
	"encoding/base64"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
)

// findFontFilePath 非 Windows 平台实现：
// - macOS: 在常见字体目录中搜索字体文件
// - Linux: 尝试通过 fc-match 或遍历字体目录查找
func findFontFilePath(fontName string) (string, error) {
	// 优先尝试 fc-match（fontconfig，最准确）
	if fcMatch, err := exec.LookPath("fc-match"); err == nil {
		if out, err := exec.Command(fcMatch, "-f", "%{file}\n", fontName).Output(); err == nil {
			path := strings.TrimSpace(string(out))
			if path != "" {
				if _, err := os.Stat(path); err == nil {
					return path, nil
				}
			}
		}
	}

	// 兜底：遍历常见字体目录，尝试匹配文件名
	var dirs []string
	home, _ := os.UserHomeDir()
	switch runtime.GOOS {
	case "darwin":
		dirs = []string{
			filepath.Join(home, "Library", "Fonts"),
			"/Library/Fonts",
			"/System/Library/Fonts",
			"/Network/Library/Fonts",
		}
	default: // Linux / BSD
		dirs = []string{
			filepath.Join(home, ".local", "share", "fonts"),
			filepath.Join(home, ".fonts"),
			"/usr/local/share/fonts",
			"/usr/share/fonts",
		}
	}

	targetLower := strings.ToLower(fontName)
	for _, dir := range dirs {
		result := findFontInDir(dir, targetLower)
		if result != "" {
			return result, nil
		}
	}
	return "", fmt.Errorf("字体 %s 未找到", fontName)
}

// findFontInDir 在指定目录下搜索与字体名匹配的文件
func findFontInDir(dir, targetLower string) string {
	var found string
	_ = filepath.WalkDir(dir, func(path string, d os.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return nil
		}
		ext := strings.ToLower(filepath.Ext(path))
		switch ext {
		case ".ttf", ".otf", ".ttc", ".otc":
			name := strings.ToLower(strings.TrimSuffix(filepath.Base(path), ext))
			// 去掉 -Regular/-Bold 等后缀
			for _, suffix := range []string{"-regular", "-bold", "-italic", "-light", "-medium", "-black", "-thin"} {
				name = strings.TrimSuffix(name, suffix)
			}
			if name == targetLower || strings.Contains(name, targetLower) {
				found = path
				return filepath.SkipAll
			}
		}
		return nil
	})
	return found
}

// installFontFromBase64 非 Windows 平台：将字体写入用户字体目录
// macOS: ~/Library/Fonts/
// Linux: ~/.local/share/fonts/ 或 ~/.fonts/
func installFontFromBase64(fontName, b64data string) error {
	data, err := base64.StdEncoding.DecodeString(b64data)
	if err != nil {
		return fmt.Errorf("base64 解码失败: %w", err)
	}

	home, err := os.UserHomeDir()
	if err != nil {
		return fmt.Errorf("无法获取用户目录: %w", err)
	}

	var fontsDir string
	switch runtime.GOOS {
	case "darwin":
		fontsDir = filepath.Join(home, "Library", "Fonts")
	default: // Linux / BSD
		fontsDir = filepath.Join(home, ".local", "share", "fonts")
		if _, err := os.Stat(fontsDir); err != nil {
			// 兜底 ~/.fonts（部分旧发行版）
			fontsDir = filepath.Join(home, ".fonts")
		}
	}

	if err := os.MkdirAll(fontsDir, 0755); err != nil {
		return fmt.Errorf("创建字体目录失败: %w", err)
	}

	fileName := sanitizeFileName(fontName) + ".ttf"
	destPath := filepath.Join(fontsDir, fileName)

	if err := os.WriteFile(destPath, data, 0644); err != nil {
		return fmt.Errorf("写入字体文件失败: %w", err)
	}

	// 尝试刷新字体缓存（若有 fc-cache）
	if fcCache, err := exec.LookPath("fc-cache"); err == nil {
		_ = exec.Command(fcCache, "-f").Run()
	}

	return nil
}

// collectFontDirNames 非 Windows 平台辅助：枚举字体目录中的字体名（用于导出时"尽力而为"的匹配）
// 此处保留占位，导出功能使用 readInstalledFonts 作为主路径
func _collectFontDirNames(out map[string]struct{}) {
	var dirs []string
	home, _ := os.UserHomeDir()
	switch runtime.GOOS {
	case "darwin":
		dirs = []string{
			filepath.Join(home, "Library", "Fonts"),
			"/Library/Fonts",
			"/System/Library/Fonts",
		}
	default:
		dirs = []string{
			filepath.Join(home, ".local", "share", "fonts"),
			"/usr/share/fonts",
		}
	}
	for _, dir := range dirs {
		_ = filepath.WalkDir(dir, func(path string, d os.DirEntry, err error) error {
			if err != nil || d.IsDir() {
				return nil
			}
			ext := strings.ToLower(filepath.Ext(path))
			if ext == ".ttf" || ext == ".otf" || ext == ".ttc" || ext == ".otc" {
				name := strings.TrimSuffix(filepath.Base(path), ext)
				for _, suffix := range []string{"-Regular", "-Bold", "-Italic", "-Light", "-Medium", "-Black", "-Thin"} {
					name = strings.TrimSuffix(name, suffix)
				}
				if name != "" {
					out[name] = struct{}{}
				}
			}
			return nil
		})
	}
	_ = bufio.NewReader
}
