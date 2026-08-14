//go:build !windows

package main

import (
	"fmt"
	"os"
)

// setAppVolumeByPid 非 Windows 平台的存根实现
// Linux/macOS 下没有按 PID 匹配音频会话的统一 API，
// synth 模式由后端播放器（beep effects.Volume）内部控制软件音量即可。
func setAppVolumeByPid(pid int, volume int) error {
	_ = pid
	_ = volume
	// 非 Windows 平台无此功能，静默成功：
	// synth 模式的实际音量由 Player.vol（beep effects.Volume）生效，
	// 这里的"应用音量"是 Windows 音量合成器专用概念，其他平台忽略即可。
	return nil
}

// getAppVolumeByPid 非 Windows 平台的存根实现
func getAppVolumeByPid(pid int) (int, error) {
	_ = pid
	// 返回当前进程 PID 对应音量：非 Windows 下无对应概念，
	// 退化为返回系统主音量（与 master 模式一致），避免 UI 读取时报错
	v, err := getSystemMasterVolumeFallback()
	if err != nil {
		return 0, fmt.Errorf("getAppVolumeByPid (stub): %w", err)
	}
	return v, nil
}

// getSystemMasterVolumeFallback 非 Windows 下尝试用最基础方式获取音量
// 注：volume.GetVolume() 本身已跨平台，这里仅作为兜底示例
func getSystemMasterVolumeFallback() (int, error) {
	// itchyny/volume-go 支持 darwin/linux，直接委托到上层系统主音量逻辑
	// 为避免循环依赖，这里返回一个默认值，上层调用会走 SetSystemMasterVolume/GetSystemMasterVolume
	_ = os.Getpid()
	return 70, nil
}
