package main

import (
	"embed"
	"fmt"
	"net/http"
	"runtime"
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
	// 桌面端：自定义标题栏 + 透明背景 + 文件拖放
	// Android：由系统 Activity 接管窗口装饰，禁用所有桌面专有特性
	winOpts := application.WebviewWindowOptions{
		Name:   "main",
		Title:  "MusicLite",
		Width:  1024,
		Height: 580,
	}
	if runtime.GOOS != "android" {
		winOpts.Frameless = true             // 无原生边框：前端自绘标题栏
		winOpts.EnableFileDrop = true       // 启用文件拖放
		winOpts.BackgroundType = application.BackgroundTypeTransparent
		winOpts.BackgroundColour = application.RGBA{Red: 0, Green: 0, Blue: 0, Alpha: 0}
		winOpts.Windows = application.WindowsWindow{
			// 开启 WebView2 原生 NonClientRegion 支持，让 CSS 的 app-region: drag 生效
			// （配合 --wails-draggable 做双保险）
			NonClientRegionSupport: true,
		}
	}
	mainWindow := wailsApp.Window.NewWithOptions(winOpts)

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
