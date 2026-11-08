//go:build windows

package app

import "syscall"

const (
	hwndBroadcast = uintptr(0xFFFF)
	wmFontChange  = uint32(0x001D)
)

var (
	user32            = syscall.NewLazyDLL("user32.dll")
	procSendNotifyMsg = user32.NewProc("SendNotifyMessageW")
	procShellChange   = syscall.NewLazyDLL("shell32.dll").NewProc("SHChangeNotify")
)

// broadcastFontChange 广播 WM_FONTCHANGE，通知系统字体列表已变化。
func broadcastFontChange() {
	procSendNotifyMsg.Call(hwndBroadcast, uintptr(wmFontChange), 0, 0)
}

// notifyShellAssocChanged 通知 Shell 刷新文件关联图标。
func notifyShellAssocChanged() {
	const (
		shcneAssocChanged = 0x08000000
		shcnfIdList       = 0x0000
	)
	procShellChange.Call(uintptr(shcneAssocChanged), uintptr(shcnfIdList), 0, 0)
}
