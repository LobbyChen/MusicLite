package main

// ============ 线程安全播放队列 ============
//
// 设计目标：
//   1. 用户可手动加入曲目到队列（右键菜单 / "加入队列"按钮 / "播放全部"填充）
//   2. 队列为空时，播放结束后的进曲逻辑回退到原有"音乐库顺序/随机"
//   3. 队列非空时，播放结束后优先取队列下一首
//   4. 支持拖拽排序、删除单条、清空、洗牌、跳转到指定项
//   5. 洗牌（Fisher-Yates）保留当前播放项的位置，避免切歌
//
// 线程模型：
//   - 前端 Wails 方法 goroutine 与 Player 的 handleEnded goroutine 都会访问队列
//   - 所有方法通过 mu 串行化，操作原子

import (
	"math/rand"
	"strconv"
	"sync"

	"MusicLite/internal/format"
	"MusicLite/internal/storage"
)

// QueueItem 队列项：曲目完整数据 + 原始位置（用于拖拽 UI）
type QueueItem struct {
	Track  format.MscData `json:"track"`
	Source int            `json:"source"` // 入队时的原始下标（UI 排序辅助，可选）
}

// QueueStatus 暴露给前端的队列快照
type QueueStatus struct {
	Items        []QueueItem `json:"items"`
	CurrentIndex int         `json:"currentIndex"` // 当前播放项在队列中的下标，-1 表示不在队列中
	Count        int         `json:"count"`
}

// PlayQueue 线程安全播放队列
type PlayQueue struct {
	mu      sync.Mutex
	items   []QueueItem
	current int // 当前播放项下标，-1 表示当前曲目不在队列中
	db      *storage.Database
	app     *App // 用于构造 mediaBaseURL
}

// NewPlayQueue 创建播放队列
func NewPlayQueue(db *storage.Database, app *App) *PlayQueue {
	return &PlayQueue{
		items:   make([]QueueItem, 0),
		current: -1,
		db:      db,
		app:     app,
	}
}

// trackFromRecord 把数据库记录转为前端可用的 MscData（含 audio/cover URL）
func (q *PlayQueue) trackFromRecord(r *storage.TrackRecord) format.MscData {
	base := ""
	if q.app != nil {
		base = q.app.mediaBaseURL()
	}
	if r == nil {
		return format.MscData{}
	}
	idStr := strconv.FormatInt(r.ID, 10)
	track := format.MscData{
		ID:         r.ID,
		Name:       r.Title,
		Author:     r.Artist,
		Format:     format.NormalMscFormat(r.Format),
		AudioURI:   base + "/audio/" + idStr,
		Lyrics:     r.Lyrics,
		ImportedAt: r.ImportedAt,
	}
	if r.CoverMIME != "" {
		track.CoverURI = base + "/cover/" + idStr
	}
	return track
}

// AddTrack 按曲目 ID 加入队列尾部
func (q *PlayQueue) AddTrack(id int64) (QueueItem, bool) {
	rec, err := q.db.GetTrackByID(id)
	if err != nil {
		return QueueItem{}, false
	}
	item := QueueItem{Track: q.trackFromRecord(rec), Source: len(q.items)}
	q.mu.Lock()
	q.items = append(q.items, item)
	q.mu.Unlock()
	return item, true
}

// AddAll 批量加入队列（返回成功加入数量）
func (q *PlayQueue) AddAll(ids []int64) int {
	added := 0
	q.mu.Lock()
	defer q.mu.Unlock()
	for _, id := range ids {
		rec, err := q.db.GetTrackByID(id)
		if err != nil {
			continue
		}
		item := QueueItem{Track: q.trackFromRecord(rec), Source: len(q.items)}
		q.items = append(q.items, item)
		added++
	}
	return added
}

// AddAllFromLibrary 把整个音乐库加入队列（"播放全部"用）
func (q *PlayQueue) AddAllFromLibrary() int {
	records, err := q.db.GetAllTrackRecords()
	if err != nil {
		return 0
	}
	q.mu.Lock()
	defer q.mu.Unlock()
	for i := range records {
		item := QueueItem{Track: q.trackFromRecord(&records[i]), Source: len(q.items)}
		q.items = append(q.items, item)
	}
	return len(q.items)
}

// RemoveAt 删除指定下标的队列项
func (q *PlayQueue) RemoveAt(index int) bool {
	q.mu.Lock()
	defer q.mu.Unlock()
	if index < 0 || index >= len(q.items) {
		return false
	}
	q.items = append(q.items[:index], q.items[index+1:]...)
	// 调整 current 指针
	switch {
	case index < q.current:
		q.current--
	case index == q.current:
		// 当前项被删除，current 指向被删后的同位置（即下一项）
		// 若已是末尾，回退一位
		if q.current >= len(q.items) {
			q.current = len(q.items) - 1
		}
	}
	return true
}

// Clear 清空队列
func (q *PlayQueue) Clear() {
	q.mu.Lock()
	q.items = q.items[:0]
	q.current = -1
	q.mu.Unlock()
}

// Shuffle Fisher-Yates 洗牌，保留当前播放项位置不变
func (q *PlayQueue) Shuffle() {
	q.mu.Lock()
	defer q.mu.Unlock()
	if len(q.items) <= 1 {
		return
	}
	if len(q.items) == 2 {
		// 直接互换队列
		t := q.items[1]
		q.items[1] = q.items[0]
		q.items[0] = t
		return
	}
	cur := q.current
	var curItem QueueItem
	hasCur := cur >= 0 && cur < len(q.items)
	if hasCur {
		curItem = q.items[cur]
		// 把当前项先移到末尾再洗其余
		q.items = append(q.items[:cur], q.items[cur+1:]...)
	}
	// Fisher-Yates 洗前 n-1 项
	n := len(q.items)
	for i := n - 1; i > 0; i-- {
		j := rand.Intn(i + 1)
		q.items[i], q.items[j] = q.items[j], q.items[i]
	}
	// 当前项放回首位置
	if hasCur {
		// 重新插入到原 current 下标
		insertAt := cur
		if insertAt > len(q.items) {
			insertAt = len(q.items)
		}
		q.items = append(q.items[:insertAt], append([]QueueItem{curItem}, q.items[insertAt:]...)...)
		q.current = insertAt
	}
}

// Move 拖拽排序：把 from 项移动到 to 位置（to 是移除 from 之后的插入目标，0<=to<=len-1）
func (q *PlayQueue) Move(from, to int) bool {
	q.mu.Lock()
	defer q.mu.Unlock()
	n := len(q.items)
	if from < 0 || from >= n || to < 0 || to >= n || from == to {
		return false
	}
	// 记录当前播放曲目的稳定标识，移动完后用 ID 重新定位 current
	var curID int64
	if q.current >= 0 && q.current < n {
		curID = q.items[q.current].Track.ID
	}
	item := q.items[from]
	// 移除 from
	out := append(q.items[:from], q.items[from+1:]...)
	// 插入到 to（to 是移除后的下标）
	q.items = append(out[:to], append([]QueueItem{item}, out[to:]...)...)
	// 用 ID 重定位 current
	if curID > 0 {
		q.current = -1
		for i, it := range q.items {
			if it.Track.ID == curID {
				q.current = i
				break
			}
		}
	}
	return true
}

// JumpTo 跳转到指定下标，返回该项（用于双击队列项播放）
func (q *PlayQueue) JumpTo(index int) (QueueItem, bool) {
	q.mu.Lock()
	defer q.mu.Unlock()
	if index < 0 || index >= len(q.items) {
		return QueueItem{}, false
	}
	q.current = index
	return q.items[index], true
}

// SetCurrent 设置当前播放项（按曲目 ID 匹配）
func (q *PlayQueue) SetCurrent(trackID int64) {
	q.mu.Lock()
	defer q.mu.Unlock()
	if trackID <= 0 {
		q.current = -1
		return
	}
	for i, it := range q.items {
		if it.Track.ID == trackID {
			q.current = i
			return
		}
	}
	// 当前曲目不在队列中
	q.current = -1
}

// EnsureCurrent 确保当前播放的曲目在队列中（不在则加入尾部），并设为当前项。
// 用于"播放器开始播放时自动入队"：无论用户从哪里触发播放，队列始终包含当前曲目。
func (q *PlayQueue) EnsureCurrent(trackID int64) {
	if trackID <= 0 {
		return
	}
	// 先检查是否已在队列中（快速路径，持锁）
	q.mu.Lock()
	found := false
	for i, it := range q.items {
		if it.Track.ID == trackID {
			q.current = i
			found = true
			break
		}
	}
	q.mu.Unlock()
	if found {
		return
	}
	// 不在队列中 → 查库加入尾部（慢路径，不持锁查库）
	rec, err := q.db.GetTrackByID(trackID)
	if err != nil {
		return
	}
	q.mu.Lock()
	// 二次检查：并发场景下可能已被其他 goroutine 加入
	for i, it := range q.items {
		if it.Track.ID == trackID {
			q.current = i
			q.mu.Unlock()
			return
		}
	}
	item := QueueItem{Track: q.trackFromRecord(rec), Source: len(q.items)}
	q.items = append(q.items, item)
	q.current = len(q.items) - 1
	q.mu.Unlock()
}

// GetCurrent 返回当前播放项（不在队列中返回 false）
func (q *PlayQueue) GetCurrent() (QueueItem, bool) {
	q.mu.Lock()
	defer q.mu.Unlock()
	if q.current < 0 || q.current >= len(q.items) {
		return QueueItem{}, false
	}
	return q.items[q.current], true
}

// GetNext 返回下一项（不前进指针；用于自然结束时的进曲决策）
// loop=true 时队列循环
func (q *PlayQueue) GetNext(loop bool) (QueueItem, bool) {
	q.mu.Lock()
	defer q.mu.Unlock()
	if len(q.items) == 0 {
		return QueueItem{}, false
	}
	next := q.current + 1
	if next >= len(q.items) {
		if !loop {
			return QueueItem{}, false
		}
		next = 0
	}
	if next < 0 {
		next = 0
	}
	return q.items[next], true
}

// AdvanceNext 前进到下一项并返回（用于 handleEnded 顺序推进）
func (q *PlayQueue) AdvanceNext(loop bool) (QueueItem, bool) {
	q.mu.Lock()
	defer q.mu.Unlock()
	if len(q.items) == 0 {
		return QueueItem{}, false
	}
	next := q.current + 1
	if next >= len(q.items) {
		if !loop {
			return QueueItem{}, false
		}
		next = 0
	}
	q.current = next
	return q.items[next], true
}

// AdvanceRandom 随机前进到下一项并返回（用于 random 模式下的队列推进）
func (q *PlayQueue) AdvanceRandom(loop bool) (QueueItem, bool) {
	q.mu.Lock()
	defer q.mu.Unlock()
	if len(q.items) == 0 {
		return QueueItem{}, false
	}
	if len(q.items) == 1 {
		// 队列只有当前一首，直接拿出来送给他
		return q.items[q.current], false
	}
	// 随机选一个不等于 current 的下标
	cur := q.current
	if cur < 0 {
		cur = 0
	}
	var next int
	for {
		next = random(0, len(q.items))
		if next == cur {
			continue
		} else {
			break
		}
	}
	q.current = next
	return q.items[next], true
}

// GetPrev 返回上一项
func (q *PlayQueue) GetPrev(loop bool) (QueueItem, bool) {
	q.mu.Lock()
	defer q.mu.Unlock()
	if len(q.items) == 0 {
		return QueueItem{}, false
	}
	prev := q.current - 1
	if prev < 0 {
		if !loop {
			return QueueItem{}, false
		}
		prev = len(q.items) - 1
	}
	return q.items[prev], true
}

// Status 返回队列快照
func (q *PlayQueue) Status() QueueStatus {
	q.mu.Lock()
	defer q.mu.Unlock()
	items := make([]QueueItem, len(q.items))
	copy(items, q.items)
	return QueueStatus{
		Items:        items,
		CurrentIndex: q.current,
		Count:        len(items),
	}
}

// IsEmpty 队列是否为空
func (q *PlayQueue) IsEmpty() bool {
	q.mu.Lock()
	defer q.mu.Unlock()
	return len(q.items) == 0
}

// Len 返回队列长度
func (q *PlayQueue) Len() int {
	q.mu.Lock()
	defer q.mu.Unlock()
	return len(q.items)
}
