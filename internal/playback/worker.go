package playback

import (
	"io"
	"sync"
)

const (
	decoderChunkSize = 64 * 1024
	streamRingSize   = 2 * 1024 * 1024
)

type seekCommand struct {
	seconds float64
	gen     uint64
}

// decodeWorker owns the decoder goroutine. All decoder calls happen on this goroutine.
type decodeWorker struct {
	dec  *Decoder
	ring *streamRing
	gen  uint64

	seekMu      sync.Mutex
	pendingSeek *seekCommand
	seekNotify  chan struct{}
	stopCh      chan struct{}
	doneCh      chan struct{}
	stopOnce    sync.Once
}

func newDecodeWorker(dec *Decoder, ring *streamRing) *decodeWorker {
	return &decodeWorker{
		dec:        dec,
		ring:       ring,
		gen:        ring.reset(),
		seekNotify: make(chan struct{}, 1),
		stopCh:     make(chan struct{}),
		doneCh:     make(chan struct{}),
	}
}

func (w *decodeWorker) start() {
	go w.run()
}

func (w *decodeWorker) requestSeek(seconds float64, gen uint64) {
	w.seekMu.Lock()
	w.pendingSeek = &seekCommand{seconds: seconds, gen: gen}
	w.seekMu.Unlock()
	select {
	case w.seekNotify <- struct{}{}:
	default:
	}
}

func (w *decodeWorker) takeSeek() *seekCommand {
	w.seekMu.Lock()
	defer w.seekMu.Unlock()
	cmd := w.pendingSeek
	w.pendingSeek = nil
	return cmd
}

func (w *decodeWorker) stop() {
	w.stopOnce.Do(func() { close(w.stopCh) })
	<-w.doneCh
}

func (w *decodeWorker) run() {
	defer close(w.doneCh)
	buf := make([]byte, decoderChunkSize)

outer:
	for {
		select {
		case <-w.stopCh:
			return
		case <-w.seekNotify:
			if cmd := w.takeSeek(); cmd != nil {
				w.gen = cmd.gen
				_ = w.dec.Seek(cmd.seconds)
			}
		default:
		}

		n, err := w.dec.Read(buf)
		if n > 0 {
			if !w.ring.write(buf[:n], w.gen) {
				continue
			}
		}
		if err == io.EOF {
			w.ring.setEOF(w.gen)
			for {
				select {
				case <-w.stopCh:
					return
				case <-w.seekNotify:
					if cmd := w.takeSeek(); cmd != nil {
						w.gen = cmd.gen
						if w.dec.Seek(cmd.seconds) == nil {
							continue outer
						}
					}
				}
			}
		}
		if err != nil {
			w.ring.setEOF(w.gen)
			for {
				select {
				case <-w.stopCh:
					return
				case <-w.seekNotify:
					if cmd := w.takeSeek(); cmd != nil {
						w.gen = cmd.gen
						if w.dec.Seek(cmd.seconds) == nil {
							continue outer
						}
					}
				}
			}
		}
	}
}
