package share

// ============ ID3v2.4 标签构建（纯 Go 实现，跨平台）============
//
// dhowden/tag 库仅支持读取 ID3 标签，不支持写入，因此手动构建 ID3v2.4 标签。
// 本包只提供纯函数：构建标签 / 剥离旧标签 / 清理文件名，
// 具体"打包分享 + 写剪贴板"的编排逻辑在 app 包的 PackShare 中完成。

import (
	"bytes"
	"strings"
)

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
	buf.WriteByte(0x03)      // UTF-8
	buf.WriteString("chi")   // 语言（中文）
	buf.WriteByte(0)         // 内容描述（空）终止
	buf.WriteString(lyrics)   // 歌词文本
	return buildFrame("USLT", buf.Bytes())
}

// BuildID3v2Tag 构建完整的 ID3v2.4 标签（标题/艺术家/封面/歌词）
func BuildID3v2Tag(title, artist string, coverData []byte, coverMIME, lyrics string) []byte {
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

// StripID3v2 移除文件开头的 ID3v2 标签（如果存在）
func StripID3v2(data []byte) []byte {
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

// SanitizeFilename 清理文件名中的非法字符（跨平台）
func SanitizeFilename(name string) string {
	repl := func(r rune) rune {
		switch r {
		// Windows 非法字符 + Unix 下有特殊含义的字符统一替换
		case '\\', '/', ':', '*', '?', '"', '<', '>', '|', '\t', '\n', '\r':
			return '_'
		}
		return r
	}
	return strings.Map(repl, name)
}
