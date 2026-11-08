//go:build !windows

package app

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
)

// supportedExts 支持关联的音频扩展名（供 mimeapps/UTI 使用）。
var supportedExts = []string{".mp3", ".wav", ".flac", ".m4a", ".ogg", ".wma", ".aac", ".opus", ".ape", ".alac"}

// extToMIME 将扩展名映射为 MIME 类型（Linux xdg-mime 使用）。
var extToMIME = map[string]string{
	".mp3":  "audio/mpeg",
	".wav":  "audio/wav",
	".flac": "audio/flac",
	".m4a":  "audio/mp4",
	".ogg":  "audio/ogg",
	".wma":  "audio/x-ms-wma",
	".aac":  "audio/aac",
	".opus": "audio/opus",
	".ape":  "audio/ape",
	".alac": "audio/alac",
}

// SetAsDefaultPlayer 将 MusicLite 设为默认播放器（非 Windows 实现）。
func (s *MusicService) SetAsDefaultPlayer() error {
	switch runtime.GOOS {
	case "darwin":
		// macOS 修改默认应用需要用户授权，官方无公开 API；尝试刷新 LaunchServices。
		lsregister := "/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister"
		if _, err := os.Stat(lsregister); err == nil {
			if bundle := findAppBundlePath(); bundle != "" {
				_ = exec.Command(lsregister, "-f", bundle).Run()
			}
		}
		return fmt.Errorf("请在 macOS 系统设置 → 桌面与程序坞 → 默认应用中设置 MusicLite 为默认音乐播放器")
	default: // Linux 及其他 POSIX
		xdgMime, err := exec.LookPath("xdg-mime")
		if err != nil {
			return fmt.Errorf("未找到 xdg-mime（请安装 xdg-utils），或在系统设置中手动配置默认应用")
		}
		desktopFile := "MusicLite.desktop"
		failed := 0
		total := 0
		for _, ext := range supportedExts {
			mime, ok := extToMIME[ext]
			if !ok {
				continue
			}
			total++
			if err := exec.Command(xdgMime, "default", desktopFile, mime).Run(); err != nil {
				failed++
			}
		}
		if total == 0 {
			return fmt.Errorf("没有可注册的 MIME 类型")
		}
		if failed == total {
			return fmt.Errorf("xdg-mime 设置全部失败，请确认 %s 已安装到应用目录", desktopFile)
		}
		if failed > 0 {
			return fmt.Errorf("xdg-mime 部分成功：%d/%d 失败", failed, total)
		}
		return nil
	}
}

// IsDefaultPlayer 检查 MusicLite 是否为默认播放器（非 Windows 实现）。
func (s *MusicService) IsDefaultPlayer() (bool, error) {
	switch runtime.GOOS {
	case "darwin":
		if duti, err := exec.LookPath("duti"); err == nil {
			if out, err := exec.Command(duti, "-x", "audio/mpeg").Output(); err == nil {
				return strings.Contains(string(out), "MusicLite"), nil
			}
		}
		return false, nil
	default: // Linux
		xdgMime, err := exec.LookPath("xdg-mime")
		if err != nil {
			return false, nil
		}
		out, err := exec.Command(xdgMime, "query", "default", "audio/mpeg").Output()
		if err != nil {
			return false, nil
		}
		return strings.Contains(string(out), "MusicLite"), nil
	}
}

// findAppBundlePath 尝试查找当前可执行文件所属的 .app bundle。
func findAppBundlePath() string {
	exe, err := os.Executable()
	if err != nil {
		return ""
	}
	segments := strings.Split(filepath.ToSlash(exe), "/")
	for i := len(segments) - 1; i >= 0; i-- {
		if strings.HasSuffix(segments[i], ".app") {
			return "/" + strings.Join(segments[:i+1], "/")
		}
	}
	return ""
}
