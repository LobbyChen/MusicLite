//go:build !windows

package app

import (
	"bufio"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
)

// readInstalledFonts 非 Windows 平台实现：
// - macOS: 遍历 ~/Library/Fonts, /Library/Fonts, /System/Library/Fonts 目录
// - Linux: 使用 fc-list (fontconfig) 列出字体族名；若无 fc-list 则遍历常见字体目录
func readInstalledFonts(out map[string]struct{}) {
	// 优先尝试 fc-list（跨 *nix 通用，结果最准确）
	if fc, err := exec.LookPath("fc-list"); err == nil {
		if outBytes, err := exec.Command(fc, "-f", "%{family}\n").Output(); err == nil {
			scanner := bufio.NewScanner(strings.NewReader(string(outBytes)))
			for scanner.Scan() {
				line := strings.TrimSpace(scanner.Text())
				if line == "" {
					continue
				}
				// fc-list 可能返回多个族名用逗号分隔（如 "Noto Sans CJK SC,Noto Sans CJK SC JP"）
				for _, family := range strings.Split(line, ",") {
					family = strings.TrimSpace(family)
					if family != "" {
						out[family] = struct{}{}
					}
				}
			}
			if len(out) > 0 {
				return
			}
		}
	}

	// 兜底：遍历字体目录（无法解析字体文件名→族名，仅把文件名去掉扩展名作为候选）
	var dirs []string
	switch runtime.GOOS {
	case "darwin":
		home, _ := os.UserHomeDir()
		dirs = []string{
			filepath.Join(home, "Library", "Fonts"),
			"/Library/Fonts",
			"/System/Library/Fonts",
			"/Network/Library/Fonts",
		}
	default: // Linux / BSD
		home, _ := os.UserHomeDir()
		dirs = []string{
			filepath.Join(home, ".local", "share", "fonts"),
			filepath.Join(home, ".fonts"),
			"/usr/local/share/fonts",
			"/usr/share/fonts",
		}
	}
	for _, dir := range dirs {
		_ = walkFontDir(dir, out)
	}
}

// walkFontDir 遍历字体目录，把文件名（去掉扩展名）作为字体名去重加入
func walkFontDir(dir string, out map[string]struct{}) error {
	return filepath.WalkDir(dir, func(path string, d os.DirEntry, err error) error {
		if err != nil {
			return nil
		}
		if d.IsDir() {
			return nil
		}
		ext := strings.ToLower(filepath.Ext(path))
		switch ext {
		case ".ttf", ".otf", ".ttc", ".otc":
			name := strings.TrimSuffix(filepath.Base(path), ext)
			// 常见命名：MicrosoftYaHei.ttf / NotoSansCJK-Regular.ttf
			// 简单去掉 -Regular/-Bold/-Italic 等后缀作为族名
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
