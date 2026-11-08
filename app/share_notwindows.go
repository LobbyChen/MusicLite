//go:build !windows

package app

import (
	"fmt"
	"os/exec"
	"runtime"
)

// setClipboardFilesGo 非 Windows 平台剪贴板文件复制（尽力而为）。
func setClipboardFilesGo(filePath string) error {
	switch runtime.GOOS {
	case "darwin":
		script := fmt.Sprintf(`set the clipboard to POSIX file "%s"`, escapeAppleScript(filePath))
		if err := exec.Command("osascript", "-e", script).Run(); err == nil {
			return nil
		}
		return fmt.Errorf("已生成分享文件: %s（当前平台无法自动复制到剪贴板，请在访达中手动复制）", filePath)
	default: // Linux / BSD
		uri := "file://" + filePath
		if xclip, err := exec.LookPath("xclip"); err == nil {
			cmd := exec.Command(xclip, "-selection", "clipboard", "-t", "x-special/gnome-copied-files")
			stdin, err := cmd.StdinPipe()
			if err == nil {
				go func() {
					_, _ = stdin.Write([]byte("copy\n" + uri))
					stdin.Close()
				}()
				if cmd.Run() == nil {
					return nil
				}
			}
		}
		if wlcopy, err := exec.LookPath("wl-copy"); err == nil {
			if err := exec.Command(wlcopy, "-t", "text/uri-list", uri).Run(); err == nil {
				return nil
			}
		}
		return fmt.Errorf("已生成分享文件: %s（未找到 xclip/wl-copy，无法自动复制到剪贴板，请在文件管理器中手动复制）", filePath)
	}
}

// escapeAppleScript 转义 AppleScript 字符串（双引号与反斜杠）。
func escapeAppleScript(s string) string {
	result := ""
	for _, r := range s {
		switch r {
		case '\\':
			result += "\\\\"
		case '"':
			result += "\\\""
		default:
			result += string(r)
		}
	}
	return result
}
