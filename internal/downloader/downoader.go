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

	mu     sync.RWMutex
	ctx    context.Context
	cancel context.CancelFunc

	downloaded int64
	isPaused   bool
	isStopped  bool
	pauseChan  chan struct{}
	resumeChan chan struct{}

	wg sync.WaitGroup
}

// NewDownloadManager 创建下载管理器实例
func NewDownloadManager(url, outputPath string) *DownloadManager {
	ctx, cancel := context.WithCancel(context.Background())
	return &DownloadManager{
		url:        url,
		outputPath: outputPath,
		ctx:        ctx,
		cancel:     cancel,
		pauseChan:  make(chan struct{}),
		resumeChan: make(chan struct{}),
	}
}

// Init 获取元数据并初始化分块信息
func (dm *DownloadManager) Init(threads uint64) error {
	dm.threadCount = threads

	// 用 GET + Range: bytes=0-0 探测文件大小（最可靠，能穿透重定向）
	// 返回 206 Partial Content + Content-Range: bytes 0-0/12345
	req, err := http.NewRequest("GET", dm.url, nil)
	if err != nil {
		return fmt.Errorf("创建请求失败: %w", err)
	}
	req.Header.Set("Range", "bytes=0-0")

	client := &http.Client{Timeout: 30 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("获取元数据失败: %w", err)
	}
	defer resp.Body.Close()
	// 丢弃 1 字节响应体
	io.Copy(io.Discard, resp.Body)

	// 期望 206 Partial Content（支持 Range）
	if resp.StatusCode != http.StatusPartialContent {
		// 退路：服务器不支持 Range，用 Content-Length
		if resp.StatusCode == http.StatusOK && resp.ContentLength > 0 {
			dm.fileSize = resp.ContentLength
		} else {
			return fmt.Errorf("服务器不支持 Range 请求，状态码: %d", resp.StatusCode)
		}
	} else {
		// 从 Content-Range 解析文件总大小：bytes 0-0/12345
		cr := resp.Header.Get("Content-Range")
		if cr == "" {
			return fmt.Errorf("服务器未返回 Content-Range")
		}
		// 格式：bytes 0-0/12345
		idx := strings.LastIndexByte(cr, '/')
		if idx < 0 || idx == len(cr)-1 {
			return fmt.Errorf("无法解析 Content-Range: %s", cr)
		}
		size, err := strconv.ParseInt(cr[idx+1:], 10, 64)
		if err != nil || size <= 0 {
			return fmt.Errorf("解析文件大小失败: %s", cr)
		}
		dm.fileSize = size
	}

	if dm.fileSize <= 0 {
		return fmt.Errorf("无法获取文件大小")
	}

	// 计算每个chunk的大小
	chunkSize := dm.fileSize / int64(threads)
	if chunkSize == 0 {
		chunkSize = dm.fileSize
	}

	// 创建chunks
	dm.chunks = make([]*Chunk, 0)
	var start int64
	for i := uint64(0); i < threads; i++ {
		end := start + chunkSize - 1
		if i == threads-1 {
			end = dm.fileSize - 1 // 最后一个chunk包含剩余所有字节
		}

		dm.chunks = append(dm.chunks, &Chunk{
			Start: start,
			End:   end,
			Index: int(i),
		})
		start = end + 1
	}

	// 检查是否存在部分下载的文件，恢复进度
	dm.loadProgress()

	return nil
}

// loadProgress 从临时文件加载已下载的进度
func (dm *DownloadManager) loadProgress() {
	tempFile := dm.outputPath + ".tmp"
	info, err := os.Stat(tempFile)
	if err != nil {
		return // 文件不存在，从头开始
	}

	fileSize := info.Size()
	if fileSize >= dm.fileSize {
		return // 文件已完整下载
	}

	// 简单策略：重新分配未完成的chunks
	// 实际项目中应该记录每个chunk的下载进度
	atomic.StoreInt64(&dm.downloaded, fileSize)
}

// Start 启动下载（阻塞直到所有 worker 完成或被取消）
func (dm *DownloadManager) Start() error {
	dm.mu.Lock()
	if dm.isStopped {
		dm.mu.Unlock()
		return fmt.Errorf("下载器已停止")
	}
	dm.mu.Unlock()

	// 创建或打开输出文件
	tempFile := dm.outputPath + ".tmp"
	file, err := os.OpenFile(tempFile, os.O_CREATE|os.O_WRONLY, 0644)
	if err != nil {
		return fmt.Errorf("创建文件失败: %w", err)
	}
	// 注意：file 不能在此 defer close，worker goroutine 需要持续写入
	// 由 startWorkers 内部的完成 goroutine 负责 close

	// 预分配文件大小
	if err := file.Truncate(dm.fileSize); err != nil {
		file.Close()
		return fmt.Errorf("预分配文件空间失败: %w", err)
	}

	// 启动工作线程池（异步）
	dm.startWorkers(file)

	return nil
}

// startWorkers 启动工作线程池
func (dm *DownloadManager) startWorkers(file *os.File) {
	taskChan := make(chan *Chunk, len(dm.chunks))
	resultChan := make(chan *Chunk, len(dm.chunks))

	// 将所有chunks放入任务队列
	for _, chunk := range dm.chunks {
		if chunk.Downloaded < (chunk.End - chunk.Start + 1) {
			taskChan <- chunk
		}
	}
	close(taskChan)

	// 启动固定数量的worker goroutines
	for i := uint64(0); i < dm.threadCount; i++ {
		dm.wg.Add(1)
		atomic.AddInt64(&dm.activeThreads, 1)
		go dm.worker(taskChan, resultChan, file, i)
	}

	// 启动结果收集goroutine
	go dm.collectResults(resultChan)

	// 等待所有worker完成，然后关闭文件
	go func() {
		dm.wg.Wait()
		close(resultChan)
		file.Close() // 所有 worker 完成后才关闭文件
		dm.finalizeDownload()
	}()
}

// worker 工作线程，从任务队列获取任务并执行
func (dm *DownloadManager) worker(taskChan <-chan *Chunk, resultChan chan<- *Chunk, file *os.File, workerID uint64) {
	defer dm.wg.Done()
	defer atomic.AddInt64(&dm.activeThreads, -1)

	for {
		select {
		case <-dm.ctx.Done():
			return
		case chunk, ok := <-taskChan:
			if !ok {
				return // 任务队列已关闭
			}

			// 执行下载
			err := dm.downloadChunk(chunk, file)
			if err != nil {
				// 失败：记录日志，不再重新入队（taskChan 已 close，send 会 panic）
				fmt.Printf("Worker %d: 下载 chunk %d 失败: %v\n", workerID, chunk.Index, err)
				// 不继续重试，直接返回让 wg 计数减少
				return
			}

			// 发送结果
			select {
			case resultChan <- chunk:
			case <-dm.ctx.Done():
				return
			}
		}
	}
}

// downloadChunk 下载单个chunk
func (dm *DownloadManager) downloadChunk(chunk *Chunk, file *os.File) error {
	retries := 3
	for attempt := 0; attempt < retries; attempt++ {
		select {
		case <-dm.ctx.Done():
			return fmt.Errorf("下载被取消")
		default:
		}

		// 检查是否暂停（加锁读取避免数据竞争）
		dm.mu.RLock()
		paused := dm.isPaused
		dm.mu.RUnlock()
		if paused {
			<-dm.resumeChan
		}

		// 构建Range请求
		currentStart := chunk.Start + chunk.Downloaded
		if currentStart > chunk.End {
			return nil // 已完成
		}

		req, err := http.NewRequest("GET", dm.url, nil)
		if err != nil {
			continue
		}

		rangeHeader := fmt.Sprintf("bytes=%d-%d", currentStart, chunk.End)
		req.Header.Set("Range", rangeHeader)

		client := &http.Client{Timeout: 60 * time.Second}
		resp, err := client.Do(req)
		if err != nil {
			time.Sleep(time.Duration(attempt+1) * time.Second) // 指数退避
			continue
		}

		if resp.StatusCode != http.StatusPartialContent && resp.StatusCode != http.StatusOK {
			resp.Body.Close()
			time.Sleep(time.Duration(attempt+1) * time.Second)
			continue
		}

		// 读取数据并写入文件指定位置
		buf := make([]byte, 32*1024) // 32KB缓冲区
		totalRead := int64(0)

		for {
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

	return fmt.Errorf("下载chunk %d 失败，已重试%d次", chunk.Index, retries)
}

// collectResults 收集下载结果
func (dm *DownloadManager) collectResults(resultChan <-chan *Chunk) {
	for chunk := range resultChan {
		// 可以在这里添加日志或其他处理
		fmt.Printf("Chunk %d 下载完成\n", chunk.Index)
	}
}

// finalizeDownload 完成下载后的清理工作
func (dm *DownloadManager) finalizeDownload() {
	tempFile := dm.outputPath + ".tmp"

	// 检查是否完整下载
	if dm.GetProcess() >= 1.0 {
		// 重命名临时文件为最终文件
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

	if !dm.isPaused {
		dm.isPaused = true
		fmt.Println("下载已暂停")
	}
}

// Resume 继续下载（内部使用）
func (dm *DownloadManager) Resume() {
	dm.mu.Lock()
	defer dm.mu.Unlock()

	if dm.isPaused {
		dm.isPaused = false
		close(dm.resumeChan)
		dm.resumeChan = make(chan struct{})
		fmt.Println("下载已恢复")
	}
}

// Stop 停止下载并清理文件
func (dm *DownloadManager) Stop() {
	dm.mu.Lock()
	if dm.isStopped {
		dm.mu.Unlock()
		return
	}
	dm.isStopped = true
	dm.cancel() // 取消context
	dm.mu.Unlock()

	// 等待 goroutines 退出（不持锁，避免阻塞 worker 的 RLock）
	dm.wg.Wait()

	// 如果未完成，删除临时文件
	if dm.GetProcess() < 1.0 {
		tempFile := dm.outputPath + ".tmp"
		os.Remove(tempFile)
		fmt.Println("下载已停止，临时文件已清理")
	}
}

// GetProcess 获取下载进度 (0~1)
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

// GetActiveThreads 获取当前活跃线程数（用于调试）
func (dm *DownloadManager) GetActiveThreads() int64 {
	return atomic.LoadInt64(&dm.activeThreads)
}

// GetDownloadedBytes 获取已下载字节数
func (dm *DownloadManager) GetDownloadedBytes() int64 {
	return atomic.LoadInt64(&dm.downloaded)
}

// GetFileSize 获取文件总大小
func (dm *DownloadManager) GetFileSize() int64 {
	return dm.fileSize
}
