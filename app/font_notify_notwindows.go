//go:build !windows

package app

// broadcastFontChange 非 Windows 平台空实现
// - Linux/macOS 没有统一的"安装字体后广播通知"机制
// - Linux 下通常由 fontconfig 通过 inotify 监控 ~/.fonts / /usr/share/fonts 目录自动刷新
// - macOS 下安装字体后 CoreText 会自动更新
// 因此本函数不做任何操作即可，返回空
func broadcastFontChange() {
}
