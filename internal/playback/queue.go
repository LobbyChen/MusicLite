package playback

import (
	"math/rand"
	"strconv"
	"sync"

	"MusicLite/internal/metadata"
	"MusicLite/internal/storage"
)

// URLProvider 提供媒体 URL 前缀（开发模式下由 app 注入本地 HTTP 地址）。
type URLProvider interface {
	MediaBaseURL() string
}

// QueueItem 队列项：曲目完整数据 + 原始位置。
type QueueItem struct {
	Track  metadata.MscData `json:"track"`
	Source int              `json:"source"`
}

// QueueStatus 暴露给前端的队列快照。
type QueueStatus struct {
	Items        []QueueItem `json:"items"`
	CurrentIndex int         `json:"currentIndex"`
	Count        int         `json:"count"`
}

// Queue 是线程安全播放队列。
type Queue struct {
	mu      sync.Mutex
	items   []QueueItem
	current int
	db      *storage.Database
	urls    URLProvider
}

func NewQueue(db *storage.Database, urls URLProvider) *Queue {
	return &Queue{
		items:   make([]QueueItem, 0),
		current: -1,
		db:      db,
		urls:    urls,
	}
}

func (q *Queue) trackFromRecord(r *storage.TrackRecord) metadata.MscData {
	if r == nil {
		return metadata.MscData{}
	}
	base := ""
	if q.urls != nil {
		base = q.urls.MediaBaseURL()
	}
	id := strconv.FormatInt(r.ID, 10)
	track := metadata.MscData{
		ID:         r.ID,
		Name:       r.Title,
		Author:     r.Artist,
		Album:      r.Album,
		Format:     metadata.NormalMscFormat(r.Format),
		AudioURI:   base + "/audio/" + id,
		Lyrics:     r.Lyrics,
		ImportedAt: r.ImportedAt,
	}
	if r.CoverMIME != "" {
		track.CoverURI = base + "/cover/" + id
	}
	return track
}

func (q *Queue) AddTrack(id int64) (QueueItem, bool) {
	rec, err := q.db.GetTrackByID(id)
	if err != nil {
		return QueueItem{}, false
	}
	q.mu.Lock()
	item := QueueItem{Track: q.trackFromRecord(rec), Source: len(q.items)}
	q.items = append(q.items, item)
	q.mu.Unlock()
	return item, true
}

func (q *Queue) AddAll(ids []int64) int {
	added := 0
	q.mu.Lock()
	defer q.mu.Unlock()
	for _, id := range ids {
		rec, err := q.db.GetTrackByID(id)
		if err != nil {
			continue
		}
		q.items = append(q.items, QueueItem{Track: q.trackFromRecord(rec), Source: len(q.items)})
		added++
	}
	return added
}

func (q *Queue) AddAllFromLibrary() int {
	records, err := q.db.GetAllTrackRecords()
	if err != nil {
		return 0
	}
	q.mu.Lock()
	defer q.mu.Unlock()
	for i := range records {
		q.items = append(q.items, QueueItem{Track: q.trackFromRecord(&records[i]), Source: len(q.items)})
	}
	return len(q.items)
}

func (q *Queue) RemoveAt(index int) bool {
	q.mu.Lock()
	defer q.mu.Unlock()
	if index < 0 || index >= len(q.items) {
		return false
	}
	q.items = append(q.items[:index], q.items[index+1:]...)
	switch {
	case index < q.current:
		q.current--
	case index == q.current:
		if q.current >= len(q.items) {
			q.current = len(q.items) - 1
		}
	}
	return true
}

func (q *Queue) Clear() {
	q.mu.Lock()
	q.items = q.items[:0]
	q.current = -1
	q.mu.Unlock()
}

func (q *Queue) Shuffle() {
	q.mu.Lock()
	defer q.mu.Unlock()
	if len(q.items) <= 1 {
		return
	}
	if len(q.items) == 2 {
		q.items[0], q.items[1] = q.items[1], q.items[0]
		return
	}
	cur := q.current
	var curItem QueueItem
	hasCur := cur >= 0 && cur < len(q.items)
	if hasCur {
		curItem = q.items[cur]
		q.items = append(q.items[:cur], q.items[cur+1:]...)
	}
	n := len(q.items)
	for i := n - 1; i > 0; i-- {
		j := rand.Intn(i + 1)
		q.items[i], q.items[j] = q.items[j], q.items[i]
	}
	if hasCur {
		insertAt := cur
		if insertAt > len(q.items) {
			insertAt = len(q.items)
		}
		q.items = append(q.items[:insertAt], append([]QueueItem{curItem}, q.items[insertAt:]...)...)
		q.current = insertAt
	}
}

func (q *Queue) Move(from, to int) bool {
	q.mu.Lock()
	defer q.mu.Unlock()
	n := len(q.items)
	if from < 0 || from >= n || to < 0 || to >= n || from == to {
		return false
	}
	var curID int64
	if q.current >= 0 && q.current < n {
		curID = q.items[q.current].Track.ID
	}
	item := q.items[from]
	out := append(q.items[:from], q.items[from+1:]...)
	q.items = append(out[:to], append([]QueueItem{item}, out[to:]...)...)
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

func (q *Queue) JumpTo(index int) (QueueItem, bool) {
	q.mu.Lock()
	defer q.mu.Unlock()
	if index < 0 || index >= len(q.items) {
		return QueueItem{}, false
	}
	q.current = index
	return q.items[index], true
}

func (q *Queue) SetCurrent(trackID int64) {
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
	q.current = -1
}

// EnsureCurrent 确保当前曲目在队列中，并设为当前项。
func (q *Queue) EnsureCurrent(trackID int64) {
	if trackID <= 0 {
		return
	}
	q.mu.Lock()
	for i, it := range q.items {
		if it.Track.ID == trackID {
			q.current = i
			q.mu.Unlock()
			return
		}
	}
	q.mu.Unlock()

	rec, err := q.db.GetTrackByID(trackID)
	if err != nil {
		return
	}
	q.mu.Lock()
	for i, it := range q.items {
		if it.Track.ID == trackID {
			q.current = i
			q.mu.Unlock()
			return
		}
	}
	q.items = append(q.items, QueueItem{Track: q.trackFromRecord(rec), Source: len(q.items)})
	q.current = len(q.items) - 1
	q.mu.Unlock()
}

func (q *Queue) GetCurrent() (QueueItem, bool) {
	q.mu.Lock()
	defer q.mu.Unlock()
	if q.current < 0 || q.current >= len(q.items) {
		return QueueItem{}, false
	}
	return q.items[q.current], true
}

func (q *Queue) GetNext(loop bool) (QueueItem, bool) {
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

func (q *Queue) AdvanceNext(loop bool) (QueueItem, bool) {
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

func (q *Queue) AdvanceRandom(loop bool) (QueueItem, bool) {
	q.mu.Lock()
	defer q.mu.Unlock()
	if len(q.items) == 0 {
		return QueueItem{}, false
	}
	if len(q.items) == 1 {
		return q.items[q.current], false
	}
	cur := q.current
	if cur < 0 {
		cur = 0
	}
	var next int
	for {
		next = rand.Intn(len(q.items))
		if next != cur {
			break
		}
	}
	q.current = next
	return q.items[next], true
}

func (q *Queue) GetPrev(loop bool) (QueueItem, bool) {
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

func (q *Queue) Status() QueueStatus {
	q.mu.Lock()
	defer q.mu.Unlock()
	items := make([]QueueItem, len(q.items))
	copy(items, q.items)
	return QueueStatus{Items: items, CurrentIndex: q.current, Count: len(items)}
}

func (q *Queue) IsEmpty() bool {
	q.mu.Lock()
	defer q.mu.Unlock()
	return len(q.items) == 0
}

func (q *Queue) Len() int {
	q.mu.Lock()
	defer q.mu.Unlock()
	return len(q.items)
}
