//go:build windows

package main

import _ "embed"

// trayIconData Windows 托盘图标：嵌入 .ico 格式（getlantern/systray 在 Windows 上支持 ICO）
//
//go:embed frontend/src/assets/icon.ico
var trayIconData []byte
