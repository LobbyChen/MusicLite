package metadata

import (
	"bytes"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/dhowden/tag"
)

// RawMetadata 是从音频文件中提取的原始元数据（封面为原始字节）。
type RawMetadata struct {
	Title     string
	Artist    string
	Album     string
	Lyrics    string
	CoverData []byte
	CoverMIME string
	Format    NormalMscFormat
}

// FormatFromExt 根据文件扩展名推断音频格式。
func FormatFromExt(path string) NormalMscFormat {
	ext := strings.ToLower(strings.TrimPrefix(filepath.Ext(path), "."))
	switch ext {
	case "mp3":
		return Mp3
	case "flac":
		return Flac
	case "ogg", "oga", "opus":
		return Ogg
	case "wav", "wave":
		return Wav
	case "ape":
		return APE
	default:
		// FFmpeg 支持的其他容器：直接以扩展名作为格式标识
		if ext == "" {
			return Mp3
		}
		return NormalMscFormat(ext)
	}
}

// ExtractMetadata 从音频文件中提取标题、艺术家、专辑、歌词和封面。
func ExtractMetadata(filePath string) (RawMetadata, error) {
	data, err := os.ReadFile(filePath)
	if err != nil {
		return RawMetadata{}, fmt.Errorf("failed to read file: %w", err)
	}

	m, err := tag.ReadFrom(bytes.NewReader(data))
	if err != nil {
		// 无标签的 WAV/FLAC 等仍然可以导入：用文件名兜底，不阻断导入流程。
		return RawMetadata{
			Title:  strings.TrimSuffix(filepath.Base(filePath), filepath.Ext(filePath)),
			Format: FormatFromExt(filePath),
		}, nil
	}

	meta := RawMetadata{
		Title:  m.Title(),
		Artist: m.Artist(),
		Album:  m.Album(),
		Lyrics: m.Lyrics(),
		Format: FormatFromExt(filePath),
	}

	if meta.Title == "" {
		meta.Title = strings.TrimSuffix(filepath.Base(filePath), filepath.Ext(filePath))
	}

	if pic := m.Picture(); pic != nil {
		meta.CoverData = pic.Data
		meta.CoverMIME = pic.MIMEType
	}

	return meta, nil
}
