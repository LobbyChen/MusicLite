package format

import (
	"bytes"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/dhowden/tag"
)

// RawMetadata 存储从音频文件中提取的原始元数据（封面为原始字节，非 base64）
type RawMetadata struct {
	Title     string
	Artist    string
	Lyrics    string
	CoverData []byte
	CoverMIME string
	Format    NormalMscFormat
}

// FormatFromExt 根据文件扩展名推断音频格式
func FormatFromExt(path string) NormalMscFormat {
	ext := strings.ToLower(filepath.Ext(path))
	switch ext {
	case ".mp3":
		return Mp3
	case ".flac":
		return Flac
	case ".ogg":
		return Ogg
	case ".wav":
		return Wav
	case ".ape":
		return APE
	default:
		return Mp3
	}
}

// ExtractMetadata 从音频文件中提取标题、艺术家、歌词和封面（原始字节）
func ExtractMetadata(filePath string) (RawMetadata, error) {
	data, err := os.ReadFile(filePath)
	if err != nil {
		return RawMetadata{}, fmt.Errorf("failed to read file: %w", err)
	}

	m, err := tag.ReadFrom(bytes.NewReader(data))
	if err != nil {
		return RawMetadata{}, fmt.Errorf("failed to parse tags: %w", err)
	}

	meta := RawMetadata{
		Title:  m.Title(),
		Artist: m.Artist(),
		Lyrics: m.Lyrics(),
		Format: FormatFromExt(filePath),
	}

	// 标题为空时用文件名兜底
	if meta.Title == "" {
		meta.Title = strings.TrimSuffix(filepath.Base(filePath), filepath.Ext(filePath))
	}

	if pic := m.Picture(); pic != nil {
		meta.CoverData = pic.Data
		meta.CoverMIME = pic.MIMEType
	}

	return meta, nil
}
