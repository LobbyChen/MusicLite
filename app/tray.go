package app

// ============ 系统托盘（前端自绘菜单模式）============
//
// 行为：
//   - 左键单击：切换主窗口显示/隐藏（保留此经典行为）
//   - 左键双击：显示主窗口并聚焦
//   - 右键单击：显示前端自绘"托盘菜单窗口"（traypopup WebViewWindow）
//     窗口内容由 frontend/src/html/tray-menu.html 渲染；
//     位置在 Windows 下用 Win32 API 手动计算（按任务栏方向 DIP 换算 + 边界裁剪），
//     非 Windows 下 fallback 到 tray.ShowWindow() 自动定位。
//
// 菜单窗口关闭逻辑：
//   - Go：WindowLostFocus Hide，但显示后 300ms 内屏蔽 Hide，避免首帧焦点抖动。
//   - 前端：Esc、点击菜单外部、窗口 blur 事件均调用 HideTrayMenu()。

import (
	"fmt"
	"sync/atomic"
	"time"

	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"
)

// 主窗口 / 子窗口名称（与 main.go 中 WebviewWindowOptions.Name 保持一致）
const (
	trayMainWindowName     = "main"
	trayPopupWindowName    = "traypopup"
	traySettingsWindowName = "settings"
)

// initTray 初始化：创建 SystemTray 图标 + Attach 自绘菜单窗口
func (s *MusicService) initTray() {
	strs := s.getBackendStrings()

	// ---------- 1) 获取 / 创建 traypopup 窗口 ----------
	trayPopup, ok := s.app.Window.GetByName(trayPopupWindowName)
	if !ok {
		trayPopup = s.app.Window.NewWithOptions(application.WebviewWindowOptions{
			Name:    trayPopupWindowName,
			Title:   "Tray Menu",
			URL:     "/src/html/tray-menu.html",
			Width:   280,
			Height:  260,
			Hidden:  true,
			Frameless:       true,
			AlwaysOnTop:     true,
			DisableResize:   true,
			BackgroundColour: application.RGBA{Red: 30, Green: 31, Blue: 34, Alpha: 0},
			Windows: application.WindowsWindow{
				HiddenOnTaskbar:      true,
				NonClientRegionSupport: false,
			},
		})
	}
	s._trayPopup = trayPopup

	// _suppressLostFocus：显示后 300ms 内屏蔽 WindowLostFocus Hide，
	// 避免"首帧焦点抖动"（刚 Show 还没拿到焦点就被失焦事件立刻 Hide）。
	var _suppressLostFocus atomic.Bool
	_suppressLostFocus.Store(false)

	trayPopup.OnWindowEvent(events.Common.WindowLostFocus, func(_ *application.WindowEvent) {
		if _suppressLostFocus.Load() {
			return
		}
		trayPopup.Hide()
	})

	// ---------- 2) 创建 SystemTray 图标 ----------
	tray := s.app.SystemTray.New()
	if len(trayIconData) > 0 {
		tray.SetIcon(trayIconData)
	}
	tray.SetLabel("MusicLite")
	tray.SetTooltip(strs.TrayTooltip)
	s._tray = tray
	// 保留 AttachWindow 用于非 Windows 的 tray.ShowWindow() 自动定位
	tray.AttachWindow(trayPopup)
	tray.WindowOffset(4)

	// ---------- 3) 鼠标事件 ----------
	tray.OnClick(func() {
		// 左键：先收起菜单窗口，再切换主窗口
		if s._trayPopup != nil {
			s._trayPopup.Hide()
		}
		s.toggleMainWindow()
	})
	tray.OnRightClick(func() {
		// 右键：显示前端自绘菜单
		if s._trayPopup == nil {
			s.app.Event.Emit("tray:rightclick")
			return
		}
		const menuW int32 = 280
		const menuH int32 = 260

		// 先隐藏当前已显示的菜单（避免它正在别的位置），然后重新定位再显示
		if s._trayPopup.IsVisible() {
			s._trayPopup.Hide()
		}

		// 屏蔽 WindowLostFocus Hide 300ms，防止首帧焦点抖动
		_suppressLostFocus.Store(true)
		go func() {
			time.Sleep(300 * time.Millisecond)
			_suppressLostFocus.Store(false)
		}()

		x, y := calculateTrayMenuPosition(menuW, menuH)
		if x >= 0 && y >= 0 {
			// Windows：手动计算 DIP 坐标 → SetPosition → Show → 延迟 Focus
			s._trayPopup.SetPosition(int(x), int(y))
			s._trayPopup.Show()
			go func() {
				time.Sleep(20 * time.Millisecond)
				trayPopup.Focus()
			}()
		} else {
			// 非 Windows 或 Win32 API 失败：fallback 到 Wails 内置 tray.ShowWindow()
			s._tray.ShowWindow()
			go func() {
				time.Sleep(20 * time.Millisecond)
				trayPopup.Focus()
			}()
		}
	})
	tray.OnDoubleClick(func() {
		if s._trayPopup != nil {
			s._trayPopup.Hide()
		}
		s.showMainWindow()
	})
}

// toggleMainWindow 切换主窗口显示/隐藏（托盘左键单击时调用）
func (s *MusicService) toggleMainWindow() {
	window, ok := s.app.Window.GetByName(trayMainWindowName)
	if !ok {
		window = s.app.Window.Current()
	}
	if window == nil {
		return
	}
	if window.IsVisible() {
		window.Hide()
	} else {
		window.Show()
		window.Focus()
	}
}

// ShowMainWindow 暴露给前端：从自定义菜单中打开主窗口
func (s *MusicService) ShowMainWindow() {
	s.showMainWindow()
}

// HideMainWindow 暴露给前端：关闭按钮 → 隐藏到托盘（而非退出）
func (s *MusicService) HideMainWindow() {
	window, ok := s.app.Window.GetByName(trayMainWindowName)
	if !ok {
		window = s.app.Window.Current()
	}
	if window != nil {
		window.Hide()
	}
}

// QuitApp 暴露给前端：从自定义菜单触发退出（设置 trayQuitting 以便窗口关闭钩子放行）
func (s *MusicService) QuitApp() {
	s.trayQuitting = true
	s.app.Quit()
}

// TogglePlayPause 暴露给前端：自定义托盘菜单中切换播放/暂停
func (s *MusicService) TogglePlayPause() {
	if s.player != nil {
		s.player.toggle()
	}
}

// GetTrayState 返回托盘菜单需要的状态（当前曲目名、是否播放中、封面Base64），供前端自定义菜单渲染
type TrayState struct {
	TrackName   string `json:"trackName"`
	ArtistName  string `json:"artistName"`
	IsPlaying   bool   `json:"isPlaying"`
	CoverBase64 string `json:"coverBase64"`
}

// GetTrayState 暴露给前端：拉取当前托盘状态
func (s *MusicService) GetTrayState() TrayState {
	state := TrayState{}
	if s.player == nil {
		return state
	}
	snap := s.player.snapshot()
	state.IsPlaying = snap.IsPlaying
	if snap.Track != nil {
		state.TrackName = snap.Track.Name
		state.ArtistName = snap.Track.Author
		coverData, mime, _ := s.database.GetTrackCover(fmt.Sprintf("%d", snap.Track.ID))
		state.CoverBase64 = encodeCoverBase64(coverData, mime)
	}
	return state
}

// HideTrayMenu 暴露给前端：关闭自绘托盘菜单窗口（前端 Esc / 点击外部 / blur 等都可调用）
func (s *MusicService) HideTrayMenu() {
	if s._trayPopup != nil {
		s._trayPopup.Hide()
	}
}

// OpenSettingsWindow 暴露给前端：从托盘菜单 / 主界面打开设置窗口
func (s *MusicService) OpenSettingsWindow() {
	settingsWindow := s.ensureSettingsWindow()
	if settingsWindow == nil {
		return
	}
	if settingsWindow.IsVisible() {
		settingsWindow.Focus()
	} else {
		// 默认在主窗口居中打开设置窗口
		mainWin, _ := s.app.Window.GetByName(trayMainWindowName)
		if mainWin != nil {
			mw, mh := mainWin.Size()
			mx, my := mainWin.Position()
			sw, sh := settingsWindow.Size()
			newX := mx + (mw-sw)/2
			newY := my + (mh-sh)/2
			if newX < 0 { newX = 0 }
			if newY < 0 { newY = 0 }
			settingsWindow.SetPosition(newX, newY)
		}
		settingsWindow.Show()
		settingsWindow.Focus()
	}
}

// ensureSettingsWindow 获取或懒创建设置子窗口
func (s *MusicService) ensureSettingsWindow() application.Window {
	if s._settingsWin != nil {
		return s._settingsWin
	}
	win, ok := s.app.Window.GetByName(traySettingsWindowName)
	if !ok {
		win = s.app.Window.NewWithOptions(application.WebviewWindowOptions{
			Name:             traySettingsWindowName,
			Title:            "MusicLite Settings",
			URL:              "/src/html/settings.html",
			Width:            760,
			Height:           560,
			MinWidth:         640,
			MinHeight:        440,
			Frameless:        true,
			Hidden:           true,
			AlwaysOnTop:      false,
			BackgroundColour: application.RGBA{Red: 18, Green: 18, Blue: 18, Alpha: 255},
			Windows: application.WindowsWindow{
				HiddenOnTaskbar:     false,
				NonClientRegionSupport: true,
			},
		})
		// 设置窗口自身的关闭按钮（Frameless 前端自绘）按"隐藏到托盘"处理
		win.OnWindowEvent(events.Common.WindowClosing, func(event *application.WindowEvent) {
			if !s.IsTrayQuitting() {
				event.Cancel()
				win.Hide()
			}
		})
	}
	s._settingsWin = win
	return win
}

// showMainWindow 显示主窗口（若已最小化到托盘则恢复）
func (s *MusicService) showMainWindow() {
	window, ok := s.app.Window.GetByName(trayMainWindowName)
	if !ok {
		window = s.app.Window.Current()
	}
	if window != nil {
		window.Show()
		window.Focus()
	}
}
