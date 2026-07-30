package main

import (
	"MusicLite/internal/format"
	"MusicLite/internal/storage"
	"context"
	"encoding/base64"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// App struct
type App struct {
	ctx             context.Context
	database        *storage.Database
	audioServerPort int // 独立 HTTP 服务器端口，dev 模式下使用
	audioServerLn   net.Listener
}

// NewApp 创建应用实例并连接数据库
func NewApp(sqlite3FilePath string) (*App, error) {
	// 确保数据库文件所在目录存在
	dir := filepath.Dir(sqlite3FilePath)
	if dir != "" && dir != "." {
		if err := os.MkdirAll(dir, 0755); err != nil {
			return nil, err
		}
	}

	// 文件不存在则创建
	if _, err := os.Stat(sqlite3FilePath); os.IsNotExist(err) {
		file, err := os.Create(sqlite3FilePath)
		if err != nil {
			return nil, err
		}
		file.Close()
	}

	db := storage.CreateDataBaseObj()
	if _, err := db.OpenConnect(sqlite3FilePath); err != nil {
		return nil, err
	}

	// 启动时建表
	if err := db.EnsureTracksTable(); err != nil {
		return nil, err
	}

	return &App{database: db}, nil
}

// startup 前端创建后、加载 index.html 前触发
func (a *App) startup(ctx context.Context) {
	a.ctx = ctx

	// dev 模式下启动独立 HTTP 服务器提供音频/封面
	// 原因：dev 模式下 WebView 从 Vite dev server 加载页面，
	// /audio/<id>、/cover/<id> 会被 Vite SPA fallback 拦截返回 index.html，
	// Vite proxy 转发 WebView2 请求时又因头部过大报 431。
	// 我们自己起一个服务器，前端直接用绝对 URL，彻底绕开这些坑。
	// 生产模式 (wails build) 下 AssetServer.Handler 正常工作，无需此服务器。
	if os.Getenv("devserver") != "" {
		ln, err := net.Listen("tcp", "127.0.0.1:0") // 端口 0 = 随机可用端口
		if err != nil {
			log.Printf("Warning: 启动音频服务器失败: %v", err)
		} else {
			a.audioServerLn = ln
			a.audioServerPort = ln.Addr().(*net.TCPAddr).Port

			mux := http.NewServeMux()
			mux.HandleFunc("/audio/", a.serveAudioFile)
			mux.HandleFunc("/cover/", a.serveCoverFile)

			go func() {
				if err := http.Serve(ln, mux); err != nil && err != http.ErrServerClosed {
					log.Printf("音频服务器错误: %v", err)
				}
			}()
			log.Printf("音频服务器已启动: 127.0.0.1:%d", a.audioServerPort)
		}
	}
}

// shutdown 应用退出前触发，关闭数据库连接和音频服务器
func (a *App) shutdown(ctx context.Context) {
	if a.audioServerLn != nil {
		a.audioServerLn.Close()
	}
	if a.database != nil {
		a.database.Close()
	}
}

// mediaBaseURL 返回音频/封面 URL 的前缀
// dev 模式: http://127.0.0.1:<port>（自己的服务器）
// 生产模式: 空串（相对路径走 AssetServer）
func (a *App) mediaBaseURL() string {
	if a.audioServerPort > 0 {
		return fmt.Sprintf("http://127.0.0.1:%d", a.audioServerPort)
	}
	return ""
}

// ============ 独立 HTTP 服务器路由处理 ============

// serveAudioFile 处理 /audio/<id> 请求，返回音频文件流
func (a *App) serveAudioFile(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Access-Control-Allow-Origin", "*")

	id := strings.TrimPrefix(r.URL.Path, "/audio/")
	if id == "" {
		http.NotFound(w, r)
		return
	}

	filePath, err := a.database.GetTrackFilePath(id)
	if err != nil {
		http.NotFound(w, r)
		return
	}

	if _, err := os.Stat(filePath); err != nil {
		http.NotFound(w, r)
		return
	}

	// http.ServeFile 自动处理 Content-Type、Range（拖动进度条）、ETag
	http.ServeFile(w, r, filePath)
}

// serveCoverFile 处理 /cover/<id> 请求，返回封面图片
func (a *App) serveCoverFile(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Access-Control-Allow-Origin", "*")

	id := strings.TrimPrefix(r.URL.Path, "/cover/")
	if id == "" {
		http.NotFound(w, r)
		return
	}

	data, mime, err := a.database.GetTrackCover(id)
	if err != nil || len(data) == 0 {
		http.NotFound(w, r)
		return
	}

	if mime == "" {
		mime = "image/jpeg"
	}
	w.Header().Set("Content-Type", mime)
	w.Header().Set("Cache-Control", "max-age=3600")
	w.Write(data)
}

// ============ 前端可调用的绑定方法 ============

// ImportFiles 打开多选对话框导入音频文件，返回成功导入的数量
func (a *App) ImportFiles() (int, error) {
	files, err := runtime.OpenMultipleFilesDialog(a.ctx, runtime.OpenDialogOptions{
		Title: "选择音乐文件",
		Filters: []runtime.FileFilter{
			{
				DisplayName: "Music File (*.mp3, *.ogg, *.flac, *.wav, *.ape)",
				Pattern:     "*.mp3;*.ogg;*.flac;*.wav;*.ape",
			},
		},
	})
	if err != nil {
		return 0, err
	}

	count := 0
	for _, filePath := range files {
		meta, err := format.ExtractMetadata(filePath)
		if err != nil {
			log.Printf("跳过 %s: %v", filePath, err)
			continue
		}

		rec := storage.TrackRecord{
			Title:      meta.Title,
			Artist:     meta.Artist,
			FilePath:   filePath,
			CoverData:  meta.CoverData,
			CoverMIME:  meta.CoverMIME,
			Lyrics:     meta.Lyrics,
			Format:     string(meta.Format),
			ImportedAt: time.Now().Unix(),
		}

		if _, err := a.database.InsertTrack(rec); err != nil {
			log.Printf("入库失败 %s: %v", filePath, err)
			continue
		}
		count++
	}
	return count, nil
}

// GetAllTracks 返回所有曲目列表（前端列表页用）
func (a *App) GetAllTracks() ([]format.MscData, error) {
	records, err := a.database.GetAllTrackRecords()
	if err != nil {
		return nil, err
	}

	base := a.mediaBaseURL()
	result := make([]format.MscData, 0, len(records))
	for _, r := range records {
		track := format.MscData{
			ID:       r.ID,
			Name:     r.Title,
			Author:   r.Artist,
			Format:   format.NormalMscFormat(r.Format),
			AudioURI: base + "/audio/" + strconv.FormatInt(r.ID, 10),
			Lyrics:   r.Lyrics,
		}
		// 有封面才设 cover URI
		if r.CoverMIME != "" {
			track.CoverURI = base + "/cover/" + strconv.FormatInt(r.ID, 10)
		}
		result = append(result, track)
	}
	return result, nil
}

// GetTrack 返回单首曲目完整数据（播放器页用）
func (a *App) GetTrack(id int64) (format.MscData, error) {
	rec, err := a.database.GetTrackByID(id)
	if err != nil {
		return format.MscData{}, err
	}

	base := a.mediaBaseURL()
	track := format.MscData{
		ID:       rec.ID,
		Name:     rec.Title,
		Author:   rec.Artist,
		Format:   format.NormalMscFormat(rec.Format),
		AudioURI: base + "/audio/" + strconv.FormatInt(rec.ID, 10),
		Lyrics:   rec.Lyrics,
	}
	if rec.CoverMIME != "" {
		track.CoverURI = base + "/cover/" + strconv.FormatInt(rec.ID, 10)
	}
	return track, nil
}

// GetDatabase 暴露数据库实例给 AudioHandler 使用（生产模式用）
func (a *App) GetDatabase() *storage.Database {
	return a.database
}

// UpdateTrack 更新曲目基本信息（标题、艺术家、歌词）
func (a *App) UpdateTrack(id int64, title string, artist string, lyrics string) error {
	return a.database.UpdateTrack(id, title, artist, lyrics)
}

// UpdateTrackCover 更新曲目封面
func (a *App) UpdateTrackCover(id int64, coverData []byte, coverMIME string) error {
	return a.database.UpdateTrackCover(id, coverData, coverMIME)
}

// DeleteTrack 删除曲目
func (a *App) DeleteTrack(id int64) error {
	return a.database.DeleteTrack(id)
}

// encodeCoverBase64 将封面二进制编码为 data URI，用于无 HTTP 服务器时的回退方案
func encodeCoverBase64(data []byte, mime string) string {
	if len(data) == 0 {
		return ""
	}
	if mime == "" {
		mime = "image/jpeg"
	}
	return "data:" + mime + ";base64," + base64.StdEncoding.EncodeToString(data)
}
