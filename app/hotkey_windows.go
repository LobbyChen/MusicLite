//go:build windows

package app

// Windows 修饰键 virtual-key code
// 参考：https://learn.microsoft.com/en-us/windows/win32/inputdev/virtual-key-codes
var modifierRawcodes = map[uint16]string{
	162: "ctrl", 163: "ctrl", // VK_LCONTROL / VK_RCONTROL
	160: "shift", 161: "shift", // VK_LSHIFT / VK_RSHIFT
	164: "alt", 165: "alt", // VK_LMENU / VK_RMENU
	91: "win", 92: "win", // VK_LWIN / VK_RWIN
}

// Windows rawcode → 键名（Win32 Virtual Key）
var rawcodeToName = map[uint16]string{
	65: "a", 66: "b", 67: "c", 68: "d", 69: "e", 70: "f", 71: "g", 72: "h", 73: "i", 74: "j",
	75: "k", 76: "l", 77: "m", 78: "n", 79: "o", 80: "p", 81: "q", 82: "r", 83: "s", 84: "t",
	85: "u", 86: "v", 87: "w", 88: "x", 89: "y", 90: "z",
	48: "0", 49: "1", 50: "2", 51: "3", 52: "4", 53: "5", 54: "6", 55: "7", 56: "8", 57: "9",
	112: "f1", 113: "f2", 114: "f3", 115: "f4", 116: "f5", 117: "f6",
	118: "f7", 119: "f8", 120: "f9", 121: "f10", 122: "f11", 123: "f12",
	32: "space", 13: "enter", 27: "escape", 9: "tab", 8: "backspace",
	37: "left", 38: "up", 39: "right", 40: "down",
	187: "=", 189: "-", 219: "[", 221: "]", 186: ";", 222: "'",
	188: ",", 190: ".", 191: "/", 192: "`", 220: "\\",
	111: "numpad_divide", 106: "numpad_multiply",
	109: "numpad_subtract", 107: "numpad_add",
}
