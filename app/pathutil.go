package app

import (
	"os"
	"path/filepath"
	"runtime"
)

// getUserDataDir 返回跨平台的用户数据目录
// Windows: %APPDATA% 或 %USERPROFILE%\AppData\Roaming
// macOS:   ~/Library/Application Support
// Linux:   $XDG_CONFIG_HOME 或 ~/.config
func getUserDataDir() string {
	var base string
	switch runtime.GOOS {
	case "windows":
		base = os.Getenv("APPDATA")
		if base == "" {
			if home, err := os.UserHomeDir(); err == nil {
				base = filepath.Join(home, "AppData", "Roaming")
			}
		}
	case "darwin":
		if home, err := os.UserHomeDir(); err == nil {
			base = filepath.Join(home, "Library", "Application Support")
		}
	default: // Linux, BSD, etc.
		base = os.Getenv("XDG_CONFIG_HOME")
		if base == "" {
			if home, err := os.UserHomeDir(); err == nil {
				base = filepath.Join(home, ".config")
			}
		}
	}
	if base == "" {
		base = "."
	}
	return base
}
