package library

import (
	"encoding/base64"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"MusicLite/internal/metadata"
	"MusicLite/internal/storage"
)

// Service 负责曲目导入、查询、编辑与播放地址构建。
type Service struct {
	db      *storage.Database
	baseURL string
}

func New(db *storage.Database) *Service {
	return &Service{db: db}
}

// SetBaseURL 设置媒体 URL 前缀（开发模式下为本地 HTTP 服务器地址）。
func (s *Service) SetBaseURL(base string) {
	s.baseURL = base
}

// BaseURL 返回媒体 URL 前缀。
func (s *Service) BaseURL() string {
	return s.baseURL
}

func (s *Service) MediaBaseURL() string {
	return s.baseURL
}

// trackFromRecord 将数据库记录转换为前端可用的曲目数据。
func (s *Service) trackFromRecord(r *storage.TrackRecord) metadata.MscData {
	id := strconv.FormatInt(r.ID, 10)
	track := metadata.MscData{
		ID:         r.ID,
		Name:       r.Title,
		Author:     r.Artist,
		Album:      r.Album,
		Format:     metadata.NormalMscFormat(r.Format),
		AudioURI:   s.baseURL + "/audio/" + id,
		Lyrics:     r.Lyrics,
		ImportedAt: r.ImportedAt,
	}
	if r.CoverMIME != "" {
		track.CoverURI = s.baseURL + "/cover/" + id
	}
	return track
}

// SupportedAudioExtensions 是后端与文件对话框共享的音频扩展名清单。
// 解码统一走 FFmpeg，因此这里覆盖常见容器格式；
// 新增格式只需改这一处，导入白名单与对话框过滤器会同步生效。
var SupportedAudioExtensions = []string{
	".mp3", ".mp2", ".flac", ".wav", ".wave", ".ogg", ".oga", ".opus",
	".ape", ".wv", ".tta", ".m4a", ".m4b", ".m4r", ".aac", ".wma",
	".aiff", ".aif", ".aifc", ".dsf", ".dff", ".mka", ".webm", ".amr",
	".ac3", ".dts", ".caf", ".au", ".snd", ".w64", ".mp4", ".3gp", ".spx",
}

// SupportedAudioPattern 生成 Windows 文件对话框使用的分号分隔模式。
func SupportedAudioPattern() string {
	patterns := make([]string, 0, len(SupportedAudioExtensions))
	for _, ext := range SupportedAudioExtensions {
		patterns = append(patterns, "*"+ext)
	}
	return strings.Join(patterns, ";")
}

// IsSupportedAudioExt 判断扩展名是否在支持清单内（大小写不敏感）。
func IsSupportedAudioExt(ext string) bool {
	ext = strings.ToLower(ext)
	for _, e := range SupportedAudioExtensions {
		if e == ext {
			return true
		}
	}
	return false
}

// ImportPaths 批量导入曲目，返回成功数量。
func (s *Service) ImportPaths(paths []string) (int, error) {
	count := 0
	for _, filePath := range paths {
		ext := strings.ToLower(filepath.Ext(filePath))
		if !IsSupportedAudioExt(ext) {
			continue
		}

		meta, err := metadata.ExtractMetadata(filePath)
		if err != nil {
			log.Printf("跳过 %s: %v", filePath, err)
			continue
		}

		rec := storage.TrackRecord{
			Title:      meta.Title,
			Artist:     meta.Artist,
			Album:      meta.Album,
			FilePath:   filePath,
			CoverData:  meta.CoverData,
			CoverMIME:  meta.CoverMIME,
			Lyrics:     meta.Lyrics,
			Format:     string(meta.Format),
			ImportedAt: time.Now().Unix(),
		}

		if rec.Lyrics == "" {
			rec.Lyrics = FindSidecarLyrics(filePath)
		}

		if _, err := s.db.InsertTrack(rec); err != nil {
			log.Printf("入库失败 %s: %v", filePath, err)
			continue
		}
		count++
	}
	return count, nil
}

// FindSidecarLyrics 查找同目录同名的 .lrc / .txt 歌词。
func FindSidecarLyrics(audioPath string) string {
	base := strings.TrimSuffix(audioPath, filepath.Ext(audioPath))
	for _, ext := range []string{".lrc", ".txt"} {
		if data, err := os.ReadFile(base + ext); err == nil {
			return string(data)
		}
	}
	return ""
}

// GetAllTracks 返回全部曲目。
func (s *Service) GetAllTracks() ([]metadata.MscData, error) {
	records, err := s.db.GetAllTrackRecords()
	if err != nil {
		return nil, err
	}
	result := make([]metadata.MscData, 0, len(records))
	for i := range records {
		result = append(result, s.trackFromRecord(&records[i]))
	}
	return result, nil
}

// GetTrack 返回单首曲目。
func (s *Service) GetTrack(id int64) (metadata.MscData, error) {
	rec, err := s.db.GetTrackByID(id)
	if err != nil {
		return metadata.MscData{}, err
	}
	return s.trackFromRecord(rec), nil
}

// GetRecord 返回数据库原始记录。
func (s *Service) GetRecord(id int64) (*storage.TrackRecord, error) {
	return s.db.GetTrackByID(id)
}

func (s *Service) UpdateTrack(id int64, title, artist, album, lyrics string) error {
	return s.db.UpdateTrack(id, title, artist, album, lyrics)
}

func (s *Service) UpdateTrackCover(id int64, coverData []byte, coverMIME string) error {
	return s.db.UpdateTrackCover(id, coverData, coverMIME)
}

func (s *Service) DeleteTrack(id int64) error {
	return s.db.DeleteTrack(id)
}

// PickedFile 文件选择/读取的统一返回结构（编辑弹窗用）。
type PickedFile struct {
	Data string `json:"data"`
	MIME string `json:"mime"`
	Text string `json:"text"`
}

func ImageMIMEFromExt(path string) string {
	switch strings.ToLower(filepath.Ext(path)) {
	case ".png":
		return "image/png"
	case ".jpg", ".jpeg":
		return "image/jpeg"
	case ".gif":
		return "image/gif"
	case ".bmp":
		return "image/bmp"
	case ".webp":
		return "image/webp"
	default:
		return ""
	}
}

func IsImageFile(path string) bool {
	return ImageMIMEFromExt(path) != ""
}

func IsLyricsFile(path string) bool {
	ext := strings.ToLower(filepath.Ext(path))
	return ext == ".lrc" || ext == ".txt"
}

// ReadFileForEdit 读取封面或歌词文件，自动填充对应字段。
func (s *Service) ReadFileForEdit(path string) (PickedFile, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return PickedFile{}, err
	}
	if len(data) > 512*1024 {
		return PickedFile{}, fmt.Errorf("file too large (max 512KB)")
	}
	result := PickedFile{}
	if IsImageFile(path) {
		result.Data = base64.StdEncoding.EncodeToString(data)
		result.MIME = ImageMIMEFromExt(path)
	} else if IsLyricsFile(path) {
		result.Text = string(data)
	}
	return result, nil
}
