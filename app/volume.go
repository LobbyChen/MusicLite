package app

// ============ 音量控制（跨平台）============
//
// 设计两种音量模式：
//   - "synth"  模式（默认）：软件音量，由后端播放器 effects.Volume 节点直接调节 Go 进程输出
//     Windows 下额外同步到系统音量合成器中本进程的会话音量（按 PID 匹配）
//     Linux/macOS 下无应用级系统音量概念，仅内部软件音量生效
//   - "master" 模式：系统主音量，使用 itchyny/volume-go 跨平台库
//
// synth 模式下播放器内部 Volume 节点始终生效（保证所有平台都能正常调整音量），
// Windows 的"按 PID 匹配音频会话"仅是锦上添花：让系统音量合成器显示的 MusicLite 滑块
// 与 UI 滑块同步，用户也能从系统合成器反推设置。
//
// 平台差异：
//   - Windows: synth 模式同时设置 beep 软件音量 + 系统会话音量（COM Core Audio）
//   - macOS/Linux: synth 模式仅设置 beep 软件音量（volume_notwindows.go 存根静默成功）
//   - 三平台 master 模式均使用 itchyny/volume-go

import (
	"fmt"
	"log"

	volume "github.com/itchyny/volume-go"
)

// SetSystemMasterVolume 设置系统主音量 (0-100)
// 由 itchyny/volume-go 跨平台实现：
//   - Windows: 走 Core Audio / MMDevice API
//   - macOS:   走 AppleScript / CoreAudio
//   - Linux:   走 amixer (ALSA) / pactl (PulseAudio)
func (a *MusicService) SetSystemMasterVolume(vol int) error {
	// 钳制范围
	if vol < 0 {
		vol = 0
	}
	if vol > 100 {
		vol = 100
	}

	err := volume.SetVolume(vol)
	if err != nil {
		return fmt.Errorf("设置系统主音量失败: %w", err)
	}

	log.Printf("[Volume] SetSystemMasterVolume(%d) OK", vol)
	return nil
}

// GetSystemMasterVolume 获取系统主音量 (0-100)
func (a *MusicService) GetSystemMasterVolume() (int, error) {
	vol, err := volume.GetVolume()
	if err != nil {
		return 0, fmt.Errorf("获取系统主音量失败: %w", err)
	}

	log.Printf("[Volume] GetSystemMasterVolume vol=%d", vol)
	return vol, nil
}

// MuteSystemMasterVolume 静音系统
func (a *MusicService) MuteSystemMasterVolume() error {
	err := volume.Mute()
	if err != nil {
		return fmt.Errorf("静音失败: %w", err)
	}
	log.Printf("[Volume] MuteSystemMasterVolume OK")
	return nil
}

// UnmuteSystemMasterVolume 取消静音
func (a *MusicService) UnmuteSystemMasterVolume() error {
	err := volume.Unmute()
	if err != nil {
		return fmt.Errorf("取消静音失败: %w", err)
	}
	log.Printf("[Volume] UnmuteSystemMasterVolume OK")
	return nil
}
