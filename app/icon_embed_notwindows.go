//go:build !windows

package app

import _ "embed"

// trayIconData macOS / Linux 托盘图标：嵌入 .png 格式
//（getlantern/systray 在 macOS 和 Linux GTK/StatusNotifier 上接受 PNG）
//
//go:embed assets/icon.png
var trayIconData []byte
