package playback

import (
	"bytes"
	"testing"
	"time"
)

func TestStreamRingRoundTrip(t *testing.T) {
	r := newStreamRing(64 * 1024)
	gen := r.reset()

	data := bytes.Repeat([]byte{1, 2, 3, 4}, 4096)
	if !r.write(data, gen) {
		t.Fatal("write failed")
	}

	out := make([]byte, len(data))
	if n := r.read(out); n != len(data) {
		t.Fatalf("read %d, want %d", n, len(data))
	}
	if !bytes.Equal(out, data) {
		t.Fatal("data mismatch")
	}
}

func TestStreamRingResetUnblocksWriter(t *testing.T) {
	r := newStreamRing(64 * 1024)
	gen := r.reset()

	done := make(chan bool, 1)
	go func() {
		// 大于缓冲容量，必然阻塞；reset 后应返回 false。
		done <- r.write(make([]byte, 128*1024), gen)
	}()

	time.Sleep(20 * time.Millisecond)
	r.reset()

	select {
	case ok := <-done:
		if ok {
			t.Fatal("stale writer should be rejected after reset")
		}
	case <-time.After(time.Second):
		t.Fatal("writer was not unblocked by reset")
	}
}
