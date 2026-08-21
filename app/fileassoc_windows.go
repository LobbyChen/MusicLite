//go:build windows

package app

//
// 通过注册 HKCU\Software\Classes\MusicLite.AudioFile ProgID，
// 关联 .mp3/.wav/.flac/.m4a/.ogg/.wma/.aac/.opus/.ape/.alac 扩展名

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

	"golang.org/x/sys/windows/registry"
)

// progID 文件关联的 ProgID 标识符
const progID = "MusicLite.AudioFile"

// supportedExts 支持关联的音频扩展名
var supportedExts = []string{".mp3", ".wav", ".flac", ".m4a", ".ogg", ".wma", ".aac", ".opus", ".ape", ".alac"}

// SetAsDefaultPlayer 将 MusicLite 设为支持音频格式的默认播放器（Windows 实现）
func (a *MusicService) SetAsDefaultPlayer() error {
	exePath, err := os.Executable()
	if err != nil {
		return fmt.Errorf("获取可执行文件路径失败: %w", err)
	}
	exePath, _ = filepath.Abs(exePath)

	// 1. 创建 ProgID：HKCU\Software\Classes\MusicLite.AudioFile
	progKey, _, err := registry.CreateKey(registry.CURRENT_USER, `Software\Classes\`+progID, registry.ALL_ACCESS)
	if err != nil {
		return fmt.Errorf("创建 ProgID 失败: %w", err)
	}
	// 设置友好名称
	progKey.SetStringValue("", "MusicLite 音频文件")
	// 设置默认图标
	iconKey, _, err := registry.CreateKey(registry.CURRENT_USER, `Software\Classes\`+progID+`\DefaultIcon`, registry.ALL_ACCESS)
	if err == nil {
		iconKey.SetStringValue("", exePath+",0")
		iconKey.Close()
	}
	// 设置打开命令
	cmdKey, _, err := registry.CreateKey(registry.CURRENT_USER, `Software\Classes\`+progID+`\shell\open\command`, registry.ALL_ACCESS)
	if err == nil {
		cmdKey.SetStringValue("", fmt.Sprintf(`"%s" "%%1"`, exePath))
		cmdKey.Close()
	}
	progKey.Close()

	// 2. 关联扩展名：HKCU\Software\Classes\.mp3 → MusicLite.AudioFile
	for _, ext := range supportedExts {
		extKey, _, err := registry.CreateKey(registry.CURRENT_USER, `Software\Classes\`+ext, registry.ALL_ACCESS)
		if err != nil {
			continue
		}
		extKey.SetStringValue("", progID)
		// 写入 ProgID 子键（某些 Windows 版本需要）
		extKey.SetStringValue("Progid", progID)
		extKey.Close()
	}

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
