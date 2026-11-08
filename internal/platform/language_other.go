//go:build !windows

package platform

import (
	"os"
	"os/exec"
	"runtime"
	"strings"
)

// SystemLanguage 返回系统界面语言对应的应用语言：
// 中文（zh-*）使用简体中文，其余语言使用英文。
func SystemLanguage() string {
	for _, key := range []string{"LC_ALL", "LC_MESSAGES", "LANG", "LANGUAGE"} {
		if v := strings.TrimSpace(os.Getenv(key)); v != "" {
			return normalizeLocale(v)
		}
	}
	// macOS 从 Finder 启动时通常没有 LANG，回退读取系统区域设置
	if runtime.GOOS == "darwin" {
		if out, err := exec.Command("defaults", "read", "-g", "AppleLocale").Output(); err == nil {
			return normalizeLocale(string(out))
		}
	}
	return "en-US"
}

func normalizeLocale(locale string) string {
	if strings.HasPrefix(strings.ToLower(strings.TrimSpace(locale)), "zh") {
		return "zh-CN"
	}
	return "en-US"
}
