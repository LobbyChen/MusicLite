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
	goruntime "runtime"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/getlantern/systray"
	"github.com/wailsapp/wails/v2/pkg/runtime"
	"golang.org/x/sys/windows/registry"
)

// App struct
type App struct {
	ctx             context.Context
	defaultFile     string
	defaultTrackId  int64
	database        *storage.Database
	player          *Player // 后端音频播放器
	audioServerPort int     // 独立 HTTP 服务器端口，dev 模式下使用
	audioServerLn   net.Listener
	trayQuitting    bool // 托盘"退出"时置 true，让 OnBeforeClose 放行
}

// NewApp 创建应用实例并连接数据库
func NewApp(sqlite3FilePath string, defaultFile string) (*App, error) {
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

	app := &App{database: db, defaultFile: defaultFile}
	// 创建后端播放器（实际初始化在 startup 拿到 ctx 后进行）
	app.player = NewPlayer(db, app)
	return app, nil
}

// startup 前端创建后、加载 index.html 前触发
func (a *App) startup(ctx context.Context) {
	a.ctx = ctx

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

	// 初始化系统托盘（独立 goroutine，systray.Run 会阻塞）
	go a.initTray()

	// 启动后端音频播放器（初始化 speaker + timeupdate 推送循环）
	a.player.Start(ctx)
	// 从设置同步初始音量到播放器
	a.player.SetInitialVolume(a.LoadSettings().Volume)

	// 启动听歌时长 heartbeat（定期提交 pending 到注册表）
	StartListenTimeHeartbeat()
}

// shutdown 应用退出前触发，关闭数据库连接和音频服务器
func (a *App) shutdown(ctx context.Context) {
	// 先停止后端播放器，释放音频设备并提交听歌时长
	if a.player != nil {
		a.player.Stop()
	}
	// 退出系统托盘
	systray.Quit()
	// 持久化未写入的听歌时长到注册表
	FlushListenTime()
	// 检查是否有命令行启动的文件
	if a.defaultFile != "" {
		// 从库里面剔除
		a.database.DeleteTrack(a.defaultTrackId)
	}
	if a.audioServerLn != nil {
		a.audioServerLn.Close()
	}
	if a.database != nil {
		a.database.Close()
	}
}

// mediaBaseURL 返回音频/封面 URL 的前缀
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

func (a *App) getDefaultFilePath() string {
	return a.defaultFile
}
func (a *App) GetFileInArgs() format.MscData {
	filePath := a.getDefaultFilePath()
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
		FilePath:   filePath,
		CoverData:  meta.CoverData,
		CoverMIME:  meta.CoverMIME,
		Lyrics:     meta.Lyrics,
		Format:     string(meta.Format),
		ImportedAt: time.Now().Unix(),
	}
	var id int64
	base := a.mediaBaseURL()
	if id, err = a.database.InsertTrack(rec); err != nil {
		log.Printf("入库失败 %s: %v", filePath, err)
		return format.MscData{}
	}
	r, err := a.database.GetTrackByID(id)
	if err != nil {
		fmt.Println("获取失败")
		return format.MscData{}
	}
	track := format.MscData{
		ID:         r.ID,
		Name:       r.Title,
		Author:     r.Artist,
		Format:     format.NormalMscFormat(r.Format),
		AudioURI:   base + "/audio/" + strconv.FormatInt(r.ID, 10),
		Lyrics:     r.Lyrics,
		ImportedAt: r.ImportedAt,
	}
	if r.CoverMIME != "" {
		track.CoverURI = base + "/cover/" + strconv.FormatInt(r.ID, 10)
	}
	a.defaultTrackId = track.ID
	return track
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
	strs := a.getBackendStrings()
	files, err := runtime.OpenMultipleFilesDialog(a.ctx, runtime.OpenDialogOptions{
		Title: strs.SelectMusicFile,
		Filters: []runtime.FileFilter{
			{
				DisplayName: strs.MusicFileFilter,
				Pattern:     "*.mp3;*.flac;*.wav",
			},
		},
	})
	if err != nil {
		return 0, err
	}

	return a.importFromPaths(files)
}

// ImportFilesFromPaths 按文件路径批量导入（拖放场景用）
func (a *App) ImportFilesFromPaths(paths []string) (int, error) {
	return a.importFromPaths(paths)
}

// importFromPaths 共享的导入逻辑：遍历路径、提取元数据、入库
func (a *App) importFromPaths(paths []string) (int, error) {
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

		if _, err := a.database.InsertTrack(rec); err != nil {
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
func (a *App) GetAllTracks() ([]format.MscData, error) {
	records, err := a.database.GetAllTrackRecords()
	if err != nil {
		return nil, err
	}

	base := a.mediaBaseURL()
	result := make([]format.MscData, 0, len(records))
	for _, r := range records {
		track := format.MscData{
			ID:         r.ID,
			Name:       r.Title,
			Author:     r.Artist,
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

func (a *App) GetRandomTrack(currTrackId int64) format.MscData {
	// 先获取一次现在的列表
	currMscs, _ := a.GetAllTracks()
	// 如果只有一个
	if len(currMscs) == 1 {
		// 直接返回
		return currMscs[0]
	}
	var index int
	for {
		// 随机一个下标
		index = random(0, len(currMscs))
		if currMscs[index].ID == currTrackId {
			continue
		}
		break
	}
	// 返回
	return currMscs[index]
}

// GetNextTracks 返回下一曲目（前端用）
func (a *App) GetNextTracks(currTrackId int64) format.MscData {
	// 先获取一次现在的列表
	currMscs, _ := a.GetAllTracks()
	// 找到现在的
	for index, d := range currMscs {
		// 边界条件-最后一个
		if d.ID == currTrackId {
			if index == len(currMscs)-1 {
				return currMscs[0]
			} else {
				return currMscs[index+1]
			}
		}
	}
	return format.MscData{}
}
func (a *App) GetPrevTracks(currTrackId int64) format.MscData {
	// 先获取一次现在的列表
	currMscs, _ := a.GetAllTracks()
	// 找到现在的
	for index, d := range currMscs {
		// 边界条件-最第一个
		if d.ID == currTrackId {
			if index == 0 {
				return currMscs[len(currMscs)-1]
			} else {
				return currMscs[index-1]
			}
		}
	}
	return format.MscData{}
}

// GetTrack 返回单首曲目完整数据（播放器页用）
func (a *App) GetTrack(id int64) (format.MscData, error) {
	rec, err := a.database.GetTrackByID(id)
	if err != nil {
		return format.MscData{}, err
	}

	base := a.mediaBaseURL()
	track := format.MscData{
		ID:         rec.ID,
		Name:       rec.Title,
		Author:     rec.Artist,
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
func (a *App) PickImageFile() (PickedFile, error) {
	strs := a.getBackendStrings()
	path, err := runtime.OpenFileDialog(a.ctx, runtime.OpenDialogOptions{
		Title: strs.PickImageFile,
		Filters: []runtime.FileFilter{
			{DisplayName: strs.ImageFileFilter, Pattern: "*.png;*.jpg;*.jpeg;*.gif;*.bmp;*.webp"},
		},
	})
	if err != nil {
		return PickedFile{}, err
	}
	if path == "" {
		return PickedFile{}, nil // 用户取消
	}
	return a.readFileForEdit(path)
}

// PickLyricsFile 打开文件对话框选择歌词文件，读取并返回文本内容
func (a *App) PickLyricsFile() (string, error) {
	strs := a.getBackendStrings()
	path, err := runtime.OpenFileDialog(a.ctx, runtime.OpenDialogOptions{
		Title: strs.PickLyricsFile,
		Filters: []runtime.FileFilter{
			{DisplayName: strs.LyricsFileFilter, Pattern: "*.lrc;*.txt"},
		},
	})
	if err != nil {
		return "", err
	}
	if path == "" {
		return "", nil // 用户取消
	}
	result, err := a.readFileForEdit(path)
	if err != nil {
		return "", err
	}
	return result.Text, nil
}

// ReadFileForEdit 根据路径读取文件（拖放场景），自动检测类型并填充对应字段
func (a *App) ReadFileForEdit(path string) (PickedFile, error) {
	return a.readFileForEdit(path)
}

// readFileForEdit 读取文件并根据扩展名填充对应字段
func (a *App) readFileForEdit(path string) (PickedFile, error) {
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

// GetInstalledFonts 返回系统中安装的字体名称列表（去重、排序）
// Windows: 读注册表 HKLM\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Fonts
// 其他平台: 返回常用字体作为兜底
func (a *App) GetInstalledFonts() []string {
	set := make(map[string]struct{})
	if goruntime.GOOS == "windows" {
		readRegistryFonts(registry.LOCAL_MACHINE, `SOFTWARE\Microsoft\Windows NT\CurrentVersion\Fonts`, set)
		readRegistryFonts(registry.CURRENT_USER, `SOFTWARE\Microsoft\Windows NT\CurrentVersion\Fonts`, set)
	}
	list := make([]string, 0, len(set))
	for name := range set {
		list = append(list, name)
	}
	sort.Slice(list, func(i, j int) bool {
		return strings.ToLower(list[i]) < strings.ToLower(list[j])
	})
	if len(list) == 0 {
		list = []string{"Microsoft YaHei", "SimHei", "SimSun", "KaiTi", "FangSong", "Segoe UI", "Consolas", "Monaco", "Courier New", "Arial"}
	}
	return list
}

// readRegistryFonts 打开指定注册表路径读取字体名；失败时静默跳过
func readRegistryFonts(root registry.Key, path string, out map[string]struct{}) {
	k, err := registry.OpenKey(root, path, registry.QUERY_VALUE)
	if err != nil {
		log.Printf("打开注册表字体键失败 %s: %v", path, err)
		return
	}
	defer k.Close()
	names, err := k.ReadValueNames(0)
	if err != nil {
		log.Printf("读取注册表字体值失败 %s: %v", path, err)
		return
	}
	for _, name := range names {
		// 键名格式: "Microsoft YaHei & Microsoft YaHei UI (TrueType)"、"Arial (TrueType)"
		// 去掉尾部 (TrueType)/(OpenType) 等后缀，再按 &/& /, 拆分字体族名
		clean := name
		if i := strings.LastIndex(clean, " ("); i > 0 {
			clean = clean[:i]
		}
		// 多个字体族名用 & 或 , 分隔（如 "微软雅黑 & 微软雅黑 UI"）
		parts := strings.FieldsFunc(clean, func(r rune) bool {
			return r == '&' || r == ','
		})
		for _, p := range parts {
			p = strings.TrimSpace(p)
			if p == "" {
				continue
			}
			out[p] = struct{}{}
		}
	}
}
