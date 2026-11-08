//go:build !windows

package app

import (
	"encoding/base64"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
)

// findFontFilePath 非 Windows 平台实现：优先 fc-match，否则遍历字体目录。
func findFontFilePath(fontName string) (string, error) {
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
		if result := findFontInDir(dir, targetLower); result != "" {
			return result, nil
		}
	}
	return "", fmt.Errorf("字体 %s 未找到", fontName)
}

// findFontInDir 在指定目录下搜索与字体名匹配的文件。
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

// installFontFromBase64 非 Windows 平台：将字体写入用户字体目录。
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
			fontsDir = filepath.Join(home, ".fonts")
		}
	}

	if err := os.MkdirAll(fontsDir, 0o755); err != nil {
		return fmt.Errorf("创建字体目录失败: %w", err)
	}

	destPath := filepath.Join(fontsDir, sanitizeFileName(fontName)+".ttf")
	if err := os.WriteFile(destPath, data, 0o644); err != nil {
		return fmt.Errorf("写入字体文件失败: %w", err)
	}

	if fcCache, err := exec.LookPath("fc-cache"); err == nil {
		_ = exec.Command(fcCache, "-f").Run()
	}
	return nil
}
