package main

import (
	"embed"
	"fmt"
	"os"
	"path/filepath"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
	"github.com/wailsapp/wails/v2/pkg/options/windows"
)

//go:embed all:frontend/dist
var assets embed.FS

func main() {
	// 创建应用实例并连接数据库
	app, err := NewApp(dbFile)
	if err != nil {
		panic(err)
	}

	// 创建音频/封面请求处理器
	audioHandler := NewAudioHandler(app.GetDatabase())

	// WebView2 用户数据目录（指定到 exe 旁的独立目录，避免旧数据被锁导致控制器创建失败）
	exePath, _ := os.Executable()
	webviewDataPath := filepath.Join(filepath.Dir(exePath), "webview-data")
	os.MkdirAll(webviewDataPath, 0755)

	// 启动应用
	err = wails.Run(&options.App{
		Title:     "MusicLite",
		Width:     1024,
		Height:    580,
		Frameless: true, // 无 Windows 原生边框，前端使用自定义标题栏
		AssetServer: &assetserver.Options{
			Assets:  assets,
			Handler: audioHandler, // 处理 /audio/<id> 和 /cover/<id> 请求
		},
		BackgroundColour: &options.RGBA{R: 18, G: 18, B: 18, A: 1},
		Windows: &windows.Options{
			WebviewUserDataPath: webviewDataPath,
		},
		OnStartup:  app.startup,
		OnShutdown: app.shutdown,
		Bind: []interface{}{
			app,
		},
	})

	if err != nil {
		panic(fmt.Sprintf("Error: %s", err.Error()))
	}
}
