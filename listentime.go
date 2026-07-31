package main

// ============ 听歌时长统计 ============
//
// 使用 Windows 注册表存储每首歌的累计听歌时长（秒）。
// 路径：SOFTWARE\MusicLite\Stats
// 值名：track_<id>，类型：REG_QWORD（uint64，秒数）
//
// 前端在 audio 的 play/pause 事件中调用后端方法：
//   - RecordPlayStart(trackId)：记录开始播放时间（内存）
//   - RecordPlayPause(trackId)：计算本次播放时长，开 goroutine 累加到注册表
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

// listenTimeTracker 听歌时长跟踪器
type listenTimeTracker struct {
	mu        sync.Mutex
	startTime map[int64]time.Time // trackId → 开始播放时间
}

var listenTracker = &listenTimeTracker{
	startTime: make(map[int64]time.Time),
}

// registryWriteMu 保护注册表并发写入（多个 goroutine 可能同时写不同 trackId）
var registryWriteMu sync.Mutex

// statsRegistryPath 注册表中统计数据的路径
const statsRegistryPath = `SOFTWARE\MusicLite\Stats`

// RecordPlayStart 记录某首歌开始播放的时间（内存中）
func (a *App) RecordPlayStart(trackId int64) {
	if trackId <= 0 {
		log.Printf("[ListenTime] RecordPlayStart: trackId <= 0, ignored")
		return
	}
	listenTracker.mu.Lock()
	defer listenTracker.mu.Unlock()
	listenTracker.startTime[trackId] = time.Now()
	log.Printf("[ListenTime] RecordPlayStart: trackId=%d", trackId)
}

// RecordPlayPause 计算本次播放时长并开 goroutine 累加到注册表
// 同时清除内存中的开始时间（暂停后不再累计，直到再次 RecordPlayStart）
// 使用向上取整：即使只听了 1 秒也会被记录
func (a *App) RecordPlayPause(trackId int64) {
	if trackId <= 0 {
		log.Printf("[ListenTime] RecordPlayPause: trackId <= 0, ignored")
		return
	}
	listenTracker.mu.Lock()
	start, ok := listenTracker.startTime[trackId]
	delete(listenTracker.startTime, trackId)
	listenTracker.mu.Unlock()

	if !ok {
		log.Printf("[ListenTime] RecordPlayPause: trackId=%d no start time found (already paused?)", trackId)
		return
	}
	// 向上取整，确保任何长度的播放都至少记录 1 秒
	elapsed := int64(math.Ceil(time.Since(start).Seconds()))
	if elapsed < 1 {
		elapsed = 1
	}
	log.Printf("[ListenTime] RecordPlayPause: trackId=%d elapsed=%ds", trackId, elapsed)
	// 开新 goroutine 写注册表，不阻塞前端
	go addListenTimeToRegistry(trackId, elapsed)
}

// FlushListenTime 在 App 关闭时把所有未写入的播放时长持久化到注册表
// 使用向上取整：即使只听了 1 秒也会被记录
func FlushListenTime() {
	listenTracker.mu.Lock()
	defer listenTracker.mu.Unlock()
	for trackId, start := range listenTracker.startTime {
		elapsed := int64(math.Ceil(time.Since(start).Seconds()))
		if elapsed < 1 {
			elapsed = 1
		}
		log.Printf("[ListenTime] Flush: trackId=%d elapsed=%ds", trackId, elapsed)
		addListenTimeToRegistry(trackId, elapsed)
		delete(listenTracker.startTime, trackId)
	}
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
		log.Printf("[ListenTime] GetTotalListenTime: open key failed: %v", err)
		return 0
	}
	defer k.Close()
	names, err := k.ReadValueNames(-1)
	if err != nil {
		log.Printf("[ListenTime] GetTotalListenTime: read value names failed: %v", err)
		return 0
	}
	var total uint64
	for _, name := range names {
		val, _, err := k.GetIntegerValue(name)
		if err == nil {
			total += val
		}
	}
	log.Printf("[ListenTime] GetTotalListenTime: %d tracks, total=%ds", len(names), total)
	return int64(total)
}

// addListenTimeToRegistry 把 elapsed 秒累加到注册表中对应 trackId 的值
func addListenTimeToRegistry(trackId int64, elapsed int64) {
	registryWriteMu.Lock()
	defer registryWriteMu.Unlock()

	k, _, err := registry.CreateKey(registry.CURRENT_USER, statsRegistryPath, registry.ALL_ACCESS)
	if err != nil {
		log.Printf("[ListenTime] addListenTimeToRegistry: create key failed: %v", err)
		return
	}
	defer k.Close()

	name := trackRegistryName(trackId)
	// 读取已有值
	existing, _, err := k.GetIntegerValue(name)
	if err != nil {
		existing = 0
	}
	// 累加后写回
	newVal := existing + uint64(elapsed)
	if err := k.SetQWordValue(name, newVal); err != nil {
		log.Printf("[ListenTime] addListenTimeToRegistry: set value failed: %v", err)
		return
	}
	log.Printf("[ListenTime] addListenTimeToRegistry: trackId=%d, %d + %d = %d", trackId, existing, elapsed, newVal)
}

// trackRegistryName 生成注册表中的值名
func trackRegistryName(trackId int64) string {
	return "track_" + strconv.FormatInt(trackId, 10)
}
