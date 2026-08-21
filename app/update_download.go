package app

// ============ 更新下载管理（基于 internal/downloader 多线程引擎）============
//
// 设计：
//   - 使用 internal/downloader.DownloadManager 做实际的多线程分块下载
//   - 单例 dm 保存当前下载任务，支持前端轮询进度、取消
//   - 下载状态持久化到 settings.json，应用重启后前端可恢复进度条
//   - 下载完成不自动重启，而是发事件通知前端弹出"重启更新"提示
//
// 流程：
//   1. 前端调用 StartUpdateDownload(info) → 后端创建 dm 并异步启动
//   2. 前端轮询 GetUpdateDownloadProgress() → 返回 {downloaded, total, progress, status}
//   3. 用户取消 → CancelUpdateDownload() → dm.Stop() + 持久化 status="cancelled"
//   4. 下载完成 → 持久化 status="completed" + 发 "update:downloadCompleted" 事件
//   5. 前端收到事件 → 弹出"下载完成，是否重启更新？"提示
//   6. 用户确认 → 调用 ApplyDownloadedUpdate() → 走原有 .cmd 替换流程

import (
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"sync/atomic"
	"time"

	"MusicLite/internal/downloader"
)

// updateDownloadProgress 返回给前端的进度信息
type updateDownloadProgress struct {
	Downloaded int64   `json:"downloaded"` // 已下载字节
	Total      int64   `json:"total"`      // 文件总大小
	Progress   float64 `json:"progress"`   // 0~1
	Speed      int64   `json:"speed"`      // 下载速度（字节/秒）
	Status     string  `json:"status"`     // "idle" / "downloading" / "completed" / "cancelled" / "error"
	FileName   string  `json:"fileName"`   // 资产名
	LatestVer  string  `json:"latestVer"`  // 新版本号
	Error      string  `json:"error,omitempty"`
}

// 全局下载管理器（单例）
var (
	currentDM     *downloader.DownloadManager
	currentDMInfo UpdateInfo
	dmMu          sync.Mutex

	// 速度统计
	lastSpeedSample time.Time
	lastDownloaded  int64
	currentSpeed    int64
)

// StartUpdateDownload 启动更新下载（异步，立即返回）
// info: 前端传入的 UpdateInfo（来自 CheckForUpdate）
func (a *MusicService) StartUpdateDownload(info UpdateInfo) error {
	if info.DownloadURL == "" {
		return fmt.Errorf("没有可用的下载地址")
	}

	dmMu.Lock()
	defer dmMu.Unlock()

	// 如果已有下载在进行，拒绝重复启动
	if currentDM != nil {
		return fmt.Errorf("已有下载任务正在进行")
	}

	// 读取线程数配置
	s := a.LoadSettings()
	threads := s.UpdateThreadCount
	if threads < 1 {
		threads = 1
	}
	if threads > 256 {
		threads = 256
	}

	// 计算临时文件路径
	tempDir := os.Getenv("TEMP")
	if tempDir == "" {
		tempDir = os.TempDir()
	}
	downloadName := info.DownloadName
	if downloadName == "" {
		downloadName = "MusicLite_update.zip"
	}
	outputPath := filepath.Join(tempDir, "MusicLite_update"+filepath.Ext(downloadName))

	// 创建下载管理器
	dm := downloader.NewDownloadManager(info.DownloadURL, outputPath)
	if err := dm.Init(uint64(threads)); err != nil {
		return fmt.Errorf("初始化下载失败: %w", err)
	}

	// 保存状态到 settings（用于重启后恢复进度条显示）
	s.UpdateDownloadState = &UpdateDownloadState{
		URL:        info.DownloadURL,
		FileName:   info.DownloadName,
		OutputPath: outputPath,
		LatestVer:  info.LatestVer,
		FileSize:   dm.GetFileSize(),
		Downloaded: 0,
		Status:     "downloading",
	}
	_ = a.SaveSettings(s)

	currentDM = dm
	currentDMInfo = info
	lastSpeedSample = time.Now()
	lastDownloaded = 0
	atomic.StoreInt64(&currentSpeed, 0)

	// 异步启动下载
	go func() {
		err := dm.Start()
		if err != nil {
			// 启动失败：更新持久化状态
			s := a.LoadSettings()
			if s.UpdateDownloadState != nil {
				s.UpdateDownloadState.Status = "error"
				s.UpdateDownloadState.ErrorMessage = err.Error()
				_ = a.SaveSettings(s)
			}
			// 发事件通知前端
			a.EmitEvent("update:downloadError", err.Error())
			return
		}

		// 下载完成后的处理由 finalizeDownload 内部触发（rename .tmp → 最终文件）
		// 这里轮询等待完成
		for {
			time.Sleep(500 * time.Millisecond)
			progress := dm.GetProcess()
			if progress >= 1.0 {
				// 下载完成
				s := a.LoadSettings()
				if s.UpdateDownloadState != nil {
					s.UpdateDownloadState.Status = "completed"
					s.UpdateDownloadState.Downloaded = dm.GetFileSize()
					_ = a.SaveSettings(s)
				}
				a.EmitEvent("update:downloadCompleted", currentDMInfo.LatestVer)
				// 清理单例
				dmMu.Lock()
				currentDM = nil
				dmMu.Unlock()
				return
			}
			// 检查是否已停止/取消
			dmMu.Lock()
			if currentDM != dm {
				// 已被替换或取消
				dmMu.Unlock()
				return
			}
			dmMu.Unlock()
		}
	}()

	return nil
}

// GetUpdateDownloadProgress 获取当前下载进度
func (a *MusicService) GetUpdateDownloadProgress() updateDownloadProgress {
	dmMu.Lock()
	dm := currentDM
	info := currentDMInfo
	dmMu.Unlock()

	if dm == nil {
		// 没有活跃下载，从持久化状态恢复
		s := a.LoadSettings()
		if s.UpdateDownloadState != nil {
			st := s.UpdateDownloadState
			progress := 0.0
			if st.FileSize > 0 {
				progress = float64(st.Downloaded) / float64(st.FileSize)
			}
			return updateDownloadProgress{
				Downloaded: st.Downloaded,
				Total:      st.FileSize,
				Progress:   progress,
				Status:     st.Status,
				FileName:   st.FileName,
				LatestVer:  st.LatestVer,
				Error:      st.ErrorMessage,
			}
		}
		return updateDownloadProgress{Status: "idle"}
	}

	downloaded := dm.GetDownloadedBytes()
	total := dm.GetFileSize()
	progress := dm.GetProcess()

	// 计算速度（每秒采样一次）
	now := time.Now()
	if now.Sub(lastSpeedSample) >= time.Second {
		delta := downloaded - lastDownloaded
		elapsed := now.Sub(lastSpeedSample).Seconds()
		if elapsed > 0 {
			atomic.StoreInt64(&currentSpeed, int64(float64(delta)/elapsed))
		}
		lastSpeedSample = now
		lastDownloaded = downloaded
	}

	return updateDownloadProgress{
		Downloaded: downloaded,
		Total:      total,
		Progress:   progress,
		Speed:      atomic.LoadInt64(&currentSpeed),
		Status:     "downloading",
		FileName:   info.DownloadName,
		LatestVer:  info.LatestVer,
	}
}

// CancelUpdateDownload 取消当前下载
func (a *MusicService) CancelUpdateDownload() error {
	dmMu.Lock()
	dm := currentDM
	dmMu.Unlock()

	if dm == nil {
		return fmt.Errorf("没有正在进行的下载")
	}

	dm.Stop()

	// 更新持久化状态
	s := a.LoadSettings()
	if s.UpdateDownloadState != nil {
		s.UpdateDownloadState.Status = "cancelled"
		_ = a.SaveSettings(s)
	}

	// 清理单例
	dmMu.Lock()
	currentDM = nil
	dmMu.Unlock()

	a.EmitEvent("update:downloadCancelled", nil)
	return nil
}

// ApplyDownloadedUpdate 应用已下载完成的更新
// 使用已下载的文件（不再重新下载），生成 .cmd 脚本在主进程退出后替换可执行文件
func (a *MusicService) ApplyDownloadedUpdate() error {
	s := a.LoadSettings()
	if s.UpdateDownloadState == nil {
		return fmt.Errorf("没有已下载的更新")
	}
	if s.UpdateDownloadState.Status != "completed" {
		return fmt.Errorf("下载尚未完成")
	}

	// 使用持久化中保存的下载文件路径
	downloadedPath := s.UpdateDownloadState.OutputPath

	// 校验文件存在
	if _, err := os.Stat(downloadedPath); err != nil {
		return fmt.Errorf("已下载的文件不存在: %w", err)
	}

	// 清理持久化状态
	s.UpdateDownloadState = nil
	_ = a.SaveSettings(s)

	// 调用平台特定的应用更新逻辑
	return a.applyDownloadedFile(downloadedPath)
}

// ClearUpdateDownloadState 清除持久化的下载状态（用户取消或应用更新后调用）
func (a *MusicService) ClearUpdateDownloadState() {
	s := a.LoadSettings()
	s.UpdateDownloadState = nil
	_ = a.SaveSettings(s)
}

// SetUpdateThreadCount 设置下载线程数（1-256）
func (a *MusicService) SetUpdateThreadCount(count int) error {
	if count < 1 || count > 256 {
		return fmt.Errorf("线程数必须在 1-256 之间")
	}
	s := a.LoadSettings()
	s.UpdateThreadCount = count
	return a.SaveSettings(s)
}
