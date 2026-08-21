//go:build !windows

package app

// 非 Windows 平台（macOS / Linux / BSD）：
// robotn/gohook 在各平台使用的 Rawcode 不同，这里提供一个"尽量兼容"的映射：
// - macOS: Carbon Virtual Keycode
// - Linux (X11): X11 Keycode
// - Wayland: 根据 compositor 不同而不同
// 字符键（a-z, 0-9）在 hotkey.go 中会通过 ev.Keychar 匹配，
// 特殊键这里提供一份常见值，用户若有偏差可调优
//
// 修饰键参考值：
//   macOS:  55=Cmd(Left), 54=Cmd(Right); 59=Ctrl, 62=Ctrl(Right); 56=Shift, 60=Shift(Right); 58=Option(Alt), 61=Option(Right)
//   Linux X11: 37=Ctrl_L, 105=Ctrl_R; 50=Shift_L, 62=Shift_R; 64=Alt_L, 108=Alt_R; 133=Super_L, 134=Super_R
var modifierRawcodes = map[uint16]string{
	// Ctrl（优先保留 macOS；Linux Ctrl_L/R 通过 ev.Keychar/其他逻辑兜底）
	59: "ctrl",  // macOS Left Ctrl
	62: "ctrl",  // macOS Right Ctrl
	37: "ctrl",  // Linux Ctrl_L
	105: "ctrl", // Linux Ctrl_R
	// Shift
	56: "shift", // macOS Left Shift
	60: "shift", // macOS Right Shift
	50: "shift", // Linux Shift_L
	// Alt / Option
	58: "alt", // macOS Left Option
	61: "alt", // macOS Right Option
	64: "alt", // Linux Alt_L
	108: "alt", // Linux Alt_R
	// Win / Cmd / Super
	55: "win",  // macOS Left Cmd
	54: "win",  // macOS Right Cmd
	133: "win", // Linux Super_L
	134: "win", // Linux Super_R
}

// 非 Windows 平台 rawcode → 键名（粗略覆盖常见值）
// 为避免 map 字面量重复键冲突：
//   - 优先保留 macOS Carbon keycode（项目主要在 macOS 上使用）
//   - Linux X11 键值仅补充未与 macOS 冲突的部分
//   - 字符键仍可通过 ev.Keychar 匹配（hotkey.go 已有该回退逻辑）
var rawcodeToName = map[uint16]string{
	// ===== 字母键（macOS Carbon）=====
	// 0=A,11=B,8=C,2=D,14=E,3=F,5=G,4=H,34=I,38=J,40=K,37=L,46=M,45=N,31=O,35=P,12=Q,15=R,1=S,17=T,32=U,9=V,13=W,7=X,16=Y,6=Z
	0: "a", 11: "b", 8: "c", 2: "d", 14: "e", 3: "f", 5: "g", 4: "h",
	34: "i", 38: "j", 40: "k", 37: "l", 46: "m", 45: "n", 31: "o", 35: "p",
	12: "q", 15: "r", 1: "s", 17: "t", 32: "u", 9: "v", 13: "w", 7: "x",
	16: "y", 6: "z",
	// ===== 字母键（Linux X11，仅保留不冲突键值）=====
	// X11: 26=E,41=F,42=G,43=H,44=J,57=N,33=P,24=Q,27=R,39=S,28=T,30=U,55=V,25=W,53=X,52=Z
	26: "e", 41: "f", 42: "g", 43: "h", 44: "j", 57: "n", 33: "p",
	24: "q", 27: "r", 39: "s", 28: "t", 30: "u", 55: "v", 25: "w",
	53: "x", 52: "z",

	// ===== 数字键（macOS Carbon）=====
	// 18=1,19=2,20=3,21=4,23=5,22=6,28=8
	18: "1", 19: "2", 20: "3", 21: "4", 23: "5", 22: "6",

	// ===== 功能键 F1~F12（macOS Carbon）=====
	// 122=F1,120=F2,99=F3,118=F4,96=F5,97=F6,98=F7,100=F8,101=F9,109=F10,103=F11,111=F12
	122: "f1", 120: "f2", 99: "f3", 118: "f4", 96: "f5", 97: "f6", 98: "f7",
	100: "f8", 101: "f9", 109: "f10", 103: "f11", 111: "f12",
	// ===== 功能键（Linux X11，仅保留不冲突键值）=====
	// X11: 67=F1,68=F2,69=F3,70=F4,71=F5,72=F6,73=F7,74=F8,75=F9,76=F10,95=F11
	67: "f1", 68: "f2", 69: "f3", 70: "f4", 71: "f5", 72: "f6",
	73: "f7", 74: "f8", 75: "f9", 76: "f10", 95: "f11",

	// ===== 空格键 / 回车 / Esc / Tab / Backspace（macOS Carbon）=====
	// 49=space, 36=enter, 53=escape, 48=tab, 51=backspace
	49: "space", 36: "enter", 53: "escape", 48: "tab", 51: "backspace",
	// ===== 同上（Linux X11，不冲突键）=====
	// X11: 65=space, 9=escape, 23=tab, 22=backspace
	65: "space",

	// ===== 方向键（macOS Carbon）=====
	// 123=left, 126=up, 124=right, 125=down
	123: "left", 126: "up", 124: "right", 125: "down",
	// ===== 方向键（Linux X11）=====
	// 113=left, 111=up, 114=right, 116=down
	113: "left", 111: "up", 114: "right", 116: "down",
}
