package app

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
	"sort"
	"strconv"
	"strings"
	"sync/atomic"
	"time"

	"github.com/wailsapp/wails/v3/pkg/application"
)

// MusicService 主服务结构体（v3 Service 模式）
type MusicService struct {
	app             *application.App // v3 应用实例引用
	defaultFile     string
	defaultTrackId  int64
	database        *storage.Database
	player          *Player        // 后端音频播放器
	hotkeyManager   *HotkeyManager // 全局快捷键管理器
	audioServerPort int            // 独立 HTTP 服务器端口，dev 模式下使用
	audioServerLn   net.Listener
	trayQuitting    atomic.Bool // 托盘"退出"时置 true，让窗口关闭钩子放行

	// 前端驱动托盘模式：图标 + 自绘菜单窗口（traypopup WebViewWindow）
	_tray        *application.SystemTray
	_trayPopup   application.Window // 托盘菜单：自绘前端窗口
	_settingsWin application.Window // 设置窗口：独立 WebViewWindow（前端驱动 tray 菜单里可直接打开）
}

// NewMusicService 创建服务实例并连接数据库
func NewMusicService(wailsApp *application.App, sqlite3FilePath string, defaultFile string) (*MusicService, error) {
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

	svc := &MusicService{app: wailsApp, database: db, defaultFile: defaultFile}
	// 创建后端播放器（实际初始化在 ServiceStartup 后进行）
	svc.player = NewPlayer(db, svc)
	return svc, nil
}

// EmitEvent 封装 v3 事件发送，供 Player 等内部组件调用
func (s *MusicService) EmitEvent(name string, data ...any) {
	if s.app != nil {
		s.app.Event.Emit(name, data...)
	}
}

// IsTrayQuitting 返回托盘退出标志（供 main.go 窗口关闭钩子检查）
func (s *MusicService) IsTrayQuitting() bool {
	return s.trayQuitting.Load()
}

// ServiceStartup v3 服务启动回调（前端创建后、加载 index.html 前触发）
func (s *MusicService) ServiceStartup(ctx context.Context, options application.ServiceOptions) error {
	if os.Getenv("devserver") != "" {
		ln, err := net.Listen("tcp", "127.0.0.1:0") // 端口 0 = 随机可用端口
		if err != nil {
			log.Printf("Warning: 启动音频服务器失败: %v", err)
		} else {
			s.audioServerLn = ln
			s.audioServerPort = ln.Addr().(*net.TCPAddr).Port

			mux := http.NewServeMux()
			mux.HandleFunc("/audio/", s.serveAudioFile)
			mux.HandleFunc("/cover/", s.serveCoverFile)

			go func() {
				if err := http.Serve(ln, mux); err != nil && err != http.ErrServerClosed {
					log.Printf("音频服务器错误: %v", err)
				}
			}()
			log.Printf("音频服务器已启动: 127.0.0.1:%d", s.audioServerPort)
		}
	}

	// 初始化系统托盘（v3 原生 SystemTray，不再需要独立 goroutine）
	s.initTray()

	// 启动后端音频播放器（初始化 speaker + timeupdate 推送循环）
	s.player.Start()
	// 从设置同步初始音量到播放器
	settings := s.LoadSettings()
	s.player.SetInitialVolume(settings.Volume)

	// 初始化全局快捷键
	s.hotkeyManager = NewHotkeyManager(s, s.player)
	s.hotkeyManager.UpdateConfig(settings)
	s.hotkeyManager.Start()

	// 启动听歌时长 heartbeat（定期提交 pending 到注册表）
	StartListenTimeHeartbeat()

	return nil
}

// ServiceShutdown v3 服务关闭回调，关闭数据库连接和音频服务器
func (s *MusicService) ServiceShutdown() error {
	// 停止全局快捷键
	if s.hotkeyManager != nil {
		s.hotkeyManager.Stop()
	}
	// 先停止后端播放器，释放音频设备并提交听歌时长
	if s.player != nil {
		s.player.Stop()
	}
	// 停止听歌时长 heartbeat goroutine
	StopListenTimeHeartbeat()
	// 持久化未写入的听歌时长到注册表
	FlushListenTime()
	// 检查是否有命令行启动的文件
	if s.defaultFile != "" && s.defaultTrackId > 0 {
		// 从库里面剔除
		s.database.DeleteTrack(s.defaultTrackId)
	}
	if s.audioServerLn != nil {
		s.audioServerLn.Close()
	}
	if s.database != nil {
		s.database.Close()
	}
	return nil
}

// mediaBaseURL 返回音频/封面 URL 的前缀
func (s *MusicService) mediaBaseURL() string {
	if s.audioServerPort > 0 {
		return fmt.Sprintf("http://127.0.0.1:%d", s.audioServerPort)
	}
	return ""
}

// ============ 独立 HTTP 服务器路由处理 ============

// serveAudioFile 处理 /audio/<id> 请求，返回音频文件流
func (s *MusicService) serveAudioFile(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Access-Control-Allow-Origin", "*")

	id := strings.TrimPrefix(r.URL.Path, "/audio/")
	if id == "" {
		http.NotFound(w, r)
		return
	}

	filePath, err := s.database.GetTrackFilePath(id)
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

func (s *MusicService) getDefaultFilePath() string {
	return s.defaultFile
}
func (s *MusicService) GetFileInArgs() format.MscData {
	filePath := s.getDefaultFilePath()
	if filePath == "" {
		return format.MscData{}
	}

	meta, err := format.ExtractMetadata(filePath)
	if err != nil {
		log.Printf("跳过 %s: %v", filePath, err)
		return format.MscData{}
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
	var id int64
	base := s.mediaBaseURL()
	if id, err = s.database.InsertTrack(rec); err != nil {
		log.Printf("入库失败 %s: %v", filePath, err)
		return format.MscData{}
	}
	r, err := s.database.GetTrackByID(id)
	if err != nil {
		fmt.Println("获取失败")
		return format.MscData{}
	}
	track := format.MscData{
		ID:         r.ID,
		Name:       r.Title,
		Author:     r.Artist,
		Album:      r.Album,
		Format:     format.NormalMscFormat(r.Format),
		AudioURI:   base + "/audio/" + strconv.FormatInt(r.ID, 10),
		Lyrics:     r.Lyrics,
		ImportedAt: r.ImportedAt,
	}
	if r.CoverMIME != "" {
		track.CoverURI = base + "/cover/" + strconv.FormatInt(r.ID, 10)
	}
	s.defaultTrackId = track.ID
	return track
}

// serveCoverFile 处理 /cover/<id> 请求，返回封面图片
func (s *MusicService) serveCoverFile(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Access-Control-Allow-Origin", "*")

	id := strings.TrimPrefix(r.URL.Path, "/cover/")
	if id == "" {
		http.NotFound(w, r)
		return
	}

	data, mime, err := s.database.GetTrackCover(id)
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
func (s *MusicService) ImportFiles() (int, error) {
	strs := s.getBackendStrings()
	files, err := s.app.Dialog.OpenFileWithOptions(&application.OpenFileDialogOptions{
		Title: strs.SelectMusicFile,
		Filters: []application.FileFilter{
			{
				DisplayName: strs.MusicFileFilter,
				Pattern:     "*.mp3;*.flac;*.wav",
			},
		},
	}).PromptForMultipleSelection()
	if err != nil {
		return 0, err
	}

	return s.importFromPaths(files)
}

// ImportFilesFromPaths 按文件路径批量导入（拖放场景用）
func (s *MusicService) ImportFilesFromPaths(paths []string) (int, error) {
	return s.importFromPaths(paths)
}

// importFromPaths 共享的导入逻辑：遍历路径、提取元数据、入库
func (s *MusicService) importFromPaths(paths []string) (int, error) {
	// 后端可播放的音频扩展名（小写）。ogg/ape 自 0.10.1 起不再支持后端播放，
	// 故导入时即排除，避免入库后无法播放造成困惑。
	allowed := map[string]bool{
		".mp3": true, ".flac": true, ".wav": true,
	}

	count := 0
	for _, filePath := range paths {
		ext := strings.ToLower(filepath.Ext(filePath))
		if !allowed[ext] {
			continue
		}

		meta, err := format.ExtractMetadata(filePath)
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

		// 元数据中没有歌词时，扫描同目录下同名的 .lrc/.txt 文件作为默认歌词
		if rec.Lyrics == "" {
			rec.Lyrics = findSidecarLyrics(filePath)
		}

		if _, err := s.database.InsertTrack(rec); err != nil {
			log.Printf("入库失败 %s: %v", filePath, err)
			continue
		}
		count++
	}
	return count, nil
}

// findSidecarLyrics 扫描音频文件同目录下同名的歌词文件（.lrc 优先于 .txt）
// 返回歌词内容；找不到则返回空字符串
func findSidecarLyrics(audioPath string) string {
	base := strings.TrimSuffix(audioPath, filepath.Ext(audioPath))
	// 歌词文件扩展名优先级：.lrc > .txt
	for _, ext := range []string{".lrc", ".txt"} {
		lyricPath := base + ext
		if data, err := os.ReadFile(lyricPath); err == nil {
			return string(data)
		}
	}
	return ""
}

// GetAllTracks 返回所有曲目列表（前端列表页用）
func (s *MusicService) GetAllTracks() ([]format.MscData, error) {
	records, err := s.database.GetAllTrackRecords()
	if err != nil {
		return nil, err
	}

	base := s.mediaBaseURL()
	result := make([]format.MscData, 0, len(records))
	for _, r := range records {
		track := format.MscData{
			ID:         r.ID,
			Name:       r.Title,
			Author:     r.Artist,
			Album:      r.Album,
			Format:     format.NormalMscFormat(r.Format),
			AudioURI:   base + "/audio/" + strconv.FormatInt(r.ID, 10),
			Lyrics:     r.Lyrics,
			ImportedAt: r.ImportedAt,
		}
		// 有封面才设 cover URI
		if r.CoverMIME != "" {
			track.CoverURI = base + "/cover/" + strconv.FormatInt(r.ID, 10)
		}
		result = append(result, track)
	}
	return result, nil
}

func (s *MusicService) GetRandomTrack(currTrackId int64) format.MscData {
	ran, b := s.player.queue.AdvanceRandom(true)
	if !b {
		return format.MscData{}
	}
	return ran.Track
}

// GetNextTracks 返回下一曲目（前端用）
func (s *MusicService) GetNextTracks(currTrackId int64) format.MscData {
	nex, b := s.player.queue.GetNext(true)
	if !b {
		return format.MscData{}
	}
	return nex.Track
}
func (s *MusicService) GetPrevTracks(currTrackId int64) format.MscData {
	pre, b := s.player.queue.GetPrev(true)
	if !b {
		return format.MscData{}
	}
	return pre.Track
}

// GetTrack 返回单首曲目完整数据（播放器页用）
func (s *MusicService) GetTrack(id int64) (format.MscData, error) {
	rec, err := s.database.GetTrackByID(id)
	if err != nil {
		return format.MscData{}, err
	}

	base := s.mediaBaseURL()
	track := format.MscData{
		ID:         rec.ID,
		Name:       rec.Title,
		Author:     rec.Artist,
		Album:      rec.Album,
		Format:     format.NormalMscFormat(rec.Format),
		AudioURI:   base + "/audio/" + strconv.FormatInt(rec.ID, 10),
		Lyrics:     rec.Lyrics,
		ImportedAt: rec.ImportedAt,
	}
	if rec.CoverMIME != "" {
		track.CoverURI = base + "/cover/" + strconv.FormatInt(rec.ID, 10)
	}
	return track, nil
}

// GetDatabase 暴露数据库实例给 AudioHandler 使用（生产模式用）
func (s *MusicService) GetDatabase() *storage.Database {
	return s.database
}

// UpdateTrack 更新曲目基本信息（标题、艺术家、专辑、歌词）
func (s *MusicService) UpdateTrack(id int64, title string, artist string, album string, lyrics string) error {
	return s.database.UpdateTrack(id, title, artist, album, lyrics)
}

// UpdateTrackCover 更新曲目封面
func (s *MusicService) UpdateTrackCover(id int64, coverData []byte, coverMIME string) error {
	return s.database.UpdateTrackCover(id, coverData, coverMIME)
}

// PickedFile 文件选择/读取的统一返回结构（用于编辑弹窗的封面/歌词导入）
type PickedFile struct {
	Data string `json:"data"` // base64 编码的文件数据（图片用）
	MIME string `json:"mime"` // MIME 类型
	Text string `json:"text"` // 文本内容（歌词用）
}

// imageMIMEFromExt 根据文件扩展名返回图片 MIME 类型
func imageMIMEFromExt(path string) string {
	ext := strings.ToLower(filepath.Ext(path))
	switch ext {
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

// isImageFile 判断是否为图片文件
func isImageFile(path string) bool {
	return imageMIMEFromExt(path) != ""
}

// isLyricsFile 判断是否为歌词文件
func isLyricsFile(path string) bool {
	ext := strings.ToLower(filepath.Ext(path))
	return ext == ".lrc" || ext == ".txt"
}

// PickImageFile 打开文件对话框选择图片，读取并返回 base64 数据 + MIME
func (s *MusicService) PickImageFile() (PickedFile, error) {
	strs := s.getBackendStrings()
	path, err := s.app.Dialog.OpenFileWithOptions(&application.OpenFileDialogOptions{
		Title: strs.PickImageFile,
		Filters: []application.FileFilter{
			{DisplayName: strs.ImageFileFilter, Pattern: "*.png;*.jpg;*.jpeg;*.gif;*.bmp;*.webp"},
		},
	}).PromptForSingleSelection()
	if err != nil {
		return PickedFile{}, err
	}
	if path == "" {
		return PickedFile{}, nil // 用户取消
	}
	return s.readFileForEdit(path)
}

// PickLyricsFile 打开文件对话框选择歌词文件，读取并返回文本内容
func (s *MusicService) PickLyricsFile() (string, error) {
	strs := s.getBackendStrings()
	path, err := s.app.Dialog.OpenFileWithOptions(&application.OpenFileDialogOptions{
		Title: strs.PickLyricsFile,
		Filters: []application.FileFilter{
			{DisplayName: strs.LyricsFileFilter, Pattern: "*.lrc;*.txt"},
		},
	}).PromptForSingleSelection()
	if err != nil {
		return "", err
	}
	if path == "" {
		return "", nil // 用户取消
	}
	result, err := s.readFileForEdit(path)
	if err != nil {
		return "", err
	}
	return result.Text, nil
}

// ReadFileForEdit 根据路径读取文件（拖放场景），自动检测类型并填充对应字段
func (s *MusicService) ReadFileForEdit(path string) (PickedFile, error) {
	return s.readFileForEdit(path)
}

// readFileForEdit 读取文件并根据扩展名填充对应字段
func (s *MusicService) readFileForEdit(path string) (PickedFile, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return PickedFile{}, err
	}
	// 大小限制：512KB
	if len(data) > 512*1024 {
		return PickedFile{}, fmt.Errorf("file too large (max 512KB)")
	}
	result := PickedFile{}
	if isImageFile(path) {
		result.Data = base64.StdEncoding.EncodeToString(data)
		result.MIME = imageMIMEFromExt(path)
	} else if isLyricsFile(path) {
		result.Text = string(data)
	}
	return result, nil
}

// DeleteTrack 删除曲目
func (s *MusicService) DeleteTrack(id int64) error {
	return s.database.DeleteTrack(id)
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

// GetInstalledFonts 返回系统中安装的字体名称列表（去重、排序）
// - Windows: 读注册表 HKLM/HKCU\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Fonts
// - macOS:   fc-list 或 ~/Library/Fonts 等目录
// - Linux:   fc-list 或 ~/.local/share/fonts、/usr/share/fonts 等目录
// 平台分派由 fonts_windows.go / fonts_notwindows.go 中的 readInstalledFonts 提供
func (s *MusicService) GetInstalledFonts() []string {
	set := make(map[string]struct{})
	readInstalledFonts(set)
	list := make([]string, 0, len(set))
	for name := range set {
		list = append(list, name)
	}
	sort.Slice(list, func(i, j int) bool {
		return strings.ToLower(list[i]) < strings.ToLower(list[j])
	})
	if len(list) == 0 {
		// 任何平台读取失败时的通用兜底列表（中西文常用字体混合）
		list = []string{
			"Microsoft YaHei", "SimHei", "SimSun", "KaiTi", "FangSong",
			"PingFang SC", "Hiragino Sans GB", "Heiti SC", "Songti SC",
			"Noto Sans CJK SC", "Noto Serif CJK SC", "WenQuanYi Zen Hei", "WenQuanYi Micro Hei",
			"Segoe UI", "Consolas", "Monaco", "Courier New", "Arial",
		}
	}
	return list
}
