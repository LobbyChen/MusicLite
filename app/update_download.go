package app

// ============ 更新下载管理（多线程分块下载）============
//
// 设计：
//   - 使用 internal/downloader.DownloadManager 做实际的多线程分块下载
//   - 单例 currentDM 保存当前下载任务，支持前端查询进度、取消、暂停
//   - 下载状态持久化到 settings.json，应用重启后前端可恢复进度条
//   - 下载完成不自动重启，而是发事件通知前端提示

import (
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"sync/atomic"
	"time"

	"MusicLite/internal/downloader"
	"MusicLite/internal/settings"
)

// UpdateDownloadProgress 返回给前端的进度信息。
type UpdateDownloadProgress struct {
	Downloaded int64   `json:"downloaded"`
	Total      int64   `json:"total"`
	Progress   float64 `json:"progress"`
	Speed      int64   `json:"speed"`
	Status     string  `json:"status"`
	FileName   string  `json:"fileName"`
	LatestVer  string  `json:"latestVer"`
	Error      string  `json:"error,omitempty"`
}

var (
	currentDM     *downloader.DownloadManager
	currentDMInfo UpdateInfo
	dmMu          sync.Mutex
	dmStarting    bool // 正在探测/初始化下载，占位防止重复启动

	speedMu         sync.Mutex
	lastSpeedSample time.Time
	lastDownloaded  int64
	currentSpeed    int64
)

// StartUpdateDownload 启动更新下载（异步，立即返回）。
func (s *MusicService) StartUpdateDownload(info UpdateInfo) error {
	if info.DownloadURL == "" {
		return fmt.Errorf("没有可用的下载地址")
	}

	// 先占位：后续 Init 需要探测网络（最长 15 秒），期间不能持有 dmMu，
	// 否则前端查询进度会被阻塞；用 dmStarting 防止重复启动第二个任务。
	dmMu.Lock()
	if currentDM != nil || dmStarting {
		dmMu.Unlock()
		return fmt.Errorf("已有下载任务正在进行")
	}
	dmStarting = true
	dmMu.Unlock()
	defer func() {
		dmMu.Lock()
		dmStarting = false
		dmMu.Unlock()
	}()

	cfg := s.LoadSettings()
	threads := cfg.UpdateThreadCount
	if threads < 1 {
		threads = 1
	}
	if threads > 256 {
		threads = 256
	}
	if cfg.UpdateProxyMode == "ghproxy" && threads > 16 {
		threads = 16
	}
	if info.DownloadURL != "" {
		info.DownloadURL = s.applyGhProxy(info.DownloadURL)
	}

	tempDir := os.Getenv("TEMP")
	if tempDir == "" {
		tempDir = os.TempDir()
	}
	downloadName := info.DownloadName
	if downloadName == "" {
		downloadName = "MusicLite_update.zip"
	}
	outputPath := filepath.Join(tempDir, "MusicLite_update"+filepath.Ext(downloadName))

	dm := downloader.NewDownloadManager(info.DownloadURL, outputPath)
	if err := dm.Init(uint64(threads)); err != nil {
		return fmt.Errorf("初始化下载失败: %w", err)
	}
	// Start 只负责创建临时文件并启动后台分块下载，立即返回；
	// 创建文件等同步错误在这里直接返回给前端。
	if err := dm.Start(); err != nil {
		return fmt.Errorf("启动下载失败: %w", err)
	}

	cfg.UpdateDownloadState = &settings.UpdateDownloadState{
		URL:        info.DownloadURL,
		FileName:   info.DownloadName,
		OutputPath: outputPath,
		LatestVer:  info.LatestVer,
		FileSize:   dm.GetFileSize(),
		Downloaded: 0,
		Status:     "downloading",
	}
	_ = s.SaveSettings(cfg)

	dmMu.Lock()
	currentDM = dm
	currentDMInfo = info
	dmMu.Unlock()

	speedMu.Lock()
	lastSpeedSample = time.Now()
	lastDownloaded = 0
	speedMu.Unlock()
	atomic.StoreInt64(&currentSpeed, 0)

	latestVer := info.LatestVer

	go func() {
		for {
			time.Sleep(500 * time.Millisecond)
			// 周期性推送进度事件（由后端驱动，替代前端轮询）
			s.EmitEvent("update:downloadProgress", s.GetUpdateDownloadProgress())

			// 分块全部失败/临时文件写入失败：上报错误并释放当前任务
			if err := dm.Error(); err != nil {
				dm.Stop()
				cfg := s.LoadSettings()
				if cfg.UpdateDownloadState != nil {
					cfg.UpdateDownloadState.Status = "error"
					cfg.UpdateDownloadState.ErrorMessage = err.Error()
					_ = s.SaveSettings(cfg)
				}
				dmMu.Lock()
				if currentDM == dm {
					currentDM = nil
				}
				dmMu.Unlock()
				s.EmitEvent("update:downloadError", err.Error())
				return
			}

			if dm.GetProcess() >= 1.0 {
				cfg := s.LoadSettings()
				if cfg.UpdateDownloadState != nil {
					cfg.UpdateDownloadState.Status = "completed"
					cfg.UpdateDownloadState.Downloaded = dm.GetFileSize()
					_ = s.SaveSettings(cfg)
				}
				s.EmitEvent("update:downloadCompleted", latestVer)

				dmMu.Lock()
				currentDM = nil
				dmMu.Unlock()
				return
			}

			dmMu.Lock()
			if currentDM != dm {
				dmMu.Unlock()
				return
			}
			dmMu.Unlock()
		}
	}()

	// 立即推送一次初始进度，前端无需轮询。
	// 必须在释放 dmMu 之后调用：GetUpdateDownloadProgress 内部会再次加锁。
	s.EmitEvent("update:downloadProgress", s.GetUpdateDownloadProgress())

	return nil
}

// GetUpdateDownloadProgress 获取当前下载进度。
func (s *MusicService) GetUpdateDownloadProgress() UpdateDownloadProgress {
	dmMu.Lock()
	dm := currentDM
	info := currentDMInfo
	dmMu.Unlock()

	if dm == nil {
		cfg := s.LoadSettings()
		if cfg.UpdateDownloadState != nil {
			st := cfg.UpdateDownloadState
			// 进程重启后 currentDM 已丢失，持久化的"下载中/暂停"状态无法继续操作，
			// 标记为中断，避免前端恢复出一个点不动的进度条
			if st.Status == "downloading" || st.Status == "paused" {
				st.Status = "cancelled"
				_ = s.SaveSettings(cfg)
			}
			progress := 0.0
			if st.FileSize > 0 {
				progress = float64(st.Downloaded) / float64(st.FileSize)
			}
			return UpdateDownloadProgress{
				Downloaded: st.Downloaded,
				Total:      st.FileSize,
				Progress:   progress,
				Status:     st.Status,
				FileName:   st.FileName,
				LatestVer:  st.LatestVer,
				Error:      st.ErrorMessage,
			}
		}
		return UpdateDownloadProgress{Status: "idle"}
	}

	downloaded := dm.GetDownloadedBytes()
	total := dm.GetFileSize()
	progress := dm.GetProcess()

	now := time.Now()
	speedMu.Lock()
	if now.Sub(lastSpeedSample) >= time.Second {
		delta := downloaded - lastDownloaded
		elapsed := now.Sub(lastSpeedSample).Seconds()
		if elapsed > 0 {
			atomic.StoreInt64(&currentSpeed, int64(float64(delta)/elapsed))
		}
		lastSpeedSample = now
		lastDownloaded = downloaded
	}
	speedMu.Unlock()

	status := "downloading"
	if dm.IsPaused() {
		status = "paused"
	}
	return UpdateDownloadProgress{
		Downloaded: downloaded,
		Total:      total,
		Progress:   progress,
		Speed:      atomic.LoadInt64(&currentSpeed),
		Status:     status,
		FileName:   info.DownloadName,
		LatestVer:  info.LatestVer,
	}
}

// PauseAndResumeUpdateDownload 暂停或继续当前活跃下载。
func (s *MusicService) PauseAndResumeUpdateDownload() {
	dmMu.Lock()
	dm := currentDM
	dmMu.Unlock()

	if dm == nil {
		cfg := s.LoadSettings()
		if cfg.UpdateDownloadState != nil && cfg.UpdateDownloadState.Status == "downloading" {
			cfg.UpdateDownloadState.Status = "idle"
			_ = s.SaveSettings(cfg)
		}
		return
	}
	dm.PauseAndResume()

	cfg := s.LoadSettings()
	if cfg.UpdateDownloadState != nil {
		if dm.IsPaused() {
			cfg.UpdateDownloadState.Status = "paused"
		} else {
			cfg.UpdateDownloadState.Status = "downloading"
		}
		_ = s.SaveSettings(cfg)
	}
	// 立即推送状态变化，前端按钮文案无需等待下一次进度事件
	s.EmitEvent("update:downloadProgress", s.GetUpdateDownloadProgress())
}

// CancelUpdateDownload 取消当前下载。
func (s *MusicService) CancelUpdateDownload() error {
	dmMu.Lock()
	dm := currentDM
	dmMu.Unlock()

	if dm == nil {
		return fmt.Errorf("没有正在进行的下载")
	}

	dm.Stop()

	cfg := s.LoadSettings()
	if cfg.UpdateDownloadState != nil {
		cfg.UpdateDownloadState.Status = "cancelled"
		_ = s.SaveSettings(cfg)
	}

	dmMu.Lock()
	currentDM = nil
	dmMu.Unlock()

	s.EmitEvent("update:downloadCancelled", nil)
	return nil
}

// ApplyDownloadedUpdate 应用已下载完成的更新。
func (s *MusicService) ApplyDownloadedUpdate() error {
	cfg := s.LoadSettings()
	if cfg.UpdateDownloadState == nil {
		return fmt.Errorf("没有已下载的更新")
	}
	if cfg.UpdateDownloadState.Status != "completed" {
		return fmt.Errorf("下载尚未完成")
	}

	downloadedPath := cfg.UpdateDownloadState.OutputPath
	if _, err := os.Stat(downloadedPath); err != nil {
		return fmt.Errorf("已下载的文件不存在: %w", err)
	}

	cfg.UpdateDownloadState = nil
	_ = s.SaveSettings(cfg)

	return s.applyDownloadedFile(downloadedPath)
}

// ClearUpdateDownloadState 清除持久化的下载状态。
func (s *MusicService) ClearUpdateDownloadState() {
	cfg := s.LoadSettings()
	cfg.UpdateDownloadState = nil
	_ = s.SaveSettings(cfg)
}

// SetUpdateThreadCount 设置下载线程数（1-256；ghproxy 模式下上限 16）。
func (s *MusicService) SetUpdateThreadCount(count int) error {
	cfg := s.LoadSettings()
	maxThreads := 256
	if cfg.UpdateProxyMode == "ghproxy" {
		maxThreads = 16
	}
	if count < 1 || count > maxThreads {
		return fmt.Errorf("线程数必须在 1-%d 之间", maxThreads)
	}
	cfg.UpdateThreadCount = count
	return s.SaveSettings(cfg)
}
