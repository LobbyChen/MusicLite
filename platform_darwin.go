//go:build darwin

package main

import (
	"github.com/wailsapp/wails/v2/pkg/options/linux"
	"github.com/wailsapp/wails/v2/pkg/options/mac"
	"github.com/wailsapp/wails/v2/pkg/options/windows"
)

// getWindowsOptions macOS 编译时返回 nil
func getWindowsOptions() *windows.Options {
	return nil
}

// getMacOptions macOS 平台专属配置
// - Titlebar: 使用隐藏标题栏但保留交通灯按钮（AppTransportView 风格），前端自绘拖拽区
func getMacOptions() *mac.Options {
	return &mac.Options{
		Titlebar: &mac.Titlebar{
			TitlebarAppearsTransparent: true,
			HideTitle:                  true,
			HideTitleBar:               false,
			FullSizeContent:            true,
			UseToolbar:                 false,
			HideToolbarSeparator:       true,
		},
		// macOS 下 WebKit 隐私保护：允许应用访问自身数据目录
		// 文件访问 Bookmark 等在 Wails 内部已处理，此处无需额外配置
	}
}

// getLinuxOptions macOS 编译时返回 nil
func getLinuxOptions() *linux.Options {
	return nil
}
