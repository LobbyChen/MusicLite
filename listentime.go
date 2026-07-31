package main

// ============ 听歌时长统计（精度优化版） ============
//
// 使用 Windows 注册表存储每首歌的累计听歌时长（秒）。
// 路径：SOFTWARE\MusicLite\Stats
// 值名：track_<id>，类型：REG_QWORD（uint64，秒数）
//
// 精度优化（解决"听了10秒时间长了1分钟"的问题）：
//   - 使用 math.Round 四舍五入（替代旧的 math.Ceil 向上取整）
//   - pending 累积机制：频繁暂停时先在内存中累积，避免细碎写入膨胀
//   - 500ms 阈值：短于 500ms 的播放不立即写入注册表
//   - 15 秒 heartbeat：定期提交 pending 中的累积时长
//
// 前端在 audio 的 play/pause 事件中调用后端方法：
//   - RecordPlayStart(trackId)：记录开始播放时间（内存）
//   - RecordPlayPause(trackId)：计算本次播放时长，累积到 pending
//
// App 关闭时通过 FlushListenTime() 把未写入的时长持久化。

import (
	"log"
	"math"
	"strconv"
	"sync"
	"time"

	"golang.org/x/sys/windows/registry"
)

// pendingThresholdMs 短于此阈值的播放不立即写入注册表，先累积到 pending
const pendingThresholdMs = 500

// heartbeatInterval heartbeat 定期提交 pending 的间隔
const heartbeatInterval = 15 * time.Second

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

// registryWriteMu 保护注册表并发写入
var registryWriteMu sync.Mutex

// statsRegistryPath 注册表中统计数据的路径
const statsRegistryPath = `SOFTWARE\MusicLite\Stats`

// RecordPlayStart 记录某首歌开始播放的时间（内存中）
func (a *App) RecordPlayStart(trackId int64) {
	if trackId <= 0 {
		return
	}
	listenTracker.mu.Lock()
	defer listenTracker.mu.Unlock()
	listenTracker.startTime[trackId] = time.Now()
	log.Printf("[ListenTime] Start: trackId=%d", trackId)
}

// RecordPlayPause 计算本次播放时长并累积到 pending
// 使用四舍五入（math.Round），短于 500ms 的播放累积到 pending 不立即写入
func (a *App) RecordPlayPause(trackId int64) {
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
	// 四舍五入到秒（不再向上取整，避免膨胀）
	elapsed := int64(math.Round(float64(elapsedMs) / 1000.0))
	if elapsed < 0 {
		elapsed = 0
	}

	listenTracker.mu.Lock()
	listenTracker.pending[trackId] += elapsed
	accumulated := listenTracker.pending[trackId]
	listenTracker.mu.Unlock()

	log.Printf("[ListenTime] Pause: trackId=%d elapsed=%ds (pending=%ds)", trackId, elapsed, accumulated)

	// pending 超过阈值或达到一定量时写入注册表
	if accumulated > 0 && elapsedMs >= int64(pendingThresholdMs) {
		flushPending(trackId)
	}
}

// FlushListenTime 在 App 关闭时把所有未写入的播放时长持久化到注册表
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

	// 把所有 pending 写入注册表
	for trackId, secs := range listenTracker.pending {
		if secs > 0 {
			log.Printf("[ListenTime] Flush: trackId=%d secs=%ds", trackId, secs)
			addListenTimeToRegistry(trackId, secs)
		}
		delete(listenTracker.pending, trackId)
	}
}

// flushPending 把指定 trackId 的 pending 时长写入注册表
func flushPending(trackId int64) {
	listenTracker.mu.Lock()
	secs := listenTracker.pending[trackId]
	if secs <= 0 {
		listenTracker.mu.Unlock()
		return
	}
	delete(listenTracker.pending, trackId)
	listenTracker.mu.Unlock()

	go addListenTimeToRegistry(trackId, secs)
}

// StartListenTimeHeartbeat 启动定期 heartbeat，提交 pending 中的累积时长
// 应在 App.startup 中调用
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
func (a *App) GetListenTime(trackId int64) int64 {
	if trackId <= 0 {
		return 0
	}
	k, err := registry.OpenKey(registry.CURRENT_USER, statsRegistryPath, registry.QUERY_VALUE|registry.READ)
	if err != nil {
		return 0
	}
	defer k.Close()
	val, _, err := k.GetIntegerValue(trackRegistryName(trackId))
	if err != nil {
		return 0
	}
	return int64(val)
}

// GetTotalListenTime 获取所有歌曲的总听歌时长（秒）
func (a *App) GetTotalListenTime() int64 {
	k, err := registry.OpenKey(registry.CURRENT_USER, statsRegistryPath, registry.QUERY_VALUE|registry.READ)
	if err != nil {
		return 0
	}
	defer k.Close()
	names, err := k.ReadValueNames(-1)
	if err != nil {
		return 0
	}
	var total uint64
	for _, name := range names {
		val, _, err := k.GetIntegerValue(name)
		if err == nil {
			total += val
		}
	}
	return int64(total)
}

// addListenTimeToRegistry 把 elapsed 秒累加到注册表中对应 trackId 的值
func addListenTimeToRegistry(trackId int64, elapsed int64) {
	registryWriteMu.Lock()
	defer registryWriteMu.Unlock()

	k, _, err := registry.CreateKey(registry.CURRENT_USER, statsRegistryPath, registry.ALL_ACCESS)
	if err != nil {
		log.Printf("[ListenTime] registry create key failed: %v", err)
		return
	}
	defer k.Close()

	name := trackRegistryName(trackId)
	existing, _, err := k.GetIntegerValue(name)
	if err != nil {
		existing = 0
	}
	newVal := existing + uint64(elapsed)
	if err := k.SetQWordValue(name, newVal); err != nil {
		log.Printf("[ListenTime] registry set value failed: %v", err)
		return
	}
	log.Printf("[ListenTime] trackId=%d: %d + %d = %d", trackId, existing, elapsed, newVal)
}

// trackRegistryName 生成注册表中的值名
func trackRegistryName(trackId int64) string {
	return "track_" + strconv.FormatInt(trackId, 10)
}
