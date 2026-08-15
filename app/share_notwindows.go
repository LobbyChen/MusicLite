//go:build !windows

package app

import (
	"fmt"
	"os/exec"
	"runtime"
)

// setClipboardFilesGo 非 Windows 平台剪贴板文件复制
//
// Linux/macOS 没有像 Windows CF_HDROP 那样统一的"粘贴文件"剪贴板格式：
//   - macOS: NSPasteboard 的 NSFilenamesPboardType 需要通过 AppleScript
//   - Linux (X11): x-special/gnome-copied-files target，需 xclip 配合
//   - Linux (Wayland): 需 wl-copy -t text/uri-list
//
// 本函数尽力而为调用系统命令，失败时返回错误提示用户手动打开文件所在目录。
func setClipboardFilesGo(filePath string) error {
	switch runtime.GOOS {
	case "darwin":
		// macOS: 通过 AppleScript 把 POSIX 文件路径放入剪贴板
		//   set the clipboard to (POSIX file "<path>") as text 不够，
		//   标准做法是 tell app "Finder" to activate + select，但用户体验不稳定。
		// 退而求其次：把文件路径以 URI 形式放进剪贴板文本，
		// 部分应用（如终端）接受；同时告诉用户文件位置以便手动拖放。
		script := fmt.Sprintf(`set the clipboard to POSIX file "%s"`, escapeAppleScript(filePath))
		if err := exec.Command("osascript", "-e", script).Run(); err == nil {
			return nil
		}
		// AppleScript 失败，返回明确错误提示
		return fmt.Errorf("已生成分享文件: %s（当前平台无法自动复制到剪贴板，请在访达中手动复制）", filePath)
	default: // Linux / BSD
		// 尝试 xclip / wl-copy
		uri := "file://" + filePath
		if xclip, err := exec.LookPath("xclip"); err == nil {
			// GNOME/KDE/Xfce 常用 x-special/gnome-copied-files target
			cmd := exec.Command(xclip, "-selection", "clipboard", "-t", "x-special/gnome-copied-files")
			stdin, err := cmd.StdinPipe()
			if err == nil {
				go func() {
					stdin.Write([]byte("copy\n" + uri))
					stdin.Close()
				}()
				if cmd.Run() == nil {
					return nil
				}
			}
		}
		if wlcopy, err := exec.LookPath("wl-copy"); err == nil {
			// Wayland 生态
			if err := exec.Command(wlcopy, "-t", "text/uri-list", uri).Run(); err == nil {
				return nil
			}
		}
		return fmt.Errorf("已生成分享文件: %s（未找到 xclip/wl-copy，无法自动复制到剪贴板，请在文件管理器中手动复制）", filePath)
	}
}

// escapeAppleScript 转义 AppleScript 字符串（双引号与反斜杠）
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
