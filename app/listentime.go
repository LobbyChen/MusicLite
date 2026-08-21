package app

// ============ 听歌时长统计（跨平台 JSON 文件版） ============
//
// 原 Windows 版本使用注册表（HKCU\SOFTWARE\MusicLite\Stats）存储，
// 为支持 Linux/macOS 改为跨平台的 JSON 文件：
//   {用户数据目录}/MusicLite/listen_stats.json
//
// 结构:
//   {
//     "version": 1,
//     "tracks": { "track_<id>": <seconds uint64> }
//   }
//
// 精度优化（保留原有逻辑）：
//   - 使用 math.Round 四舍五入
//   - pending 累积机制
//   - 500ms 阈值：短于 500ms 的播放不立即写入
//   - 15 秒 heartbeat：定期提交 pending

import (
	"encoding/json"
	"log"
	"math"
	"os"
	"path/filepath"
	"strconv"
	"sync"
	"time"
)

// pendingThresholdMs 短于此阈值的播放不立即写盘，先累积到 pending
const pendingThresholdMs = 500

// heartbeatInterval heartbeat 定期提交 pending 的间隔
const heartbeatInterval = 15 * time.Second

// statsFileName 听歌时长数据文件名
const statsFileName = "listen_stats.json"

// listenStatsData 持久化 JSON 结构
type listenStatsData struct {
	Version int                `json:"version"`
	Tracks  map[string]uint64  `json:"tracks"` // track_<id> → seconds
}

// listenTimeTracker 听歌时长跟踪器
type listenTimeTracker struct {
	mu        sync.Mutex
	startTime map[int64]time.Time // trackId → 开始播放时间
	pending   map[int64]int64     // trackId → 累积待写入的秒数
}

var listenTracker = &listenTimeTracker{
	startTime: make(map[int64]time.Time),
	pending:   make(map[int64]int64),
}

// statsWriteMu 保护 JSON 文件并发写入
var statsWriteMu sync.Mutex

// statsFilePath 返回听歌时长 JSON 文件路径
func statsFilePath() string {
	return filepath.Join(settingsDir(), statsFileName)
}

// loadStatsFromFile 从 JSON 文件加载时长数据
func loadStatsFromFile() (*listenStatsData, error) {
	path := statsFilePath()
	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return &listenStatsData{Version: 1, Tracks: make(map[string]uint64)}, nil
		}
		return nil, err
	}
	var s listenStatsData
	if err := json.Unmarshal(data, &s); err != nil {
		return nil, err
	}
	if s.Tracks == nil {
		s.Tracks = make(map[string]uint64)
	}
	return &s, nil
}

// saveStatsToFile 将时长数据写入 JSON 文件
func saveStatsToFile(s *listenStatsData) error {
	if s.Tracks == nil {
		s.Tracks = make(map[string]uint64)
	}
	path := statsFilePath()
	_ = os.MkdirAll(filepath.Dir(path), 0755)
	data, err := json.MarshalIndent(s, "", "  ")
	if err != nil {
		return err
	}
	tmpPath := path + ".tmp"
	if err := os.WriteFile(tmpPath, data, 0644); err != nil {
		return err
	}
	return os.Rename(tmpPath, path)
}

// RecordPlayStart 记录某首歌开始播放的时间（内存中）
func (a *MusicService) RecordPlayStart(trackId int64) {
	if trackId <= 0 {
		return
	}
	listenTracker.mu.Lock()
	defer listenTracker.mu.Unlock()
	listenTracker.startTime[trackId] = time.Now()
	log.Printf("[ListenTime] Start: trackId=%d", trackId)
}

// RecordPlayPause 计算本次播放时长并累积到 pending
func (a *MusicService) RecordPlayPause(trackId int64) {
	if trackId <= 0 {
		return
	}
	listenTracker.mu.Lock()
	start, ok := listenTracker.startTime[trackId]
	delete(listenTracker.startTime, trackId)
	listenTracker.mu.Unlock()

	if !ok {
		return
	}

	elapsedMs := time.Since(start).Milliseconds()
	elapsed := int64(math.Round(float64(elapsedMs) / 1000.0))
	if elapsed < 0 {
		elapsed = 0
	}

	listenTracker.mu.Lock()
	listenTracker.pending[trackId] += elapsed
	accumulated := listenTracker.pending[trackId]
	listenTracker.mu.Unlock()

	log.Printf("[ListenTime] Pause: trackId=%d elapsed=%ds (pending=%ds)", trackId, elapsed, accumulated)

	if accumulated > 0 && elapsedMs >= int64(pendingThresholdMs) {
		flushPending(trackId)
	}
}

// FlushListenTime 在 App 关闭时把所有未写入的播放时长持久化到 JSON 文件
func FlushListenTime() {
	listenTracker.mu.Lock()
	defer listenTracker.mu.Unlock()

	// 提交所有活跃的播放会话
	for trackId, start := range listenTracker.startTime {
		elapsed := int64(math.Round(time.Since(start).Seconds()))
		if elapsed > 0 {
			listenTracker.pending[trackId] += elapsed
		}
		delete(listenTracker.startTime, trackId)
	}

	// 把所有 pending 写入 JSON 文件
	batch := make(map[int64]int64, len(listenTracker.pending))
	for trackId, secs := range listenTracker.pending {
		if secs > 0 {
			log.Printf("[ListenTime] Flush: trackId=%d secs=%ds", trackId, secs)
			batch[trackId] = secs
		}
	}
	// 清空 pending（无论成功与否都清空，避免重复写入）
	listenTracker.pending = make(map[int64]int64)

	// 释放锁后再写盘（写盘较慢，不阻塞 tracker）
	if len(batch) > 0 {
		statsWriteMu.Lock()
		defer statsWriteMu.Unlock()
		s, err := loadStatsFromFile()
		if err != nil {
			log.Printf("[ListenTime] loadStatsFromFile failed: %v", err)
			return
		}
		for trackId, secs := range batch {
			name := trackRegistryName(trackId)
			s.Tracks[name] += uint64(secs)
		}
		if err := saveStatsToFile(s); err != nil {
			log.Printf("[ListenTime] saveStatsToFile failed: %v", err)
		}
	}
}

// flushPending 把指定 trackId 的 pending 时长写入 JSON 文件
func flushPending(trackId int64) {
	listenTracker.mu.Lock()
	secs := listenTracker.pending[trackId]
	if secs <= 0 {
		listenTracker.mu.Unlock()
		return
	}
	delete(listenTracker.pending, trackId)
	listenTracker.mu.Unlock()

	go addListenTimeToFile(trackId, secs)
}

// StartListenTimeHeartbeat 启动定期 heartbeat，提交 pending 中的累积时长
func StartListenTimeHeartbeat() {
	go func() {
		ticker := time.NewTicker(heartbeatInterval)
		defer ticker.Stop()
		for range ticker.C {
			listenTracker.mu.Lock()
			ids := make([]int64, 0, len(listenTracker.pending))
			for id := range listenTracker.pending {
				ids = append(ids, id)
			}
			listenTracker.mu.Unlock()

			for _, id := range ids {
				flushPending(id)
			}
		}
	}()
}

// GetListenTime 获取某首歌的累计听歌时长（秒）
func (a *MusicService) GetListenTime(trackId int64) int64 {
	if trackId <= 0 {
		return 0
	}
	statsWriteMu.Lock()
	defer statsWriteMu.Unlock()
	s, err := loadStatsFromFile()
	if err != nil {
		return 0
	}
	val, ok := s.Tracks[trackRegistryName(trackId)]
	if !ok {
		return 0
	}
	return int64(val)
}

// GetTotalListenTime 获取所有歌曲的总听歌时长（秒）
func (a *MusicService) GetTotalListenTime() int64 {
	statsWriteMu.Lock()
	defer statsWriteMu.Unlock()
	s, err := loadStatsFromFile()
	if err != nil {
		return 0
	}
	var total uint64
	for _, val := range s.Tracks {
		total += val
	}
	return int64(total)
}

// addListenTimeToFile 把 elapsed 秒累加到 JSON 文件中对应 trackId 的值
func addListenTimeToFile(trackId int64, elapsed int64) {
	statsWriteMu.Lock()
	defer statsWriteMu.Unlock()

	s, err := loadStatsFromFile()
	if err != nil {
		log.Printf("[ListenTime] loadStatsFromFile failed: %v", err)
		return
	}
	name := trackRegistryName(trackId)
	existing := s.Tracks[name]
	newVal := existing + uint64(elapsed)
	s.Tracks[name] = newVal

	if err := saveStatsToFile(s); err != nil {
		log.Printf("[ListenTime] saveStatsToFile failed: %v", err)
		return
	}
	log.Printf("[ListenTime] trackId=%d: %d + %d = %d", trackId, existing, elapsed, newVal)
}

// trackRegistryName 生成 JSON 文件中的键名（沿用旧版 track_<id> 命名，保持语义）
func trackRegistryName(trackId int64) string {
	return "track_" + strconv.FormatInt(trackId, 10)
}
