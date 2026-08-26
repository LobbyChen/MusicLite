package downloader

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"os"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"golang.org/x/time/rate"
)

// Chunk 表示下载的一个数据块
type Chunk struct {
	Start      int64
	End        int64
	Downloaded int64
	Index      int
}

// DownloadManager 多线程断点续传下载管理器
type DownloadManager struct {
	url           string
	outputPath    string
	fileSize      int64
	chunks        []*Chunk
	threadCount   uint64
	activeThreads int64

	mu        sync.RWMutex
	ctx       context.Context
	cancel    context.CancelFunc
	pauseCond *sync.Cond

	downloaded int64
	isPaused   bool
	isStopped  bool

	client  *http.Client
	limiter *rate.Limiter // 速率限制器

	wg      sync.WaitGroup
	bufPool sync.Pool // 缓冲区对象池
}

// NewDownloadManager 创建下载管理器实例
func NewDownloadManager(url, outputPath string) *DownloadManager {
	ctx, cancel := context.WithCancel(context.Background())

	// 优化 Transport 以支持高并发连接复用
	transport := &http.Transport{
		MaxIdleConns:        100,
		MaxIdleConnsPerHost: 100,
		IdleConnTimeout:     90 * time.Second,
		DisableCompression:  false, // 如果服务器支持压缩，可以开启以节省带宽
	}

	dm := &DownloadManager{
		url:        url,
		outputPath: outputPath,
		ctx:        ctx,
		cancel:     cancel,
		client:     &http.Client{Transport: transport, Timeout: 60 * time.Second},
		// 默认不限速，如果需要可以后续设置
		limiter: rate.NewLimiter(rate.Inf, 0),
	}

	dm.pauseCond = sync.NewCond(&dm.mu)

	// 初始化缓冲区池，每个 goroutine 可以从池中获取一个 256KB 的 buffer
	dm.bufPool = sync.Pool{
		New: func() interface{} {
			buf := make([]byte, 256*1024) // 256KB 缓冲区
			return buf
		},
	}

	return dm
}

// SetRateLimit 设置下载速率限制 (bytes per second)
func (dm *DownloadManager) SetRateLimit(bytesPerSecond float64) {
	if bytesPerSecond > 0 {
		dm.limiter = rate.NewLimiter(rate.Limit(bytesPerSecond), int(256*1024))
	} else {
		dm.limiter = rate.NewLimiter(rate.Inf, 0)
	}
}

// Init 获取元数据并初始化分块信息
func (dm *DownloadManager) Init(threads uint64) error {
	if threads == 0 {
		threads = 4 // 默认 4 线程
	}
	dm.threadCount = threads

	req, err := http.NewRequest("GET", dm.url, nil)
	if err != nil {
		return fmt.Errorf("创建请求失败: %w", err)
	}
	req.Header.Set("Range", "bytes=0-0")

	resp, err := dm.client.Do(req)
	if err != nil {
		return fmt.Errorf("获取元数据失败: %w", err)
	}
	defer resp.Body.Close()
	io.Copy(io.Discard, resp.Body)

	if resp.StatusCode == http.StatusPartialContent {
		cr := resp.Header.Get("Content-Range")
		idx := strings.LastIndexByte(cr, '/')
		if idx < 0 || idx == len(cr)-1 {
			return fmt.Errorf("无法解析 Content-Range: %s", cr)
		}
		size, err := strconv.ParseInt(cr[idx+1:], 10, 64)
		if err != nil || size <= 0 {
			return fmt.Errorf("解析文件大小失败: %s", cr)
		}
		dm.fileSize = size
	} else if resp.StatusCode == http.StatusOK && resp.ContentLength > 0 {
		dm.fileSize = resp.ContentLength
	} else {
		return fmt.Errorf("服务器不支持 Range 请求或无法获取大小，状态码: %d", resp.StatusCode)
	}

	// 计算 chunks
	chunkSize := dm.fileSize / int64(threads)
	if chunkSize == 0 {
		chunkSize = dm.fileSize
	}

	dm.chunks = make([]*Chunk, 0, threads)
	var start int64
	for i := uint64(0); i < threads; i++ {
		end := start + chunkSize - 1
		if i == threads-1 {
			end = dm.fileSize - 1
		}
		dm.chunks = append(dm.chunks, &Chunk{
			Start: start,
			End:   end,
			Index: int(i),
		})
		start = end + 1
	}

	dm.loadProgress()
	return nil
}

// loadProgress 从临时文件加载已下载的进度
func (dm *DownloadManager) loadProgress() {
	tempFile := dm.outputPath + ".tmp"
	info, err := os.Stat(tempFile)
	if err != nil {
		return
	}

	fileSize := info.Size()
	if fileSize >= dm.fileSize {
		atomic.StoreInt64(&dm.downloaded, dm.fileSize)
		for _, c := range dm.chunks {
			c.Downloaded = c.End - c.Start + 1
		}
		return
	}

	// 简单策略：按顺序填充 chunks 的进度
	remaining := fileSize
	for _, c := range dm.chunks {
		chunkLen := c.End - c.Start + 1
		if remaining >= chunkLen {
			c.Downloaded = chunkLen
			remaining -= chunkLen
		} else {
			c.Downloaded = remaining
			remaining = 0
		}
	}
	atomic.StoreInt64(&dm.downloaded, fileSize)
}

// Start 启动下载
func (dm *DownloadManager) Start() error {
	dm.mu.Lock()
	if dm.isStopped {
		dm.mu.Unlock()
		return fmt.Errorf("下载器已停止")
	}
	dm.mu.Unlock()

	tempFile := dm.outputPath + ".tmp"
	file, err := os.OpenFile(tempFile, os.O_CREATE|os.O_WRONLY, 0644)
	if err != nil {
		return fmt.Errorf("创建文件失败: %w", err)
	}

	if err := file.Truncate(dm.fileSize); err != nil {
		file.Close()
		return fmt.Errorf("预分配文件空间失败: %w", err)
	}

	dm.startWorkers(file)
	return nil
}

// startWorkers 启动工作线程池
func (dm *DownloadManager) startWorkers(file *os.File) {
	taskChan := make(chan *Chunk, len(dm.chunks))
	resultChan := make(chan *Chunk, len(dm.chunks))

	for _, chunk := range dm.chunks {
		if chunk.Downloaded < (chunk.End - chunk.Start + 1) {
			taskChan <- chunk
		}
	}
	close(taskChan)

	for i := uint64(0); i < dm.threadCount; i++ {
		dm.wg.Add(1)
		atomic.AddInt64(&dm.activeThreads, 1)
		go dm.worker(taskChan, resultChan, file, i)
	}

	go dm.collectResults(resultChan)

	go func() {
		dm.wg.Wait()
		close(resultChan)
		file.Close()
		dm.finalizeDownload()
	}()
}

// worker 工作线程
func (dm *DownloadManager) worker(taskChan <-chan *Chunk, resultChan chan<- *Chunk, file *os.File, workerID uint64) {
	defer dm.wg.Done()
	defer atomic.AddInt64(&dm.activeThreads, -1)

	for chunk := range taskChan {
		err := dm.downloadChunk(chunk, file)
		if err != nil {
			fmt.Printf("Worker %d: Chunk %d 最终失败: %v\n", workerID, chunk.Index, err)
			continue
		}

		select {
		case resultChan <- chunk:
		case <-dm.ctx.Done():
			return
		}
	}
}

// downloadChunk 下载单个chunk
func (dm *DownloadManager) downloadChunk(chunk *Chunk, file *os.File) error {
	retries := 3
	// 从对象池获取缓冲区
	buf := dm.bufPool.Get().([]byte)
	defer dm.bufPool.Put(buf)

	for attempt := 0; attempt < retries; attempt++ {
		select {
		case <-dm.ctx.Done():
			return fmt.Errorf("下载被取消")
		default:
		}

		// 检查暂停状态
		dm.mu.Lock()
		for dm.isPaused && !dm.isStopped {
			dm.pauseCond.Wait()
		}
		if dm.isStopped {
			dm.mu.Unlock()
			return fmt.Errorf("下载已停止")
		}
		dm.mu.Unlock()

		currentStart := chunk.Start + chunk.Downloaded
		if currentStart > chunk.End {
			return nil
		}

		req, err := http.NewRequest("GET", dm.url, nil)
		if err != nil {
			time.Sleep(time.Second)
			continue
		}

		rangeHeader := fmt.Sprintf("bytes=%d-%d", currentStart, chunk.End)
		req.Header.Set("Range", rangeHeader)

		resp, err := dm.client.Do(req)
		if err != nil {
			time.Sleep(time.Duration(attempt+1) * time.Second)
			continue
		}

		if resp.StatusCode != http.StatusPartialContent {
			resp.Body.Close()
			time.Sleep(time.Duration(attempt+1) * time.Second)
			continue
		}

		totalRead := int64(0)
		for {
			// 速率限制
			if dm.limiter.Limit() != rate.Inf {
				dm.limiter.WaitN(dm.ctx, len(buf))
			}

			n, readErr := resp.Body.Read(buf)
			if n > 0 {
				writePos := currentStart + totalRead
				_, writeErr := file.WriteAt(buf[:n], writePos)
				if writeErr != nil {
					resp.Body.Close()
					return fmt.Errorf("写入文件失败: %w", writeErr)
				}
				totalRead += int64(n)
				atomic.AddInt64(&chunk.Downloaded, int64(n))
				atomic.AddInt64(&dm.downloaded, int64(n))
			}

			if readErr == io.EOF {
				break
			}
			if readErr != nil {
				break
			}
		}
		resp.Body.Close()

		if totalRead > 0 {
			return nil
		}
		time.Sleep(time.Duration(attempt+1) * time.Second)
	}
	return fmt.Errorf("达到最大重试次数")
}

func (dm *DownloadManager) collectResults(resultChan <-chan *Chunk) {
	for range resultChan {
		// 可以在这里添加进度回调
	}
}

func (dm *DownloadManager) finalizeDownload() {
	tempFile := dm.outputPath + ".tmp"
	if dm.GetProcess() >= 1.0 {
		if err := os.Rename(tempFile, dm.outputPath); err != nil {
			fmt.Printf("重命名文件失败: %v\n", err)
		} else {
			fmt.Println("下载完成！")
		}
	}
}

// Pause 暂停下载
func (dm *DownloadManager) Pause() {
	dm.mu.Lock()
	defer dm.mu.Unlock()
	if !dm.isPaused && !dm.isStopped {
		dm.isPaused = true
		fmt.Println("下载已暂停")
	}
}

// Resume 继续下载
func (dm *DownloadManager) Resume() {
	dm.mu.Lock()
	defer dm.mu.Unlock()
	if dm.isPaused {
		dm.isPaused = false
		dm.pauseCond.Broadcast()
		fmt.Println("下载已恢复")
	}
}

func (dm *DownloadManager) PauseAndResume() {
	if dm.isPaused {
		dm.Pause()
	} else {
		dm.Resume()
	}
}

// Stop 停止下载
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
	fmt.Println("下载已停止")
}

func (dm *DownloadManager) GetProcess() float64 {
	if dm.fileSize == 0 {
		return 0
	}
	downloaded := atomic.LoadInt64(&dm.downloaded)
	progress := float64(downloaded) / float64(dm.fileSize)
	if progress > 1.0 {
		return 1.0
	}
	return progress
}

func (dm *DownloadManager) GetActiveThreads() int64 {
	return atomic.LoadInt64(&dm.activeThreads)
}

func (dm *DownloadManager) GetDownloadedBytes() int64 {
	return atomic.LoadInt64(&dm.downloaded)
}

func (dm *DownloadManager) GetFileSize() int64 {
	return dm.fileSize
}

// IsPaused 返回当前下载管理器是否处于暂停状态
func (dm *DownloadManager) IsPaused() bool {
	dm.mu.RLock()
	defer dm.mu.RUnlock()
	return dm.isPaused && !dm.isStopped
}

// IsStopped 返回当前下载管理器是否已被 Stop
func (dm *DownloadManager) IsStopped() bool {
	dm.mu.RLock()
	defer dm.mu.RUnlock()
	return dm.isStopped
}
