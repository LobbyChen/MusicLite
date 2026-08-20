//go:build android

package app

// ============ 音量控制（Android 存根）============
//
// Android 下系统音量由前端 <audio> 元素控制（audio.volume），
// 后端无需也无法直接操作系统主音量。此处提供 no-op 存根，
// 让 MusicService 接口在 Android 下可编译、可调用。
//
// 与 volume.go（!android）互斥：桌面端走 itchyny/volume-go 真实实现，
// Android 走此存根。

// SetSystemMasterVolume Android 存根：静默成功，不操作系统音量
func (a *MusicService) SetSystemMasterVolume(vol int) error {
	_ = vol
	return nil
}

// GetSystemMasterVolume Android 存根：返回默认值 70
func (a *MusicService) GetSystemMasterVolume() (int, error) {
	return 70, nil
}

// MuteSystemMasterVolume Android 存根：静默成功
func (a *MusicService) MuteSystemMasterVolume() error {
	return nil
}

// UnmuteSystemMasterVolume Android 存根：静默成功
func (a *MusicService) UnmuteSystemMasterVolume() error {
	return nil
}
