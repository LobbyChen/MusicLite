//go:build windows

package app

// ============ Windows 文件关联（设为默认播放器） ============
//
// 通过注册 HKCU\Software\Classes\MusicLite.AudioFile ProgID，
// 关联常见音频扩展名。
// 使用 HKCU（当前用户）而非 HKLM，不需要管理员权限，适合便携版。
// 调用 SHChangeNotify 通知 Shell 刷新图标和关联。

/*
#cgo LDFLAGS: -lole32 -lshell32

#include <windows.h>
#include <shlobj.h>

// notifyShellChange 通知 Shell 刷新文件关联图标
static void notifyShellChange() {
    SHChangeNotify(SHCNE_ASSOCCHANGED, SHCNF_IDLIST, NULL, NULL);
}
*/
import "C"

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"golang.org/x/sys/windows/registry"
)

// progID 文件关联的 ProgID 标识符
const progID = "MusicLite.AudioFile"

// supportedExts 支持关联的音频扩展名
var supportedExts = []string{
	".mp3", ".wav", ".flac", ".m4a", ".ogg", ".wma",
	".aac", ".opus", ".ape", ".alac", ".aiff", ".dsd", ".dff", ".dsf",
}

// SetAsDefaultPlayer 将 MusicLite 设为支持音频格式的默认播放器（Windows 实现）
func (a *MusicService) SetAsDefaultPlayer() error {
	exePath, err := os.Executable()
	if err != nil {
		return fmt.Errorf("获取可执行文件路径失败: %w", err)
	}
	exePath, err = filepath.Abs(exePath)
	if err != nil {
		return fmt.Errorf("获取绝对路径失败: %w", err)
	}

	// 检查是否已经以正确路径注册，避免不必要的注册表写入
	if a.isRegisteredWithCorrectPath(exePath) {
		return nil
	}

	// 1. 创建 ProgID：HKCU\Software\Classes\MusicLite.AudioFile
	progKeyPath := `Software\Classes\` + progID

	// 创建主 ProgID 键
	progKey, _, err := registry.CreateKey(registry.CURRENT_USER, progKeyPath, registry.ALL_ACCESS)
	if err != nil {
		return fmt.Errorf("创建 ProgID 主键失败: %w", err)
	}

	// 设置友好名称
	if err := progKey.SetStringValue("", "MusicLite 音频文件"); err != nil {
		progKey.Close()
		return fmt.Errorf("设置 ProgID 名称失败: %w", err)
	}
	progKey.Close()

	// 设置默认图标
	iconKeyPath := progKeyPath + `\DefaultIcon`
	iconKey, _, err := registry.CreateKey(registry.CURRENT_USER, iconKeyPath, registry.ALL_ACCESS)
	if err == nil {
		// 格式: "exe路径,索引号"
		iconValue := fmt.Sprintf(`"%s",0`, exePath)
		if err := iconKey.SetStringValue("", iconValue); err != nil {
			iconKey.Close()
			return fmt.Errorf("设置图标失败: %w", err)
		}
		iconKey.Close()
	}

	// 设置打开命令
	cmdKeyPath := progKeyPath + `\shell\open\command`
	cmdKey, _, err := registry.CreateKey(registry.CURRENT_USER, cmdKeyPath, registry.ALL_ACCESS)
	if err == nil {
		// 格式: "exe路径" "%1"
		cmdValue := fmt.Sprintf(`"%s" "%%1"`, exePath)
		if err := cmdKey.SetStringValue("", cmdValue); err != nil {
			cmdKey.Close()
			return fmt.Errorf("设置打开命令失败: %w", err)
		}
		cmdKey.Close()
	}

	// 2. 关联扩展名：HKCU\Software\Classes\.mp3 → MusicLite.AudioFile
	for _, ext := range supportedExts {
		extKeyPath := `Software\Classes\` + ext
		extKey, _, err := registry.CreateKey(registry.CURRENT_USER, extKeyPath, registry.ALL_ACCESS)
		if err != nil {
			// 如果某个扩展名无法写入，跳过它而不是完全失败
			continue
		}

		// 设置默认值为 ProgID
		if err := extKey.SetStringValue("", progID); err != nil {
			extKey.Close()
			continue
		}

		// 写入 ProgID 子键（某些 Windows 版本需要）
		if err := extKey.SetStringValue("Progid", progID); err != nil {
			// 这个值不是必须的，失败可以忽略
		}

		extKey.Close()
	}

	// 3. 通知 Shell 刷新
	C.notifyShellChange()

	return nil
}

// UnsetAsDefaultPlayer 取消 MusicLite 的默认播放器关联（Windows 实现）
func (a *MusicService) UnsetAsDefaultPlayer() error {
	// 1. 删除扩展名关联
	for _, ext := range supportedExts {
		extKeyPath := `Software\Classes\` + ext
		k, err := registry.OpenKey(registry.CURRENT_USER, extKeyPath, registry.SET_VALUE)
		if err != nil {
			continue
		}

		// 检查当前是否关联到我们的 ProgID
		val, _, err := k.GetStringValue("")
		if err == nil && val == progID {
			// 如果是，则删除默认值，让系统回退到其他处理程序
			k.SetStringValue("", "")
		}
		k.Close()
	}

	// 2. 删除 ProgID 及其子键
	// 注意：registry.DeleteKey 只能删除空键，所以我们需要递归删除或手动删除子键
	progKeyPath := `Software\Classes\` + progID

	// 尝试删除 shell\open\command
	commandKeyPath := progKeyPath + `\shell\open\command`
	registry.DeleteKey(registry.CURRENT_USER, commandKeyPath)

	// 尝试删除 shell\open
	openKeyPath := progKeyPath + `\shell\open`
	registry.DeleteKey(registry.CURRENT_USER, openKeyPath)

	// 尝试删除 shell
	shellKeyPath := progKeyPath + `\shell`
	registry.DeleteKey(registry.CURRENT_USER, shellKeyPath)

	// 尝试删除 DefaultIcon
	iconKeyPath := progKeyPath + `\DefaultIcon`
	registry.DeleteKey(registry.CURRENT_USER, iconKeyPath)

	// 最后删除主 ProgID 键
	registry.DeleteKey(registry.CURRENT_USER, progKeyPath)

	// 3. 通知 Shell 刷新
	C.notifyShellChange()

	return nil
}

// IsDefaultPlayer 检查 MusicLite 是否为 .mp3 的默认播放器（Windows 实现）
func (a *MusicService) IsDefaultPlayer() (bool, error) {
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

// isRegisteredWithCorrectPath 检查当前注册的路径是否与当前 exe 路径一致
func (a *MusicService) isRegisteredWithCorrectPath(currentExePath string) bool {
	cmdKeyPath := `Software\Classes\` + progID + `\shell\open\command`
	k, err := registry.OpenKey(registry.CURRENT_USER, cmdKeyPath, registry.QUERY_VALUE)
	if err != nil {
		return false
	}
	defer k.Close()

	val, _, err := k.GetStringValue("")
	if err != nil {
		return false
	}

	// 检查注册表中的命令是否包含当前 exe 路径
	// 注册表中的格式是: "C:\path\to\exe.exe" "%1"
	// 我们需要提取出 exe 路径进行比较
	return strings.Contains(val, currentExePath)
}
