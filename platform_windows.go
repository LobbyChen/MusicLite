//go:build windows

package main

import (
	"os"
	"path/filepath"

	"github.com/wailsapp/wails/v2/pkg/options/linux"
	"github.com/wailsapp/wails/v2/pkg/options/mac"
	"github.com/wailsapp/wails/v2/pkg/options/windows"
)

// getWindowsOptions Windows 平台专属配置
// - WebviewUserDataPath: WebView2 用户数据目录（exe 旁，避免旧数据被锁导致控制器创建失败）
func getWindowsOptions() *windows.Options {
	webviewDataPath := filepath.Join(exeDir(), "webview-data")
	os.MkdirAll(webviewDataPath, 0755)
	return &windows.Options{
		WebviewUserDataPath: webviewDataPath,
	}
}

// getMacOptions Windows 编译时返回 nil
func getMacOptions() *mac.Options {
	return nil
}

// getLinuxOptions Windows 编译时返回 nil
func getLinuxOptions() *linux.Options {
	return nil
}
