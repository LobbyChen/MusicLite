package main

import (
	"embed"
	"fmt"
	"net/http"
	"strings"

	"MusicLite/app"

	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"
)

//go:embed all:frontend/dist
var assets embed.FS

func main() {
	// 单实例控制：若有旧实例运行则 taskkill 后接管
	app.EnsureSingleInstance()
	file := app.GetFileInArgs()

	// 确保 i18n.json 已解压到用户数据目录（首次启动）
	app.EnsureI18nFile()

	// 音频/封面处理器引用，在创建服务后赋值（供 AssetServer 中间件使用）
	var audioHandler *app.AudioHandler

	// 创建 v3 应用实例
	wailsApp := application.New(application.Options{
		Name:        "MusicLite",
		Description: "MusicLite 离线音乐播放器",
		Icon:        app.TrayIconData,
		Assets: application.AssetOptions{
			Handler: application.AssetFileServerFS(assets),
			// 中间件：拦截 /audio/ 和 /cover/ 请求交给 AudioHandler，
			// 其余请求走默认文件服务器（嵌入的前端资源）
			Middleware: func(next http.Handler) http.Handler {
				return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					if audioHandler != nil &&
						(strings.HasPrefix(r.URL.Path, "/audio/") || strings.HasPrefix(r.URL.Path, "/cover/")) {
						audioHandler.ServeHTTP(w, r)
						return
					}
					next.ServeHTTP(w, r)
				})
			},
		},
		// 阻止最后一个窗口关闭时自动退出（最小化到托盘场景需要）
		Windows: application.WindowsOptions{
			DisableQuitOnLastWindowClosed: true,
		},
		Linux: application.LinuxOptions{
			DisableQuitOnLastWindowClosed: true,
		},
	})

	// 创建主服务并连接数据库
	svc, err := app.NewMusicService(wailsApp, app.DBFile, file)
	if err != nil {
		panic(err)
	}

	// 创建音频/封面请求处理器（生产模式用，通过 AssetServer 中间件路由）
	audioHandler = app.NewAudioHandler(svc.GetDatabase())

	// 注册服务（v3 Service 模式，替代 v2 的 Bind）
	wailsApp.RegisterService(application.NewService(svc))

	// 创建主窗口
	mainWindow := wailsApp.Window.NewWithOptions(application.WebviewWindowOptions{
		Name:           "main",
		Title:          "MusicLite",
		Icon:           app.TrayIconData,
		Width:          1024,
		Height:         580,
		Frameless:      true, // 无原生边框：前端自绘标题栏
		EnableFileDrop: true, // 启用文件拖放
		// BackgroundTypeTransparent：Wails v3 官方透明背景开关
		//   - 仅 BackgroundColour.Alpha=0 在 Solid 模式下无效（默认 BackgroundType=Solid）
		//   - 必须显式设为 BackgroundTypeTransparent，Windows 才会走分层窗口 + WebView2 透明合成
		//   - 配合 BackgroundColour={R:0,G:0,B:0,A:0} 让窗口底色完全透明，真实视觉由 CSS 提供
		BackgroundType: application.BackgroundTypeTransparent,
		BackgroundColour: application.RGBA{
			Red: 0, Green: 0, Blue: 0, Alpha: 0,
		},
		Windows: application.WindowsWindow{
			// 开启 WebView2 原生 NonClientRegion 支持，让 CSS 的 app-region: drag 生效
			// （配合 --wails-draggable 做双保险）
			NonClientRegionSupport: true,
		},
	})

	// 窗口关闭钩子：非托盘退出时最小化到托盘而非关闭
	mainWindow.OnWindowEvent(events.Common.WindowClosing, func(event *application.WindowEvent) {
		if !svc.IsTrayQuitting() {
			event.Cancel()
			mainWindow.Hide()
		}
	})

	// 启动应用
	err = wailsApp.Run()
	if err != nil {
		panic(fmt.Sprintf("Error: %s", err.Error()))
	}
}
