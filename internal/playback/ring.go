package playback

import "sync"

// streamRing 是有界字节环形缓冲。
//
// 生产者（解码 goroutine）写入；消费者（oto 音频回调）非阻塞读取。
// reset 会递增 generation，让仍在阻塞写入的旧生产者立即退出。
type streamRing struct {
	mu      sync.Mutex
	cond    *sync.Cond
	buf     []byte
	readAt  int
	writeAt int
	size    int
	gen     uint64
	eof     bool
	closed  bool
}

func newStreamRing(capacity int) *streamRing {
	if capacity < 64*1024 {
		capacity = 64 * 1024
	}
	r := &streamRing{buf: make([]byte, capacity)}
	r.cond = sync.NewCond(&r.mu)
	return r
}

// reset 清空缓冲并返回新的 generation。
func (r *streamRing) reset() uint64 {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.gen++
	r.readAt = 0
	r.writeAt = 0
	r.size = 0
	r.eof = false
	r.cond.Broadcast()
	return r.gen
}

// write 写入 p；缓冲满时阻塞。generation 不匹配或 ring 已关闭时返回 false。
func (r *streamRing) write(p []byte, gen uint64) bool {
	for len(p) > 0 {
		r.mu.Lock()
		for r.size == len(r.buf) && r.gen == gen && !r.closed {
			r.cond.Wait()
		}
		if r.closed || r.gen != gen {
			r.mu.Unlock()
			return false
		}

		space := len(r.buf) - r.writeAt
		free := len(r.buf) - r.size
		if space > free {
			space = free
		}
		n := len(p)
		if n > space {
			n = space
		}
		copy(r.buf[r.writeAt:r.writeAt+n], p[:n])
		r.writeAt = (r.writeAt + n) % len(r.buf)
		r.size += n
		p = p[n:]
		r.mu.Unlock()
	}
	return true
}

// read 非阻塞读取最多 len(p) 字节，返回实际读取量。
func (r *streamRing) read(p []byte) int {
	r.mu.Lock()
	defer r.mu.Unlock()
	n := len(p)
	if n > r.size {
		n = r.size
	}
	if n == 0 {
		return 0
	}
	first := len(r.buf) - r.readAt
	if first > n {
		first = n
	}
	copy(p, r.buf[r.readAt:r.readAt+first])
	if n > first {
		copy(p[first:n], r.buf[:n-first])
	}
	r.readAt = (r.readAt + n) % len(r.buf)
	r.size -= n
	r.cond.Broadcast()
	return n
}

func (r *streamRing) setEOF(gen uint64) bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.closed || r.gen != gen {
		return false
	}
	r.eof = true
	return true
}

func (r *streamRing) isEOF() bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.eof
}

func (r *streamRing) close() {
	r.mu.Lock()
	r.closed = true
	r.cond.Broadcast()
	r.mu.Unlock()
}
