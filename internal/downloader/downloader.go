// Package downloader 提供多线程分块下载引擎。
//
// 核心逻辑移植自独立 downloader 项目：
//   - 先探测服务器是否支持 Range，再决定多线程分块或单线程整文件下载
//   - 每个分块独立重试 + 指数退避，失败分块从已写入位置继续
//   - 使用 WriteAt 按偏移写入，避免多线程共享文件指针竞争
//
// 对外保留 MusicLite 原有的 DownloadManager 接口（Init / Start / PauseAndResume /
// Stop / GetProcess 等），便于 update_download.go 与前端事件层无感切换。
package downloader

import (
	"context"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

const (
	userAgent       = "MusicLite/1.0"
	copyBufferSize  = 64 * 1024
	maxRetries      = 5
	metadataTimeout = 15 * time.Second
	maxBackoff      = 30 * time.Second
)

// Chunk 表示下载的一个数据块。
type Chunk struct {
	Start      int64
	End        int64
	Downloaded int64
	Index      int
}

// DownloadManager 多线程分块下载管理器。
type DownloadManager struct {
	url        string
	outputPath string
	tempPath   string

	fileSize     int64
	threads      uint64
	acceptRanges bool
	rangeMode    bool
	chunks       []*Chunk

	downloaded    int64
	activeThreads int64

	mu        sync.Mutex
	ctx       context.Context
	cancel    context.CancelFunc
	pauseCond *sync.Cond

	isPaused    bool
	isStopped   bool
	isStarted   bool
	isCompleted bool
	err         error

	client *http.Client
	wg     sync.WaitGroup
}

// NewDownloadManager 创建下载管理器实例。
func NewDownloadManager(url, outputPath string) *DownloadManager {
	ctx, cancel := context.WithCancel(context.Background())

	transport := &http.Transport{
		Proxy:                 http.ProxyFromEnvironment,
		MaxIdleConns:          100,
		MaxIdleConnsPerHost:   100,
		IdleConnTimeout:       90 * time.Second,
		ResponseHeaderTimeout: 30 * time.Second,
		// Range 请求必须保持字节偏移一致，禁止透明 gzip 解压
		DisableCompression: true,
	}

	dm := &DownloadManager{
		url:        url,
		outputPath: outputPath,
		tempPath:   outputPath + ".tmp",
		ctx:        ctx,
		cancel:     cancel,
		client:     &http.Client{Transport: transport},
	}
	dm.pauseCond = sync.NewCond(&dm.mu)
	return dm
}

// Init 探测文件大小与 Range 支持，并初始化分块信息。
func (dm *DownloadManager) Init(threads uint64) error {
	if threads == 0 {
		threads = 4
	}
	dm.threads = threads

	size, acceptRanges, err := dm.probe()
	if err != nil {
		return err
	}
	if size <= 0 {
		return fmt.Errorf("文件大小无效: %d", size)
	}
	dm.fileSize = size
	dm.acceptRanges = acceptRanges

	// 服务器不支持 Range 或只开 1 线程：整文件单线程下载
	if !acceptRanges || threads <= 1 {
		dm.chunks = []*Chunk{{Start: 0, End: size - 1, Index: 0}}
		dm.rangeMode = false
		return nil
	}

	chunkSize := size / int64(threads)
	if chunkSize < 1 {
		chunkSize = 1
	}
	dm.chunks = make([]*Chunk, 0, threads)
	var start int64
	for i := uint64(0); i < threads && start < size; i++ {
		end := start + chunkSize - 1
		if i == threads-1 || end >= size {
			end = size - 1
		}
		dm.chunks = append(dm.chunks, &Chunk{Start: start, End: end, Index: int(i)})
		start = end + 1
	}
	dm.rangeMode = len(dm.chunks) > 1
	return nil
}

// probe 使用 Range: bytes=0-0 探测文件大小与分块支持情况。
// 比 HEAD 更兼容：部分代理/服务器会拒绝 HEAD，但仍能正常 GET。
func (dm *DownloadManager) probe() (int64, bool, error) {
	ctx, cancel := context.WithTimeout(dm.ctx, metadataTimeout)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, dm.url, nil)
	if err != nil {
		return 0, false, fmt.Errorf("创建探测请求失败: %w", err)
	}
	req.Header.Set("User-Agent", userAgent)
	req.Header.Set("Accept-Encoding", "identity")
	req.Header.Set("Range", "bytes=0-0")

	resp, err := dm.client.Do(req)
	if err != nil {
		return 0, false, fmt.Errorf("获取文件信息失败: %w", err)
	}
	defer resp.Body.Close()

	switch resp.StatusCode {
	case http.StatusPartialContent:
		size := parseContentRangeTotal(resp.Header.Get("Content-Range"))
		if size <= 0 {
			return 0, false, fmt.Errorf("无法解析文件大小: %q", resp.Header.Get("Content-Range"))
		}
		return size, true, nil
	case http.StatusOK:
		if resp.ContentLength > 0 {
			// 服务器忽略 Range，返回完整内容长度，降级单线程
			return resp.ContentLength, false, nil
		}
		return 0, false, fmt.Errorf("服务器未返回文件大小")
	default:
		return 0, false, fmt.Errorf("获取文件信息失败: HTTP %d", resp.StatusCode)
	}
}

// parseContentRangeTotal 从 Content-Range（bytes 0-0/12345）中解析总大小。
func parseContentRangeTotal(v string) int64 {
	idx := strings.LastIndexByte(v, '/')
	if idx < 0 || idx == len(v)-1 {
		return 0
	}
	size, err := strconv.ParseInt(strings.TrimSpace(v[idx+1:]), 10, 64)
	if err != nil {
		return 0
	}
	return size
}

// Start 创建临时文件并异步启动下载，立即返回。
func (dm *DownloadManager) Start() error {
	if dm.fileSize <= 0 || len(dm.chunks) == 0 {
		return fmt.Errorf("下载器未初始化")
	}
	dm.mu.Lock()
	if dm.isStopped {
		dm.mu.Unlock()
		return fmt.Errorf("下载器已停止")
	}
	if dm.isStarted {
		dm.mu.Unlock()
		return fmt.Errorf("下载已启动")
	}
	dm.isStarted = true
	dm.mu.Unlock()

	f, err := os.OpenFile(dm.tempPath, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o644)
	if err != nil {
		return fmt.Errorf("创建临时文件失败: %w", err)
	}
	if dm.fileSize > 0 {
		if err := f.Truncate(dm.fileSize); err != nil {
			f.Close()
			_ = os.Remove(dm.tempPath)
			return fmt.Errorf("预分配文件空间失败: %w", err)
		}
	}

	log.Printf("[downloader] 开始下载 %s，大小 %d，线程 %d，Range=%v",
		dm.outputPath, dm.fileSize, len(dm.chunks), dm.rangeMode)

	go func() {
		dm.run(f)
	}()
	return nil
}

// run 启动所有分块协程并等待完成。
func (dm *DownloadManager) run(f *os.File) {
	for _, c := range dm.chunks {
		dm.wg.Add(1)
		go func(c *Chunk) {
			defer dm.wg.Done()
			dm.worker(f, c)
		}(c)
	}
	dm.wg.Wait()

	// Windows 下必须先关闭临时文件句柄，否则 finish 中 rename 会失败
	if err := f.Close(); err != nil {
		dm.setError(fmt.Errorf("关闭临时文件失败: %w", err))
	}
	dm.finish()
}

// worker 下载单个分块，失败时从已写入位置重试。
func (dm *DownloadManager) worker(f *os.File, c *Chunk) {
	atomic.AddInt64(&dm.activeThreads, 1)
	defer atomic.AddInt64(&dm.activeThreads, -1)

	buf := make([]byte, copyBufferSize)

	for attempt := 0; attempt <= maxRetries; attempt++ {
		if attempt > 0 && !dm.sleepBackoff(attempt) {
			return
		}
		if dm.ctx.Err() != nil || dm.Error() != nil {
			return
		}
		dm.waitIfPaused()
		if dm.IsStopped() {
			return
		}

		already := atomic.LoadInt64(&c.Downloaded)
		start := c.Start + already
		if start > c.End {
			return
		}
		// 单线程降级模式下无法按 Range 续传：重试时从头覆盖整个文件，
		// 同时回退已计入的进度，避免重复字节被累计。
		if !dm.rangeMode && attempt > 0 && already > 0 {
			atomic.AddInt64(&dm.downloaded, -already)
			atomic.StoreInt64(&c.Downloaded, 0)
			start = c.Start
		}

		req, err := http.NewRequestWithContext(dm.ctx, http.MethodGet, dm.url, nil)
		if err != nil {
			dm.setError(err)
			return
		}
		req.Header.Set("User-Agent", userAgent)
		req.Header.Set("Accept-Encoding", "identity")
		if dm.rangeMode {
			req.Header.Set("Range", fmt.Sprintf("bytes=%d-%d", start, c.End))
		}

		resp, err := dm.client.Do(req)
		if err != nil {
			if dm.ctx.Err() != nil {
				return
			}
			continue
		}
		expectedStatus := http.StatusOK
		if dm.rangeMode {
			expectedStatus = http.StatusPartialContent
		}
		if resp.StatusCode != expectedStatus {
			resp.Body.Close()
			continue
		}

		pos := start
		var readErr error
		for {
			if dm.ctx.Err() != nil {
				readErr = dm.ctx.Err()
				break
			}
			dm.waitIfPaused()
			if dm.IsStopped() {
				readErr = context.Canceled
				break
			}
			n, rerr := resp.Body.Read(buf)
			if n > 0 {
				if _, werr := f.WriteAt(buf[:n], pos); werr != nil {
					readErr = werr
					break
				}
				pos += int64(n)
				atomic.AddInt64(&c.Downloaded, int64(n))
				atomic.AddInt64(&dm.downloaded, int64(n))
			}
			if rerr == io.EOF {
				break
			}
			if rerr != nil {
				readErr = rerr
				break
			}
		}
		resp.Body.Close()

		if pos >= c.End+1 {
			return
		}
		if dm.ctx.Err() != nil {
			return
		}
		if readErr != nil {
			log.Printf("[downloader] 分块 %d 中断，从 %d 继续: %v", c.Index, pos, readErr)
		}
	}

	dm.setError(fmt.Errorf("分块 %d 下载失败（已重试 %d 次）", c.Index, maxRetries))
}

// finish 校验所有分块并完成临时文件重命名。
func (dm *DownloadManager) finish() {
	dm.mu.Lock()
	stopped := dm.isStopped
	err := dm.err
	dm.mu.Unlock()

	if stopped || err != nil {
		_ = os.Remove(dm.tempPath)
		return
	}

	for _, c := range dm.chunks {
		if atomic.LoadInt64(&c.Downloaded) < c.End-c.Start+1 {
			dm.setError(fmt.Errorf("下载未完成: 分块 %d", c.Index))
			_ = os.Remove(dm.tempPath)
			return
		}
	}

	// Windows 上 os.Rename 不会覆盖已存在的目标文件，先清理旧文件
	_ = os.Remove(dm.outputPath)
	if err := os.Rename(dm.tempPath, dm.outputPath); err != nil {
		dm.setError(fmt.Errorf("重命名下载文件失败: %w", err))
		_ = os.Remove(dm.tempPath)
		return
	}

	dm.mu.Lock()
	dm.isCompleted = true
	dm.mu.Unlock()
	log.Printf("[downloader] 下载完成: %s (%d bytes)", dm.outputPath, dm.fileSize)
}

// setError 记录首个错误并取消其余分块，避免无效等待。
func (dm *DownloadManager) setError(err error) {
	if err == nil {
		return
	}
	dm.mu.Lock()
	if dm.err == nil {
		dm.err = err
	}
	dm.isPaused = false
	dm.pauseCond.Broadcast()
	dm.mu.Unlock()
	dm.cancel()
}

// Error 返回下载过程中的首个错误（完成后为 nil）。
func (dm *DownloadManager) Error() error {
	dm.mu.Lock()
	defer dm.mu.Unlock()
	return dm.err
}

// sleepBackoff 指数退避等待，返回 false 表示已被取消。
func (dm *DownloadManager) sleepBackoff(attempt int) bool {
	wait := time.Duration(1<<uint(attempt)) * time.Second
	if wait > maxBackoff {
		wait = maxBackoff
	}
	timer := time.NewTimer(wait)
	defer timer.Stop()
	select {
	case <-timer.C:
		return true
	case <-dm.ctx.Done():
		return false
	}
}

// waitIfPaused 在暂停状态下阻塞当前协程。
func (dm *DownloadManager) waitIfPaused() {
	dm.mu.Lock()
	for dm.isPaused && !dm.isStopped {
		dm.pauseCond.Wait()
	}
	dm.mu.Unlock()
}

// Pause 暂停下载。
func (dm *DownloadManager) Pause() {
	dm.mu.Lock()
	defer dm.mu.Unlock()
	if !dm.isStopped {
		dm.isPaused = true
	}
}

// Resume 继续下载。
func (dm *DownloadManager) Resume() {
	dm.mu.Lock()
	defer dm.mu.Unlock()
	if dm.isPaused {
		dm.isPaused = false
		dm.pauseCond.Broadcast()
	}
}

// PauseAndResume 在暂停/继续之间切换。
func (dm *DownloadManager) PauseAndResume() {
	if dm.IsPaused() {
		dm.Resume()
	} else {
		dm.Pause()
	}
}

// Stop 停止下载并等待所有协程退出。
func (dm *DownloadManager) Stop() {
	dm.mu.Lock()
	if dm.isStopped {
		dm.mu.Unlock()
		return
	}
	dm.isStopped = true
	dm.isPaused = false
	dm.cancel()
	dm.pauseCond.Broadcast()
	dm.mu.Unlock()

	dm.wg.Wait()
}

// GetProcess 返回 0~1 的下载进度。
func (dm *DownloadManager) GetProcess() float64 {
	if dm.fileSize <= 0 {
		return 0
	}
	dm.mu.Lock()
	completed := dm.isCompleted
	dm.mu.Unlock()
	if completed {
		return 1.0
	}
	progress := float64(atomic.LoadInt64(&dm.downloaded)) / float64(dm.fileSize)
	if progress < 0 {
		return 0
	}
	if progress >= 1.0 {
		// 字节已收齐但临时文件尚未重命名，避免下游过早读取
		return 0.999
	}
	return progress
}

// GetActiveThreads 返回活跃线程数。
func (dm *DownloadManager) GetActiveThreads() int64 {
	return atomic.LoadInt64(&dm.activeThreads)
}

// GetDownloadedBytes 返回已下载字节数。
func (dm *DownloadManager) GetDownloadedBytes() int64 {
	return atomic.LoadInt64(&dm.downloaded)
}

// GetFileSize 返回文件总大小。
func (dm *DownloadManager) GetFileSize() int64 {
	return dm.fileSize
}

// IsPaused 返回是否处于暂停状态。
func (dm *DownloadManager) IsPaused() bool {
	dm.mu.Lock()
	defer dm.mu.Unlock()
	return dm.isPaused && !dm.isStopped
}

// IsStopped 返回是否已被 Stop。
func (dm *DownloadManager) IsStopped() bool {
	dm.mu.Lock()
	defer dm.mu.Unlock()
	return dm.isStopped
}
