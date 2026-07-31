package main

// ============ 打包分享功能 ============
//
// 用户右键点击"打包分享"后：
// 0. 在 %TEMP%\<歌曲名称>_LiteShare.mp3 创建新文件
// 1. 读取原文件音频写入新文件
// 2. 将 Cover 图片和 LRC 歌词写入新文件的 ID3v2.4 标签
// 3. 将新文件路径通过 CF_HDROP 写入系统剪贴板
// 4. 前端显示"已生成分享并复制到剪贴板"提示
//
// dhowden/tag 库仅支持读取 ID3 标签，不支持写入，因此手动构建 ID3v2.4 标签。

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
	"bytes"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

// ============ ID3v2.4 标签构建（纯 Go 实现） ============

// synchsafeEncode 将整数编码为 4 字节 synchsafe integer（ID3v2 标准）
func synchsafeEncode(size int) [4]byte {
	var b [4]byte
	b[0] = byte((size >> 21) & 0x7F)
	b[1] = byte((size >> 14) & 0x7F)
	b[2] = byte((size >> 7) & 0x7F)
	b[3] = byte(size & 0x7F)
	return b
}

// buildFrame 构建 ID3v2.4 帧（帧头 10 字节 + 数据）
func buildFrame(id string, data []byte) []byte {
	buf := make([]byte, 10+len(data))
	copy(buf[0:4], id)
	frameSize := synchsafeEncode(len(data))
	buf[4] = frameSize[0]
	buf[5] = frameSize[1]
	buf[6] = frameSize[2]
	buf[7] = frameSize[3]
	buf[8] = 0
	buf[9] = 0
	copy(buf[10:], data)
	return buf
}

// buildTextFrame 构建文本帧（TIT2/TPE1），UTF-8 编码
func buildTextFrame(id, text string) []byte {
	data := make([]byte, 1+len(text))
	data[0] = 0x03 // UTF-8
	copy(data[1:], text)
	return buildFrame(id, data)
}

// buildAPICFrame 构建封面帧（APIC）
func buildAPICFrame(coverData []byte, mime string) []byte {
	if len(coverData) == 0 {
		return nil
	}
	if mime == "" {
		mime = "image/jpeg"
	}
	var buf bytes.Buffer
	buf.WriteByte(0x03)    // UTF-8
	buf.WriteString(mime)  // MIME 类型
	buf.WriteByte(0)       // MIME 终止
	buf.WriteByte(0x03)    // 图片类型：Cover (front)
	buf.WriteByte(0)       // 描述（空）终止
	buf.Write(coverData)   // 图片数据
	return buildFrame("APIC", buf.Bytes())
}

// buildUSLTFrame 构建非同步歌词帧（USLT）
func buildUSLTFrame(lyrics string) []byte {
	if lyrics == "" {
		return nil
	}
	var buf bytes.Buffer
	buf.WriteByte(0x03)        // UTF-8
	buf.WriteString("chi")     // 语言（中文）
	buf.WriteByte(0)           // 内容描述（空）终止
	buf.WriteString(lyrics)    // 歌词文本
	return buildFrame("USLT", buf.Bytes())
}

// buildID3v2Tag 构建完整的 ID3v2.4 标签
func buildID3v2Tag(title, artist string, coverData []byte, coverMIME, lyrics string) []byte {
	var frames bytes.Buffer
	if title != "" {
		frames.Write(buildTextFrame("TIT2", title))
	}
	if artist != "" {
		frames.Write(buildTextFrame("TPE1", artist))
	}
	if len(coverData) > 0 {
		if apic := buildAPICFrame(coverData, coverMIME); apic != nil {
			frames.Write(apic)
		}
	}
	if lyrics != "" {
		if uslt := buildUSLTFrame(lyrics); uslt != nil {
			frames.Write(uslt)
		}
	}

	header := make([]byte, 10)
	header[0] = 'I'
	header[1] = 'D'
	header[2] = '3'
	header[3] = 4 // 主版本 2.4
	header[4] = 0
	header[5] = 0
	tagSize := synchsafeEncode(frames.Len())
	header[6] = tagSize[0]
	header[7] = tagSize[1]
	header[8] = tagSize[2]
	header[9] = tagSize[3]
	return append(header, frames.Bytes()...)
}

// stripID3v2 移除文件开头的 ID3v2 标签（如果存在）
func stripID3v2(data []byte) []byte {
	if len(data) < 10 {
		return data
	}
	if data[0] != 'I' || data[1] != 'D' || data[2] != '3' {
		return data
	}
	size := (int(data[6])&0x7F)<<21 | (int(data[7])&0x7F)<<14 | (int(data[8])&0x7F)<<7 | (int(data[9]) & 0x7F)
	tagEnd := 10 + size
	if tagEnd > len(data) {
		return data
	}
	return data[tagEnd:]
}

// ============ CF_HDROP 剪贴板操作 ============

// setClipboardFilesGo 封装 CGO 调用，将文件路径写入剪贴板
func setClipboardFilesGo(filePath string) error {
	hr := C.setClipboardFiles(C.CString(filePath))
	if hr != 0 {
		return fmt.Errorf("剪贴板写入失败: %d", int(hr))
	}
	return nil
}

// ============ PackShare 打包分享主逻辑 ============

// PackShare 打包分享：读取曲目音频，写入封面和歌词标签，复制到剪贴板
func (a *App) PackShare(id int64) error {
	rec, err := a.database.GetTrackByID(id)
	if err != nil {
		return fmt.Errorf("获取曲目失败: %w", err)
	}

	origData, err := os.ReadFile(rec.FilePath)
	if err != nil {
		return fmt.Errorf("读取音频文件失败: %w", err)
	}

	coverData, coverMIME, _ := a.database.GetTrackCover(strconv.FormatInt(id, 10))
	lyrics := rec.Lyrics

	audioData := stripID3v2(origData)
	tag := buildID3v2Tag(rec.Title, rec.Artist, coverData, coverMIME, lyrics)
	output := append(tag, audioData...)

	safeTitle := sanitizeFilename(rec.Title)
	if safeTitle == "" {
		safeTitle = "track"
	}
	tempDir := os.Getenv("TEMP")
	if tempDir == "" {
		tempDir = os.TempDir()
	}
	outPath := filepath.Join(tempDir, safeTitle+"_LiteShare.mp3")

	if err := os.WriteFile(outPath, output, 0644); err != nil {
		return fmt.Errorf("写入分享文件失败: %w", err)
	}

	log.Printf("[Share] 已生成分享文件: %s (tag=%d bytes, audio=%d bytes)", outPath, len(tag), len(audioData))

	if err := setClipboardFilesGo(outPath); err != nil {
		return fmt.Errorf("文件已生成但剪贴板写入失败: %w", err)
	}

	return nil
}

// sanitizeFilename 清理文件名中的非法字符
func sanitizeFilename(name string) string {
	repl := func(r rune) rune {
		switch r {
		case '\\', '/', ':', '*', '?', '"', '<', '>', '|':
			return '_'
		}
		return r
	}
	return strings.Map(repl, name)
}
