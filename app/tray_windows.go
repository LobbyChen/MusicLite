//go:build windows

package app

// ============ Windows 托盘菜单定位 ============
//
// 说明：Wails v3 Window.SetPosition / Position() 使用的是"逻辑像素(DIP)"，
// 而 Win32 GetCursorPos / GetMonitorInfoW 返回的是"设备物理像素(Device Pixels)"。
// 高 DPI（125% / 150% / 200% 等）下若直接用物理像素传入 SetPosition，
// 菜单会飞出可见区，看起来像"没弹出来"。本文件做 DPI 换算后再定位。

import (
	"syscall"
	"unsafe"
)

const (
	_MONITOR_DEFAULTTONEAREST = 0x00000002
	_MDT_EFFECTIVE_DPI        = 0
)

type _POINT struct {
	X int32
	Y int32
}

type _RECT struct {
	Left   int32
	Top    int32
	Right  int32
	Bottom int32
}

type _MONITORINFO struct {
	CbSize    uint32
	RcMonitor _RECT
	RcWork    _RECT
	DwFlags   uint32
}

var (
	_user32dll    = syscall.NewLazyDLL("user32.dll")
	_shcoredll    = syscall.NewLazyDLL("shcore.dll")
	_procGetCursorPos     = _user32dll.NewProc("GetCursorPos")
	_procMonitorFromPoint = _user32dll.NewProc("MonitorFromPoint")
	_procGetMonitorInfoW  = _user32dll.NewProc("GetMonitorInfoW")
	_procGetDpiForMonitor = _shcoredll.NewProc("GetDpiForMonitor")
)

func getCursorPos() (x, y int32, ok bool) {
	var pt _POINT
	r, _, _ := _procGetCursorPos.Call(uintptr(unsafe.Pointer(&pt)))
	if r == 0 {
		return 0, 0, false
	}
	return pt.X, pt.Y, true
}

// getMonitorInfoAndDpi 返回指定点所在显示器的 WorkingArea（设备像素）与 DPI 缩放系数
// scale = dpi / 96.0， 逻辑像素 = 物理像素 / scale
func getMonitorInfoAndDpi(px, py int32) (wl, wt, wr, wb int32, scale float64, ok bool) {
	pt := _POINT{X: px, Y: py}
	hMonitor, _, _ := _procMonitorFromPoint.Call(
		uintptr(*(*int64)(unsafe.Pointer(&pt))),
		uintptr(_MONITOR_DEFAULTTONEAREST),
	)
	if hMonitor == 0 {
		return 0, 0, 0, 0, 1.0, false
	}
	var mi _MONITORINFO
	mi.CbSize = uint32(unsafe.Sizeof(mi))
	r, _, _ := _procGetMonitorInfoW.Call(hMonitor, uintptr(unsafe.Pointer(&mi)))
	if r == 0 {
		return 0, 0, 0, 0, 1.0, false
	}
	scale = 1.0
	var dpiX, dpiY uint32
	// GetDpiForMonitor( HMONITOR, MDT_EFFECTIVE_DPI, &dpiX, &dpiY )
	r2, _, _ := _procGetDpiForMonitor.Call(
		hMonitor,
		uintptr(_MDT_EFFECTIVE_DPI),
		uintptr(unsafe.Pointer(&dpiX)),
		uintptr(unsafe.Pointer(&dpiY)),
	)
	if r2 == 0 && dpiX >= 96 { // HRESULT 0 表示 SUCCESS
		scale = float64(dpiX) / 96.0
	}
	return mi.RcWork.Left, mi.RcWork.Top, mi.RcWork.Right, mi.RcWork.Bottom, scale, true
}

// calculateTrayMenuPosition 计算菜单位置（返回 Wails SetPosition 需要的 DIP 逻辑像素）
// menuW / menuH 是菜单宽高（DIP 逻辑像素，即 tray-menu 初始化的 280/260）。
// x, y 返回正值表示可用坐标；负值表示"fallback 到 tray.ShowWindow()"。
func calculateTrayMenuPosition(menuW, menuH int32) (x, y int32) {
	// 1) 鼠标物理坐标
	cx, cy, ok := getCursorPos()
	if !ok {
		return -1, -1
	}

	// 2) WorkingArea 物理坐标 + DPI scale
	wl, wt, wr, wb, scale, ok := getMonitorInfoAndDpi(cx, cy)
	if !ok {
		return -1, -1
	}
	if scale <= 0 {
		scale = 1.0
	}

	// 3) 鼠标坐标相对于 WorkingArea 四条边的距离（物理像素），判断任务栏方向
	const edgeThresholdPx int32 = 100 // 物理像素阈值
	distLeft := cx - wl
	distRight := wr - cx
	distTop := cy - wt
	distBottom := wb - cy

	nearBottom := distBottom < edgeThresholdPx && distBottom < distTop && distBottom < distLeft && distBottom < distRight
	nearTop := distTop < edgeThresholdPx && distTop < distBottom && distTop < distLeft && distTop < distRight
	nearRight := distRight < edgeThresholdPx && distRight < distBottom && distRight < distTop && distRight < distLeft
	nearLeft := distLeft < edgeThresholdPx && distLeft < distBottom && distLeft < distTop && distLeft < distRight

	// 4) 将鼠标位置、WorkingArea 边界换算成 DIP 逻辑坐标（交给 Wails SetPosition）
	cxLog := int32(float64(cx) / scale)
	cyLog := int32(float64(cy) / scale)
	wlLog := int32(float64(wl) / scale)
	wtLog := int32(float64(wt) / scale)
	wrLog := int32(float64(wr) / scale)
	wbLog := int32(float64(wb) / scale)

	// 5) 根据任务栏方向设置锚点（DIP 坐标）
	switch {
	case nearBottom:
		// 底部任务栏：菜单右下角对齐鼠标，向上展开
		x = cxLog - menuW
		y = cyLog - menuH
	case nearTop:
		// 顶部任务栏：菜单右上角对齐鼠标，向下展开
		x = cxLog - menuW
		y = cyLog
	case nearRight:
		// 右侧任务栏：菜单左下角对齐鼠标，向左展开
		x = cxLog - menuW
		y = cyLog - menuH
	case nearLeft:
		// 左侧任务栏：菜单左上角对齐鼠标，向右展开
		x = cxLog
		y = cyLog - menuH
	default:
		// 非边缘（通知溢出区）：菜单左上角位于鼠标右下方
		x = cxLog
		y = cyLog
	}

	// 6) WorkingArea（DIP）边界裁剪，保证菜单完整落在可见区
	if x+menuW > wrLog {
		x = wrLog - menuW
	}
	if x < wlLog {
		x = wlLog
	}
	if y+menuH > wbLog {
		y = wbLog - menuH
	}
	if y < wtLog {
		y = wtLog
	}

	return x, y
}
