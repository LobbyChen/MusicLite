package app

import (
	"context"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"sync/atomic"
	"time"

	"MusicLite/internal/hotkey"
	"MusicLite/internal/i18n"
	"MusicLite/internal/library"
	"MusicLite/internal/metadata"
	"MusicLite/internal/playback"
	"MusicLite/internal/settings"
	"MusicLite/internal/stats"
	"MusicLite/internal/storage"

	"github.com/wailsapp/wails/v3/pkg/application"
)

// MusicService 是 Wails 绑定门面，负责组装各功能包并暴露前端方法。
type MusicService struct {
	app *application.App

	defaultFile    string
	defaultTrackID int64

	db         *storage.Database
	library    *library.Service
	stream     *library.StreamHandler
	player     *playback.Player
	store      *settings.Store
	i18n       *i18n.Manager
	listenTime *stats.Tracker
	hotkeys    *hotkey.Manager

	audioServerPort int
	audioServerLn   net.Listener

	trayQuitting atomic.Bool

	_tray        *application.SystemTray
	_trayPopup   application.Window
	_settingsWin application.Window
}

// NewMusicService 创建服务并初始化数据库与各功能模块。
func NewMusicService(wailsApp *application.App, dbPath string, defaultFile string) (*MusicService, error) {
	if dir := filepath.Dir(dbPath); dir != "" && dir != "." {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			return nil, err
		}
	}

	db := storage.CreateDataBaseObj()
	if _, err := db.OpenConnect(dbPath); err != nil {
		return nil, err
	}
	if err := db.EnsureTracksTable(); err != nil {
		db.Close()
		return nil, err
	}

	store := settings.NewStore()
	svc := &MusicService{
		app:         wailsApp,
		defaultFile: defaultFile,
		db:          db,
		store:       store,
		i18n:        i18n.NewManager(store.Dir()),
		listenTime:  stats.New(store.Dir()),
	}
	svc.library = library.New(db)
	svc.stream = library.NewStreamHandler(db)
	svc.player = playback.NewPlayer(db, svc, svc.library, svc)
	return svc, nil
}

// EmitEvent 实现 playback.EventSink。
//
//wails:ignore
func (s *MusicService) EmitEvent(name string, data ...any) {
	if s.app != nil {
		s.app.Event.Emit(name, data...)
	}
}

// RecordPlayStart 实现 playback.StatsRecorder。
//
//wails:ignore
func (s *MusicService) RecordPlayStart(trackID int64) {
	if s.listenTime != nil {
		s.listenTime.RecordStart(trackID)
	}
}

// RecordPlayPause 实现 playback.StatsRecorder。
//
//wails:ignore
func (s *MusicService) RecordPlayPause(trackID int64) {
	if s.listenTime != nil {
		s.listenTime.RecordPause(trackID)
	}
}

// MediaBaseURL 实现 playback.URLProvider / library 的 URL 前缀。
//
//wails:ignore
func (s *MusicService) MediaBaseURL() string {
	if s.audioServerPort > 0 {
		return fmt.Sprintf("http://127.0.0.1:%d", s.audioServerPort)
	}
	return ""
}

// ServiceStartup 在窗口创建后、页面加载前调用。
func (s *MusicService) ServiceStartup(ctx context.Context, options application.ServiceOptions) error {
	// 清理上次自动更新遗留的 .exe~ 备份
	CleanupOldExeBackups()

	// 开发模式：前端由 Vite 提供，媒体请求需要独立 HTTP 服务器。
	if os.Getenv("devserver") != "" {
		if ln, err := net.Listen("tcp", "127.0.0.1:0"); err == nil {
			s.audioServerLn = ln
			s.audioServerPort = ln.Addr().(*net.TCPAddr).Port
			s.library.SetBaseURL(fmt.Sprintf("http://127.0.0.1:%d", s.audioServerPort))

			mux := http.NewServeMux()
			mux.Handle("/audio/", s.stream)
			mux.Handle("/cover/", s.stream)
			go func() {
				if err := http.Serve(ln, mux); err != nil && err != http.ErrServerClosed {
					log.Printf("[Media] HTTP server error: %v", err)
				}
			}()
			log.Printf("[Media] dev server listening on 127.0.0.1:%d", s.audioServerPort)
		} else {
			log.Printf("[Media] dev server start failed: %v", err)
		}
	}

	s.initTray()

	s.player.Start()
	cfg := s.store.Load()
	s.player.SetInitialVolume(cfg.Volume)

	s.hotkeys = hotkey.NewManager(s.player)
	s.hotkeys.UpdateConfig(cfg)
	s.hotkeys.Start()

	if s.listenTime != nil {
		s.listenTime.StartHeartbeat()
	}
	return nil
}

// ServiceShutdown 释放资源。
func (s *MusicService) ServiceShutdown() error {
	if s.hotkeys != nil {
		s.hotkeys.Stop()
	}
	if s.player != nil {
		s.player.Stop()
	}
	if s.listenTime != nil {
		s.listenTime.StopHeartbeat()
		s.listenTime.Flush()
	}
	if s.defaultFile != "" && s.defaultTrackID > 0 {
		_ = s.db.DeleteTrack(s.defaultTrackID)
	}
	if s.audioServerLn != nil {
		_ = s.audioServerLn.Close()
	}
	if s.db != nil {
		s.db.Close()
	}
	return nil
}

// getBackendStrings 返回当前语言的后端文案。
func (s *MusicService) getBackendStrings() i18n.BackendStrings {
	lang := s.store.Load().Language
	return s.i18n.BackendStrings(lang)
}

//wails:ignore
func (s *MusicService) IsTrayQuitting() bool {
	return s.trayQuitting.Load()
}

//wails:ignore
func (s *MusicService) IsOnlyModeSession() bool {
	if s.defaultFile == "" {
		return false
	}
	return s.store.Load().OnlyMode
}

// GetDatabase 暴露数据库给流处理器等内部组件。
//
//wails:ignore
func (s *MusicService) GetDatabase() *storage.Database {
	return s.db
}

// ServeMedia 处理 /audio/ 与 /cover/ 请求（生产模式由 AssetServer 中间件调用）。
//
//wails:ignore
func (s *MusicService) ServeMedia(w http.ResponseWriter, r *http.Request) {
	s.stream.ServeHTTP(w, r)
}

// EnsureI18nFile 首次启动时解压内嵌翻译文件。
//
//wails:ignore
func (s *MusicService) EnsureI18nFile() {
	s.i18n.EnsureFile()
}

// Exit 退出应用。
func (s *MusicService) Exit(code int) {
	_ = s.ServiceShutdown()
	os.Exit(code)
}

// GetFileInArgs 导入命令行传入的音频文件（OnlyMode / 文件关联启动）。
func (s *MusicService) GetFileInArgs() metadata.MscData {
	if s.defaultFile == "" {
		return metadata.MscData{}
	}

	meta, err := metadata.ExtractMetadata(s.defaultFile)
	if err != nil {
		log.Printf("跳过 %s: %v", s.defaultFile, err)
		return metadata.MscData{}
	}

	rec := storage.TrackRecord{
		Title:      meta.Title,
		Artist:     meta.Artist,
		Album:      meta.Album,
		FilePath:   s.defaultFile,
		CoverData:  meta.CoverData,
		CoverMIME:  meta.CoverMIME,
		Lyrics:     meta.Lyrics,
		Format:     string(meta.Format),
		ImportedAt: time.Now().Unix(),
	}
	id, err := s.db.InsertTrack(rec)
	if err != nil {
		log.Printf("入库失败 %s: %v", s.defaultFile, err)
		return metadata.MscData{}
	}
	s.defaultTrackID = id
	track, err := s.library.GetTrack(id)
	if err != nil {
		return metadata.MscData{}
	}
	return track
}
