//go:build linux

package main

import (
	"github.com/wailsapp/wails/v2/pkg/options/linux"
	"github.com/wailsapp/wails/v2/pkg/options/mac"
	"github.com/wailsapp/wails/v2/pkg/options/windows"
)

// getWindowsOptions Linux 编译时返回 nil
func getWindowsOptions() *windows.Options {
	return nil
}

// getMacOptions Linux 编译时返回 nil
func getMacOptions() *mac.Options {
	return nil
}

// getLinuxOptions Linux 平台专属配置
func getLinuxOptions() *linux.Options {
	return &linux.Options{
		// Wails v2 for Linux 暂无需要特别配置的项
		// 程序图标/桌面文件等由打包脚本（deb/rpm/AppImage）负责
	}
}
