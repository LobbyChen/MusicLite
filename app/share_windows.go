//go:build windows

package app

// ============ 打包分享 - Windows 剪贴板 CF_HDROP CGO 实现 ============

/*
#cgo LDFLAGS: -lole32 -luser32

#include <windows.h>
#include <shlobj.h>

// setClipboardFiles 将文件路径写入系统剪贴板（CF_HDROP 格式）
// 返回 0=成功，其他=失败
static int setClipboardFiles(const char* filePath) {
    if (!filePath || filePath[0] == '\0') return 1;

    // 转换为宽字符
    int wlen = MultiByteToWideChar(CP_UTF8, 0, filePath, -1, NULL, 0);
    if (wlen <= 0) return 2;

    // DROPFILES 结构 + 宽字符路径（双终止符）
    size_t dropSize = sizeof(DROPFILES) + (wlen + 1) * sizeof(wchar_t);

    HGLOBAL hMem = GlobalAlloc(GMEM_MOVEABLE, dropSize);
    if (!hMem) return 3;

    DROPFILES* pDrop = (DROPFILES*)GlobalLock(hMem);
    if (!pDrop) { GlobalFree(hMem); return 4; }

    pDrop->pFiles = sizeof(DROPFILES);
    pDrop->pt.x = 0;
    pDrop->pt.y = 0;
    pDrop->fNC = FALSE;
    pDrop->fWide = TRUE;

    wchar_t* pPath = (wchar_t*)((char*)pDrop + sizeof(DROPFILES));
    MultiByteToWideChar(CP_UTF8, 0, filePath, -1, pPath, wlen);
    pPath[wlen] = L'\0';

    GlobalUnlock(hMem);

    if (!OpenClipboard(NULL)) { GlobalFree(hMem); return 5; }
    EmptyClipboard();
    HANDLE result = SetClipboardData(CF_HDROP, hMem);
    CloseClipboard();

    if (!result) { GlobalFree(hMem); return 6; }
    return 0;
}
*/
import "C"

import (
	"fmt"
	"unsafe"
)

// setClipboardFilesGo 封装 CGO 调用，将文件路径写入剪贴板（Windows 实现）
func setClipboardFilesGo(filePath string) error {
	cPath := C.CString(filePath)
	defer C.free(unsafe.Pointer(cPath))
	hr := C.setClipboardFiles(cPath)
	if hr != 0 {
		return fmt.Errorf("剪贴板写入失败: %d", int(hr))
	}
	return nil
}
