package format

import (
	"bytes"
	"encoding/base64"
	"fmt"
	"os"

	"github.com/dhowden/tag"
)

// AudioMetadata 存储提取的结果
type AudioMetadata struct {
	CoverURI string // 封面的 URI,解析字符串
	Lyrics   string // 内嵌歌词文本
	Author   string // 作曲家
	Title    string // 标题
}

// ExtractCoverAndLyrics 从音频文件中提取封面(Base64)和歌词
func ExtractCoverAndLyrics(filePath string) (AudioMetadata, error) {
	nullaudio := AudioMetadata{}
	// 1. 读取文件内容
	data, err := os.ReadFile(filePath)
	if err != nil {
		return nullaudio, fmt.Errorf("failed to read file: %w", err)
	}

	// 解析元数据
	m, err := tag.ReadFrom(bytes.NewReader(data))
	if err != nil {
		return nullaudio, fmt.Errorf("failed to parse tags: %w", err)
	}

	meta := AudioMetadata{}

	// 提取封面图片并转换为 Base64
	picture := m.Picture()
	if picture != nil {
		// 编码为 Base64
		base64Data := base64.StdEncoding.EncodeToString(picture.Data)
		meta.CoverURI = fmt.Sprintf("data:%s;base64,%s", picture.MIMEType, base64Data)
	} else {
		meta.CoverURI = ""
	}

	lyrics := m.Lyrics()
	if lyrics != "" {
		meta.Lyrics = lyrics
	} else {
		meta.Lyrics = ""
	}
	title := m.Title()
	if title != "" {
		meta.Title = title
	} else {
		meta.Title = ""
	}
	artist := m.Artist()
	if artist != "" {
		meta.Author = artist
	} else {
		meta.Author = ""
	}

	return meta, nil
}
