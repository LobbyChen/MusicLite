package main

import (
	"context"
	"log"

	"github.com/getlantern/systray"
	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// 托盘图标数据（编译时嵌入）
// 尝试嵌入 icon.ico；如果文件不存在，使用空数据（systray 会显示默认图标）

// initTray 初始化系统托盘图标
// 在 app.startup 中以独立 goroutine 调用
func (a *App) initTray() {
	systray.Run(a.onTrayReady, a.onTrayExit)
}

// onTrayReady 托盘图标就绪回调：设置图标、标题、菜单项
func (a *App) onTrayReady() {
	strs := a.getBackendStrings()

	// 设置托盘图标
	if len(trayIconData) > 0 {
		systray.SetIcon(trayIconData)
	}
	systray.SetTitle("MusicLite")
	systray.SetTooltip(strs.TrayTooltip)

	// 菜单项
	mShow := systray.AddMenuItem(strs.TrayShow, strs.TrayShow)
	systray.AddSeparator()
	mPlay := systray.AddMenuItem(strs.TrayPlayPause, strs.TrayPlayPause)
	systray.AddSeparator()
	mQuit := systray.AddMenuItem(strs.TrayQuit, strs.TrayQuit)

	// 处理菜单点击
	go func() {
		for {
			select {
			case <-mShow.ClickedCh:
				// 显示窗口
				if a.ctx != nil {
					runtime.WindowShow(a.ctx)
				}
			case <-mPlay.ClickedCh:
				// 通知前端切换播放/暂停
				if a.ctx != nil {
					runtime.EventsEmit(a.ctx, "tray:toggle-play")
				}
			case <-mQuit.ClickedCh:
				// 设置退出标志，让 OnBeforeClose 放行
				a.trayQuitting = true
				systray.Quit()
				if a.ctx != nil {
					runtime.Quit(a.ctx)
				}
			}
		}
	}()
}

// onTrayExit 托盘退出回调
func (a *App) onTrayExit() {
	log.Println("托盘已退出")
}

// onBeforeClose 窗口关闭前回调
// 返回 true 阻止关闭（最小化到托盘），返回 false 允许关闭（真正退出）
func (a *App) onBeforeClose(ctx context.Context) bool {
	if a.trayQuitting {
		// 托盘"退出"触发的关闭，放行
		return false
	}
	// 用户点击关闭按钮/Alt+F4：最小化到托盘而非退出
	if ctx != nil {
		runtime.WindowMinimise(ctx)
	}
	return true // 阻止关闭
}
