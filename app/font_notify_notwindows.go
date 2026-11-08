//go:build !windows

package app

// broadcastFontChange 非 Windows 平台空实现。
func broadcastFontChange() {}

// notifyShellAssocChanged 非 Windows 平台空实现。
func notifyShellAssocChanged() {}
