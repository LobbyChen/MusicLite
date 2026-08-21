//go:build windows

package app

import _ "embed"

// TrayIconData Windows 托盘图标：嵌入 .png 格式
// Wails v3 SetIcon → CreateSmallHIconFromImage → CreateIconFromResourceEx
// 该 API 期望 RT_ICON 资源数据（PNG 或 BMP），不兼容完整 ICO 文件（含 ICONDIR 头）
//
//go:embed assets/icon.png
var TrayIconData []byte
