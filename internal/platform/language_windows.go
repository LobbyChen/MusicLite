//go:build windows

package platform

import "golang.org/x/sys/windows"

var procGetUserDefaultUILanguage = windows.NewLazySystemDLL("kernel32.dll").NewProc("GetUserDefaultUILanguage")

// SystemLanguage 返回系统界面语言对应的应用语言：
// 中文（zh-*）使用简体中文，其余语言使用英文。
func SystemLanguage() string {
	ret, _, _ := procGetUserDefaultUILanguage.Call()
	// LANGID 低 10 位为主语言 ID，LANG_CHINESE = 0x04（含 zh-CN / zh-TW / zh-HK）
	if uint16(ret)&0x03FF == 0x04 {
		return "zh-CN"
	}
	return "en-US"
}
