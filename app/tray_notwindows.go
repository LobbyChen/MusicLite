//go:build !windows

package app

// ============ 非 Windows 托盘菜单定位 fallback ============
// 简单返回 (0, 0) 让调用方用 Wails 内置 AttachWindow + ShowWindow 定位

func calculateTrayMenuPosition(menuW, menuH int32) (x, y int32) {
	return -1, -1 // 负值表示"未实现，调用方 fallback 到 tray.ShowWindow()"
}
