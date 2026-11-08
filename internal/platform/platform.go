package platform

import (
	"fmt"
	"io"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
)

// UserDataDir 返回跨平台的用户数据根目录。
// Windows: %APPDATA%；macOS: ~/Library/Application Support；Linux: $XDG_CONFIG_HOME 或 ~/.config。
func UserDataDir() string {
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
	default:
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

// AppDataDir 返回 MusicLite 专属数据目录。
func AppDataDir() string {
	dir := filepath.Join(UserDataDir(), "MusicLite")
	_ = os.MkdirAll(dir, 0o755)
	return dir
}

// DBPath 返回 SQLite 数据库路径。
// 优先复用 exe 旁的数据库（便携模式），否则使用用户数据目录。
func DBPath() string {
	exePath, err := os.Executable()
	if err == nil {
		exePath, _ = filepath.Abs(exePath)
		portable := filepath.Join(filepath.Dir(exePath), "msc_lite_storage.db")
		if _, statErr := os.Stat(portable); statErr == nil {
			return portable
		}
	}
	return filepath.Join(AppDataDir(), "msc_lite_storage.db")
}

// InitLogger 把标准 log 输出重定向到 exe 同目录的 log.txt，同时保留 stderr。
func InitLogger() {
	exePath, err := os.Executable()
	if err != nil {
		return
	}
	logPath := filepath.Join(filepath.Dir(exePath), "log.txt")
	logFile, err := os.OpenFile(logPath, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o644)
	if err != nil {
		return
	}
	log.SetOutput(io.MultiWriter(logFile, os.Stderr))
	log.SetFlags(log.LstdFlags | log.Lshortfile)
	log.Println("===== MusicLite 启动 =====")
}

// FileExists 判断路径是否存在且不是目录。
func FileExists(filename string) bool {
	info, err := os.Stat(filename)
	if err != nil {
		return false
	}
	return !info.IsDir()
}

// GetFileInArgs 返回命令行第一个参数中存在的文件路径。
func GetFileInArgs() string {
	if len(os.Args) <= 1 {
		return ""
	}
	fn := os.Args[1]
	if FileExists(fn) {
		return fn
	}
	return ""
}

// OpenPath 使用系统文件管理器打开目录。
func OpenPath(dir string) error {
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	switch runtime.GOOS {
	case "windows":
		return exec.Command("explorer.exe", dir).Start()
	case "darwin":
		return exec.Command("open", dir).Start()
	default:
		return exec.Command("xdg-open", dir).Start()
	}
}

// OpenURL 使用系统默认浏览器打开 URL。
func OpenURL(url string) error {
	switch runtime.GOOS {
	case "windows":
		return exec.Command("rundll32.exe", "url.dll,FileProtocolHandler", url).Start()
	case "darwin":
		return exec.Command("open", url).Start()
	default:
		return exec.Command("xdg-open", url).Start()
	}
}

// VersionInfo 供前端显示。
type VersionInfo struct {
	Version  string `json:"version"`
	BuildSHA string `json:"buildSha"`
	BuildNum string `json:"buildNum"`
}

var (
	// Version / BuildSHA / BuildNum 由 -ldflags 注入。
	Version  = "0.0.0-dev"
	BuildSHA = "unknown"
	BuildNum = "0"
)

// GetVersionInfo 返回构建期版本信息。
func GetVersionInfo() VersionInfo {
	return VersionInfo{Version: Version, BuildSHA: BuildSHA, BuildNum: BuildNum}
}

// LogEvent 记录通用事件日志。
func LogEvent(stage, info string) {
	log.Printf("[%s] %s", stage, info)
}

// Errorf 统一错误包装。
func Errorf(format string, args ...any) error {
	return fmt.Errorf(format, args...)
}
