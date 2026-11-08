package volume

import (
	"fmt"
	"log"

	volume "github.com/itchyny/volume-go"
)

// SetMaster 设置系统主音量（0-100）。
func SetMaster(vol int) error {
	if vol < 0 {
		vol = 0
	}
	if vol > 100 {
		vol = 100
	}
	if err := volume.SetVolume(vol); err != nil {
		return fmt.Errorf("设置系统主音量失败: %w", err)
	}
	log.Printf("[Volume] SetMaster(%d) OK", vol)
	return nil
}

// GetMaster 读取系统主音量（0-100）。
func GetMaster() (int, error) {
	v, err := volume.GetVolume()
	if err != nil {
		return 0, fmt.Errorf("获取系统主音量失败: %w", err)
	}
	log.Printf("[Volume] GetMaster vol=%d", v)
	return v, nil
}

func MuteMaster() error {
	if err := volume.Mute(); err != nil {
		return fmt.Errorf("静音失败: %w", err)
	}
	log.Printf("[Volume] MuteMaster OK")
	return nil
}

func UnmuteMaster() error {
	if err := volume.Unmute(); err != nil {
		return fmt.Errorf("取消静音失败: %w", err)
	}
	log.Printf("[Volume] UnmuteMaster OK")
	return nil
}
