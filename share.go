package main

/*
#cgo LDFLAGS: -luser32

#include <windows.h>
#include <shlobj.h>

// SetClipboardFileListW 将单个文件路径写入系统剪贴板（CF_HDROP 格式）。
// 调用者传入 UTF-16LE 编码的宽字符路径，函数构造 DROPFILES 结构并写入剪贴板。
// 返回 1=成功，0=失败。
static int SetClipboardFileListW(const wchar_t* filePath) {
    if (!filePath) return 0;

    int success = 0;
    if (!OpenClipboard(NULL)) return 0;

    EmptyClipboard();

    // 计算宽字符长度（不含 null 终止符）
    size_t pathLen = wcslen(filePath);

    // DROPFILES 结构 + 路径字符串（含 null）+ 双 null 终止符
    size_t totalSize = sizeof(DROPFILES) + (pathLen + 2) * sizeof(wchar_t);

    HGLOBAL hMem = GlobalAlloc(GMEM_MOVEABLE, totalSize);
    if (hMem) {
        DROPFILES* df = (DROPFILES*)GlobalLock(hMem);
        if (df) {
            df->pFiles = sizeof(DROPFILES);
            df->pt.x = 0;
            df->pt.y = 0;
            df->fNC = FALSE;
            df->fWide = TRUE;

            // 路径写入 DROPFILES 之后
            wchar_t* files = (wchar_t*)((char*)df + sizeof(DROPFILES));
            memcpy(files, filePath, (pathLen + 1) * sizeof(wchar_t));
            files[pathLen + 1] = 0; // 双 null 终止符

            GlobalUnlock(hMem);
            // SetClipboardData 成功后内存所有权转移给系统，不可 GlobalFree
            if (SetClipboardData(CF_HDROP, hMem)) {
                success = 1;
            } else {
                GlobalFree(hMem);
            }
        } else {
            GlobalFree(hMem);
        }
    }

    CloseClipboard();
    return success;
}
*/
import "C"

import (
	"bytes"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"unsafe"

	"golang.org/x/sys/windows"
)

// ============ ID3v2.4 标签写入（纯 Go 实现） ============
//
// dhowden/tag 库仅支持读取，此处手动构建 ID3v2.4 标签。
// 包含帧：TIT2（标题）、TPE1（艺术家）、APIC（封面）、USLT（歌词）。
// ID3v2.4 使用 synchsafe integer 编码尺寸，文本编码支持 UTF-8（编码字节 03）。

// synchsafeEncode 将普通整数编码为 4 字节 synchsafe integer（每字节仅用低 7 位）
func synchsafeEncode(size int) [4]byte {
	return [4]byte{
		byte((size >> 21) & 0x7F),
		byte((size >> 14) & 0x7F),
		byte((size >> 7) & 0x7F),
		byte(size & 0x7F),
	}
}

// buildFrame 构建 ID3v2.4 帧（帧头 10 字节 + 数据）
// 帧头：ID(4) + synchsafe size(4) + flags(2)
func buildFrame(id string, data []byte) []byte {
	frame := make([]byte, 10+len(data))
	copy(frame[0:4], id)
	sz := synchsafeEncode(len(data))
	frame[4] = sz[0]
	frame[5] = sz[1]
	frame[6] = sz[2]
	frame[7] = sz[3]
	frame[8] = 0 // flags
	frame[9] = 0 // flags
	copy(frame[10:], data)
	return frame
}

// buildTextFrame 构建文本帧（TIT2/TPE1 等），使用 UTF-8 编码
func buildTextFrame(id, text string) []byte {
	data := make([]byte, 1+len(text))
	data[0] = 3 // 03 = UTF-8
	copy(data[1:], text)
	return buildFrame(id, data)
}

// buildAPICFrame 构建 APIC 帧（封面图片）
// 结构：编码(1) + MIME\0 + 图片类型(1) + 描述\0 + 图片数据
func buildAPICFrame(coverData []byte, mime string) []byte {
	if mime == "" {
		mime = "image/jpeg"
	}
	var buf bytes.Buffer
	buf.WriteByte(3) // UTF-8 编码（影响描述字段）
	buf.WriteString(mime)
	buf.WriteByte(0) // null 终止 MIME（MIME 始终为 ASCII）
	buf.WriteByte(3) // 图片类型 03 = Cover (front)
	buf.WriteByte(0) // 空描述（null 终止，UTF-8 下 1 字节）
	buf.Write(coverData)
	return buildFrame("APIC", buf.Bytes())
}

// buildUSLTFrame 构建 USLT 帧（非同步歌词）
// 结构：编码(1) + 语言(3) + 描述\0 + 歌词文本
func buildUSLTFrame(lyrics string) []byte {
	var buf bytes.Buffer
	buf.WriteByte(3) // UTF-8 编码
	buf.WriteString("eng") // 语言（3 字节，ASCII）
	buf.WriteByte(0) // 空描述（null 终止，UTF-8 下 1 字节）
	buf.WriteString(lyrics)
	return buildFrame("USLT", buf.Bytes())
}

// buildID3v2Tag 构建完整的 ID3v2.4 标签（头部 10 字节 + 所有帧）
func buildID3v2Tag(title, artist string, coverData []byte, coverMIME, lyrics string) []byte {
	var frames bytes.Buffer

	if title != "" {
		frames.Write(buildTextFrame("TIT2", title))
	}
	if artist != "" {
		frames.Write(buildTextFrame("TPE1", artist))
	}
	if len(coverData) > 0 {
		frames.Write(buildAPICFrame(coverData, coverMIME))
	}
	if lyrics != "" {
		frames.Write(buildUSLTFrame(lyrics))
	}

	// ID3v2.4 头部：ID3 + 版本(4.0) + flags + synchsafe size
	header := make([]byte, 10)
	header[0] = 'I'
	header[1] = 'D'
	header[2] = '3'
	header[3] = 4 // 主版本 2.4
	header[4] = 0 // 子版本
	header[5] = 0 // flags
	tagSize := synchsafeEncode(frames.Len())
	header[6] = tagSize[0]
	header[7] = tagSize[1]
	header[8] = tagSize[2]
	header[9] = tagSize[3]

	return append(header, frames.Bytes()...)
}

// stripID3v2 移除文件开头的 ID3v2 标签，返回纯音频数据
func stripID3v2(data []byte) []byte {
	if len(data) < 10 {
		return data
	}
	if data[0] != 'I' || data[1] != 'D' || data[2] != '3' {
		return data
	}
	// synchsafe integer 在字节 6-9
	size := (int(data[6]) << 21) | (int(data[7]) << 14) | (int(data[8]) << 7) | int(data[9])
	tagEnd := 10 + size
	// 如果有 footer（flags 位 4 置位），额外 10 字节
	if data[5]&0x10 != 0 {
		tagEnd += 10
	}
	if tagEnd > len(data) {
		return data[10:] // 异常兜底
	}
	return data[tagEnd:]
}

// sanitizeFilename 清理文件名中的非法字符并限制长度
func sanitizeFilename(name string) string {
	// Windows 文件名非法字符：\ / : * ? " < > |
	for _, c := range `\/:*?"<>|` {
		name = strings.ReplaceAll(name, string(c), "_")
	}
	name = strings.TrimSpace(name)
	if name == "" {
		name = "track"
	}
	// 限制长度，避免超出 MAX_PATH（路径前缀 + 后缀约 70 字符）
	runes := []rune(name)
	if len(runes) > 80 {
		name = string(runes[:80])
	}
	return name
}

// setClipboardFiles 将文件路径以 CF_HDROP 格式写入系统剪贴板
func setClipboardFiles(filePath string) error {
	wpath, err := windows.UTF16PtrFromString(filePath)
	if err != nil {
		return fmt.Errorf("路径编码失败: %w", err)
	}
	result := C.SetClipboardFileListW((*C.wchar_t)(unsafe.Pointer(wpath)))
	if result == 0 {
		return fmt.Errorf("写入剪贴板失败")
	}
	return nil
}

// ============ PackShare：打包分享 ============
//
// 流程：
// 0. 在 %TEMP%\<标题>_LiteShare.mp3 创建新文件
// 1. 读取原音频文件，写入新文件（剥离原有 ID3v2 标签）
// 2. 将 Cover 图片和 LRC 歌词写入新文件的 ID3v2.4 标签
// 3. 将新文件路径以 CF_HDROP 格式写入系统剪贴板

// PackShare 打包分享指定曲目：生成含封面与歌词标签的 mp3 并复制到剪贴板
func (a *App) PackShare(id int64) error {
	// 从数据库获取曲目信息
	rec, err := a.database.GetTrackByID(id)
	if err != nil {
		return fmt.Errorf("获取曲目失败: %w", err)
	}

	// 获取封面数据（可能为空）
	coverData, coverMIME, _ := a.database.GetTrackCover(strconv.FormatInt(id, 10))

	// 读取原始音频文件
	audioData, err := os.ReadFile(rec.FilePath)
	if err != nil {
		return fmt.Errorf("读取音频文件失败: %w", err)
	}

	// 剥离原有 ID3v2 标签，保留纯音频数据
	audioData = stripID3v2(audioData)

	// 构建新的 ID3v2.4 标签（标题、艺术家、封面、歌词）
	tag := buildID3v2Tag(rec.Title, rec.Artist, coverData, coverMIME, rec.Lyrics)

	// 生成临时文件路径
	safeTitle := sanitizeFilename(rec.Title)
	tempPath := filepath.Join(os.TempDir(), safeTitle+"_LiteShare.mp3")

	// 写入新文件：ID3v2 标签 + 音频数据
	if err := os.WriteFile(tempPath, append(tag, audioData...), 0644); err != nil {
		return fmt.Errorf("写入文件失败: %w", err)
	}

	// 将文件路径写入剪贴板（CF_HDROP 格式）
	if err := setClipboardFiles(tempPath); err != nil {
		return fmt.Errorf("复制到剪贴板失败: %w", err)
	}

	return nil
}
