package main

import (
	"embed"
	"fmt"
	"os"
	"path/filepath"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
)

//go:embed all:frontend/dist
var assets embed.FS

func main() {
	// 单实例控制：若有旧实例运行则 taskkill 后接管
	ensureSingleInstance()
	file := getFileInArgs()
	// 创建应用实例并连接数据库
	app, err := NewApp(dbFile, file)
	if err != nil {
		panic(err)
	}
	// 确保 i18n.json 已解压到用户数据目录（首次启动）
	ensureI18nFile()
	// 创建音频/封面请求处理器
	audioHandler := NewAudioHandler(app.GetDatabase())

	// 启动应用
	err = wails.Run(&options.App{
		Title:     "MusicLite",
		Width:     1024,
		Height:    580,
		Frameless: isFrameless(), // 无原生边框：Windows/Linux 无，Mac 使用带边框但隐藏标题栏按钮
		AssetServer: &assetserver.Options{
			Assets:  assets,
			Handler: audioHandler, // 处理 /audio/<id> 和 /cover/<id> 请求
		},
		BackgroundColour: &options.RGBA{R: 18, G: 18, B: 18, A: 1},
		Windows:          getWindowsOptions(), // Windows 平台专属选项（WebView 用户数据目录等）
		Mac:              getMacOptions(),     // macOS 平台专属选项
		Linux:            getLinuxOptions(),   // Linux 平台专属选项
		// 启用文件拖放：Wails 拦截系统拖放，通过 runtime.OnFileDrop 事件
		// 把完整文件路径传给前端，绕过 WebView 不暴露路径的安全限制
		// DisableWebViewDrop=false 让 WebView 保留 drag 事件用于遮罩视觉反馈
		DragAndDrop: &options.DragAndDrop{
			EnableFileDrop:     true,
			DisableWebViewDrop: false,
		},
		OnStartup:     app.startup,
		OnShutdown:    app.shutdown,
		OnBeforeClose: app.onBeforeClose, // 关闭窗口时最小化到托盘而非退出
		Bind: []interface{}{
			app,
		},
	})

	if err != nil {
		panic(fmt.Sprintf("Error: %s", err.Error()))
	}
}

// isFrameless 返回各平台是否使用无边框模式
// Windows/Linux 默认无边框，前端自绘标题栏
// macOS 为兼容性保留原生标题栏（可在 getMacOptions 中进一步配置隐藏/自定义按钮）
func isFrameless() bool {
	// 统一无边框：前端自绘标题栏 + Wails 拖拽区
	// 如需各平台差异化，可改为 runtime.GOOS 判断
	return true
}

// 获取 exe 所在目录（工具函数，仅供 main.go 内部使用）
func exeDir() string {
	exePath, _ := os.Executable()
	return filepath.Dir(exePath)
}
