//go:build windows

package app

import "syscall"

// Windows API 常量
const (
	HWND_BROADCAST = uintptr(0xFFFF)
	WM_FONTCHANGE  = uint32(0x001D)
)

var (
	user32            = syscall.NewLazyDLL("user32.dll")
	procSendNotifyMsg = user32.NewProc("SendNotifyMessageW")
)

// broadcastFontChange 广播 WM_FONTCHANGE 消息，通知系统字体列表已变化
// 安装新字体后调用，让正在运行的应用程序感知到新字体
// 非 Windows 平台：由 font_notify_notwindows.go 提供空实现
func broadcastFontChange() {
	procSendNotifyMsg.Call(
		HWND_BROADCAST,
		uintptr(WM_FONTCHANGE),
		uintptr(0),
		uintptr(0),
	)
}
