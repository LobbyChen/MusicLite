//go:build windows

package app

// ============ Windows 文件关联（设为默认播放器） ============
//
// 通过注册 HKCU\Software\Classes\MusicLite.AudioFile ProgID，关联常见音频扩展名。
// 使用 HKCU（当前用户）而非 HKLM，不需要管理员权限，适合便携版。
// 调用 SHChangeNotify 通知 Shell 刷新图标和关联（见 font_notify_windows.go）。

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"golang.org/x/sys/windows/registry"
)

// progID 文件关联的 ProgID 标识符。
const progID = "MusicLite.AudioFile"

// supportedExts 支持关联的音频扩展名。
var supportedExts = []string{
	".mp3", ".wav", ".flac", ".m4a", ".ogg", ".wma",
	".aac", ".opus", ".ape", ".alac", ".aiff", ".dsd", ".dff", ".dsf",
}

// SetAsDefaultPlayer 将 MusicLite 设为支持音频格式的默认播放器（Windows 实现）。
func (s *MusicService) SetAsDefaultPlayer() error {
	exePath, err := os.Executable()
	if err != nil {
		return fmt.Errorf("获取可执行文件路径失败: %w", err)
	}
	exePath, err = filepath.Abs(exePath)
	if err != nil {
		return fmt.Errorf("获取绝对路径失败: %w", err)
	}

	// 检查是否已经以正确路径注册，避免不必要的注册表写入
	if isRegisteredWithCorrectPath(exePath) {
		return nil
	}

	progKeyPath := `Software\Classes\` + progID

	// 1. 创建 ProgID
	progKey, _, err := registry.CreateKey(registry.CURRENT_USER, progKeyPath, registry.ALL_ACCESS)
	if err != nil {
		return fmt.Errorf("创建 ProgID 主键失败: %w", err)
	}
	if err := progKey.SetStringValue("", "MusicLite 音频文件"); err != nil {
		progKey.Close()
		return fmt.Errorf("设置 ProgID 名称失败: %w", err)
	}
	progKey.Close()

	// 默认图标
	iconKey, _, err := registry.CreateKey(registry.CURRENT_USER, progKeyPath+`\DefaultIcon`, registry.ALL_ACCESS)
	if err == nil {
		iconValue := fmt.Sprintf(`"%s",0`, exePath)
		if err := iconKey.SetStringValue("", iconValue); err != nil {
			iconKey.Close()
			return fmt.Errorf("设置图标失败: %w", err)
		}
		iconKey.Close()
	}

	// 打开命令
	cmdKey, _, err := registry.CreateKey(registry.CURRENT_USER, progKeyPath+`\shell\open\command`, registry.ALL_ACCESS)
	if err == nil {
		cmdValue := fmt.Sprintf(`"%s" "%%1"`, exePath)
		if err := cmdKey.SetStringValue("", cmdValue); err != nil {
			cmdKey.Close()
			return fmt.Errorf("设置打开命令失败: %w", err)
		}
		cmdKey.Close()
	}

	// 2. 关联扩展名
	for _, ext := range supportedExts {
		extKey, _, err := registry.CreateKey(registry.CURRENT_USER, `Software\Classes\`+ext, registry.ALL_ACCESS)
		if err != nil {
			continue
		}
		if err := extKey.SetStringValue("", progID); err != nil {
			extKey.Close()
			continue
		}
		_ = extKey.SetStringValue("Progid", progID)
		extKey.Close()
	}

	// 3. 通知 Shell 刷新
	notifyShellAssocChanged()
	return nil
}

// UnsetAsDefaultPlayer 取消 MusicLite 的默认播放器关联（Windows 实现）。
func (s *MusicService) UnsetAsDefaultPlayer() error {
	// 1. 删除扩展名关联
	for _, ext := range supportedExts {
		k, err := registry.OpenKey(registry.CURRENT_USER, `Software\Classes\`+ext, registry.SET_VALUE)
		if err != nil {
			continue
		}
		if val, _, err := k.GetStringValue(""); err == nil && val == progID {
			_ = k.SetStringValue("", "")
		}
		k.Close()
	}

	// 2. 删除 ProgID 及其子键（registry.DeleteKey 只能删除空键，从深到浅）
	progKeyPath := `Software\Classes\` + progID
	registry.DeleteKey(registry.CURRENT_USER, progKeyPath+`\shell\open\command`)
	registry.DeleteKey(registry.CURRENT_USER, progKeyPath+`\shell\open`)
	registry.DeleteKey(registry.CURRENT_USER, progKeyPath+`\shell`)
	registry.DeleteKey(registry.CURRENT_USER, progKeyPath+`\DefaultIcon`)
	registry.DeleteKey(registry.CURRENT_USER, progKeyPath)

	// 3. 通知 Shell 刷新
	notifyShellAssocChanged()
	return nil
}

// IsDefaultPlayer 检查 MusicLite 是否为 .mp3 的默认播放器（Windows 实现）。
func (s *MusicService) IsDefaultPlayer() (bool, error) {
	k, err := registry.OpenKey(registry.CURRENT_USER, `Software\Classes\.mp3`, registry.QUERY_VALUE)
	if err != nil {
		return false, nil
	}
	defer k.Close()

	val, _, err := k.GetStringValue("")
	if err != nil {
		return false, nil
	}
	return val == progID, nil
}

// isRegisteredWithCorrectPath 检查当前注册的命令是否与当前 exe 路径一致。
func isRegisteredWithCorrectPath(currentExePath string) bool {
	k, err := registry.OpenKey(registry.CURRENT_USER, `Software\Classes\`+progID+`\shell\open\command`, registry.QUERY_VALUE)
	if err != nil {
		return false
	}
	defer k.Close()

	val, _, err := k.GetStringValue("")
	if err != nil {
		return false
	}
	return strings.Contains(val, currentExePath)
}
