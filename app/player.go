package app

import (
	"fmt"
	"log"
	"math"
	"runtime"
	"strconv"
	"sync"
	"sync/atomic"
	"time"
	"unsafe"

	"MusicLite/internal/format"
	"MusicLite/internal/storage"

	"github.com/ebitengine/oto/v3"
)

/*
#include <libavformat/avformat.h>
#include <libavcodec/avcodec.h>
#include <libswresample/swresample.h>
#include <libavutil/opt.h>
#include <libavutil/channel_layout.h>
#include <stdlib.h>
#include <string.h>

typedef struct {
    uint8_t* data;
    size_t size;
    size_t capacity;
} PCMBuffer;

void append_pcm(PCMBuffer* buf, uint8_t* data, size_t len) {
    if (buf->size + len > buf->capacity) {
        buf->capacity = (buf->capacity == 0) ? 1024*1024 : buf->capacity * 2;
        while(buf->size + len > buf->capacity) buf->capacity *= 2;
        buf->data = realloc(buf->data, buf->capacity);
    }
    memcpy(buf->data + buf->size, data, len);
    buf->size += len;
}

// FFmpeg 核心解码函数：将整个文件解码为 44100Hz, Stereo, Float32 并存入 RAM
int ffmpeg_decode_to_ram(const char* path, void** out_buf, int* out_size) {
    AVFormatContext* fmt_ctx = NULL;
    AVCodecContext* dec_ctx = NULL;
    SwrContext* swr_ctx = NULL;
    AVPacket* pkt = NULL;
    AVFrame* frame = NULL;
    int audio_stream_idx = -1;
    int ret = -1;

    if (avformat_open_input(&fmt_ctx, path, NULL, NULL) < 0) goto cleanup;
    if (avformat_find_stream_info(fmt_ctx, NULL) < 0) goto cleanup;

    for (int i = 0; i < fmt_ctx->nb_streams; i++) {
        if (fmt_ctx->streams[i]->codecpar->codec_type == AVMEDIA_TYPE_AUDIO) {
            audio_stream_idx = i; break;
        }
    }
    if (audio_stream_idx < 0) goto cleanup;

    AVCodecParameters* codecpar = fmt_ctx->streams[audio_stream_idx]->codecpar;
    const AVCodec* codec = avcodec_find_decoder(codecpar->codec_id);
    if (!codec) goto cleanup;

    dec_ctx = avcodec_alloc_context3(codec);
    avcodec_parameters_to_context(dec_ctx, codecpar);
    if (avcodec_open2(dec_ctx, codec, NULL) < 0) goto cleanup;

    // 目标格式：44100Hz, 立体声, Float32 (Packed)
    #if LIBAVUTIL_VERSION_INT >= AV_VERSION_INT(57, 28, 100)
    AVChannelLayout out_layout = AV_CHANNEL_LAYOUT_STEREO;
    swr_alloc_set_opts2(&swr_ctx, &out_layout, AV_SAMPLE_FMT_FLT, 44100,
                        &dec_ctx->ch_layout, dec_ctx->sample_fmt, dec_ctx->sample_rate, 0, NULL);
    #else
    swr_ctx = swr_alloc_set_opts(NULL, AV_CH_LAYOUT_STEREO, AV_SAMPLE_FMT_FLT, 44100,
                                 dec_ctx->channel_layout, dec_ctx->sample_fmt, dec_ctx->sample_rate, 0, NULL);
    #endif
    if (!swr_ctx || swr_init(swr_ctx) < 0) goto cleanup;

    pkt = av_packet_alloc();
    frame = av_frame_alloc();
    PCMBuffer pcm = {0};

    uint8_t* out_buffer = NULL;
    int out_linesize = 0;
    int max_out_samples = 1024 * 16;
    av_samples_alloc(&out_buffer, &out_linesize, 2, max_out_samples, AV_SAMPLE_FMT_FLT, 0);

    while (av_read_frame(fmt_ctx, pkt) >= 0) {
        if (pkt->stream_index == audio_stream_idx) {
            if (avcodec_send_packet(dec_ctx, pkt) >= 0) {
                while (avcodec_receive_frame(dec_ctx, frame) >= 0) {
                    int out_samples = swr_get_out_samples(swr_ctx, frame->nb_samples);
                    if (out_samples > max_out_samples) {
                        av_freep(&out_buffer);
                        max_out_samples = out_samples * 2;
                        av_samples_alloc(&out_buffer, &out_linesize, 2, max_out_samples, AV_SAMPLE_FMT_FLT, 0);
                    }
                    int converted = swr_convert(swr_ctx, &out_buffer, max_out_samples,
                                                (const uint8_t **)frame->extended_data, frame->nb_samples);
                    if (converted > 0) append_pcm(&pcm, out_buffer, converted * 2 * sizeof(float));
                }
            }
        }
        av_packet_unref(pkt);
    }

    // Flush decoder
    avcodec_send_packet(dec_ctx, NULL);
    while (avcodec_receive_frame(dec_ctx, frame) >= 0) {
        int converted = swr_convert(swr_ctx, &out_buffer, max_out_samples, (const uint8_t **)frame->extended_data, frame->nb_samples);
        if (converted > 0) append_pcm(&pcm, out_buffer, converted * 2 * sizeof(float));
    }

    // Flush resampler
    while(1) {
        int converted = swr_convert(swr_ctx, &out_buffer, max_out_samples, NULL, 0);
        if (converted <= 0) break;
        append_pcm(&pcm, out_buffer, converted * 2 * sizeof(float));
    }

    *out_buf = pcm.data;
    *out_size = (int)pcm.size;
    ret = 0;

cleanup:
    if (out_buffer) av_freep(&out_buffer);
    if (frame) av_frame_free(&frame);
    if (pkt) av_packet_free(&pkt);
    if (swr_ctx) swr_free(&swr_ctx);
    if (dec_ctx) avcodec_free_context(&dec_ctx);
    if (fmt_ctx) avformat_close_input(&fmt_ctx);
    return ret;
}
*/
import "C"

const playerSampleRate = 44100
const playerTimeUpdateInterval = 250 * time.Millisecond
const bytesPerFrame = 8 // 4 bytes (Float32) * 2 channels (Stereo)

// seek 后用于冲刷 Oto / 驱动旧缓冲的静音长度。
// 160KB 约 0.36s。
// 如果快速拖动仍有一瞬间旧声残留，可以调大到 256 * 1024。
const seekFlushBytes = 160 * 1024

// pcmSnapshot 是不可变快照。
// 一旦发布到 Player.pcm，就不允许再修改。
// Read 音频线程只需要原子 Load 它即可。
type pcmSnapshot struct {
	data       []byte
	totalBytes int64
	cPtr       unsafe.Pointer
}

type PlayerState struct {
	Track     *format.MscData `json:"track"`
	IsPlaying bool            `json:"isPlaying"`
	Position  float64         `json:"position"`
	Duration  float64         `json:"duration"`
	Volume    int             `json:"volume"`
	PlayMode  string          `json:"playMode"`
}

type Player struct {
	mu       sync.Mutex
	db       *storage.Database
	app      *MusicService
	ready    bool
	closed   chan struct{}
	stopOnce sync.Once

	track *format.MscData

	// 无锁 PCM 访问核心：
	// 音频线程只 Load，不持锁。
	pcm    atomic.Pointer[pcmSnapshot]
	freeCh chan unsafe.Pointer

	readOffset atomic.Int64
	seekSeq    atomic.Uint64
	muteBytes  atomic.Int64

	isPlaying atomic.Bool
	isPaused  atomic.Bool
	volume    atomic.Int32

	playMode string
	queue    *PlayQueue

	otoCtx    *oto.Context
	otoPlayer *oto.Player

	endCh chan struct{}
}

// PCMReader 实现 io.Reader，供 oto 回调读取 RAM 中的数据。
// 这里必须尽可能无锁，否则会卡顿。
type PCMReader struct {
	p *Player
}

func (r *PCMReader) Read(buf []byte) (int, error) {
	if len(buf) == 0 {
		return 0, nil
	}

	// 暂停：立刻输出静音
	if r.p.isPaused.Load() {
		for i := range buf {
			buf[i] = 0
		}
		return len(buf), nil
	}

	// seek 后的静音冲刷阶段：
	// 只输出静音，不推进 readOffset，用来推掉 Oto / 驱动里的旧缓冲。
	if r.p.muteBytes.Load() > 0 {
		for i := range buf {
			buf[i] = 0
		}
		r.p.muteBytes.Add(-int64(len(buf)))
		return len(buf), nil
	}

	// 无锁读取当前 PCM 快照
	snap := r.p.pcm.Load()
	if snap == nil {
		for i := range buf {
			buf[i] = 0
		}

		if r.p.isPlaying.CompareAndSwap(true, false) {
			select {
			case r.p.endCh <- struct{}{}:
			default:
			}
		}

		return len(buf), nil
	}

	offset := r.p.readOffset.Load()

	// 播放结束检测
	if offset >= snap.totalBytes {
		for i := range buf {
			buf[i] = 0
		}

		if r.p.isPlaying.CompareAndSwap(true, false) {
			select {
			case r.p.endCh <- struct{}{}:
			default:
			}
		}

		return len(buf), nil
	}

	// 从 RAM 拷贝数据。
	// snap.data 指向的 C 内存在 freeLoop 延迟释放前不会被 free，
	// 因此这里无锁 copy 是安全的。
	n := copy(buf, snap.data[offset:])

	// 推进播放偏移量
	r.p.readOffset.Add(int64(n))

	// 如果不足一整块，尾部补静音
	if n < len(buf) {
		for i := n; i < len(buf); i++ {
			buf[i] = 0
		}
	}

	// 应用内音量控制
	gain := volumeToGain(int(r.p.volume.Load()))
	if gain < 0.99 && n >= 4 {
		f32Buf := unsafe.Slice((*float32)(unsafe.Pointer(&buf[0])), n/4)
		for i := range f32Buf {
			f32Buf[i] *= float32(gain)
		}
	}

	return n, nil
}

func NewPlayer(db *storage.Database, app *MusicService) *Player {
	p := &Player{
		db:       db,
		app:      app,
		playMode: "none",
		closed:   make(chan struct{}),
		endCh:    make(chan struct{}, 1),
		freeCh:   make(chan unsafe.Pointer, 16),
	}
	p.queue = NewPlayQueue(db, app)
	p.volume.Store(70)
	return p
}

func (p *Player) Queue() *PlayQueue     { return p.queue }
func (p *Player) Equalizer() *Equalizer { return nil }
func (p *Player) SmartEQ() *SmartEQ     { return nil }

func (p *Player) Start() {
	op := &oto.NewContextOptions{}
	op.SampleRate = playerSampleRate
	op.ChannelCount = 2
	op.Format = oto.FormatFloat32LE

	// 50ms 比 20ms 更稳。
	// 20ms 在部分 Windows WASAPI / CoreAudio 设备上容易造成 underrun / 卡顿。
	op.BufferSize = 50 * time.Millisecond

	ctx, ready, err := oto.NewContext(op)
	if err != nil {
		log.Printf("[Player] oto 初始化失败: %v", err)
		return
	}
	<-ready

	p.mu.Lock()
	p.otoCtx = ctx
	p.otoPlayer = ctx.NewPlayer(&PCMReader{p: p})
	p.ready = true
	p.mu.Unlock()

	go p.timeUpdateLoop()
	go p.eventLoop()
	go p.freeLoop()
}

func (p *Player) Stop() {
	p.stopOnce.Do(func() {
		p.isPlaying.Store(false)
		p.isPaused.Store(true)
		p.muteBytes.Store(0)

		p.closeOtoPlayer()
		p.freePCM()

		close(p.closed)
	})
}

func (p *Player) closeOtoPlayer() {
	p.mu.Lock()
	defer p.mu.Unlock()

	if p.otoPlayer != nil {
		p.otoPlayer.Close()
		p.otoPlayer = nil
	}
}

// freePCM 无锁释放当前 PCM。
// 它不会立刻 C.free，而是把旧指针丢到 freeCh，
// 由 freeLoop 延迟释放，避免音频线程还在 copy 旧数据。
func (p *Player) freePCM() {
	snap := p.pcm.Swap(nil)
	if snap == nil || snap.cPtr == nil {
		return
	}

	select {
	case p.freeCh <- snap.cPtr:
	default:
		// 通道满时直接释放。
		// 正常情况下不会发生，因为解码切歌频率远低于 freeLoop 消费速度。
		C.free(snap.cPtr)
	}
}

// freeLoop 负责延迟释放旧 C 内存。
// 这里 sleep 10ms 是安全窗口：
// Read 单次 copy 通常小于 1ms，10ms 足够让所有 in-flight Read 完成。
func (p *Player) freeLoop() {
	for {
		select {
		case <-p.closed:
			// 退出前排空残留指针
			for {
				select {
				case ptr := <-p.freeCh:
					if ptr != nil {
						C.free(ptr)
					}
				default:
					runtime.GC()
					return
				}
			}

		case ptr := <-p.freeCh:
			if ptr != nil {
				time.Sleep(10 * time.Millisecond)
				C.free(ptr)
			}
		}
	}
}

func (p *Player) eventLoop() {
	for {
		select {
		case <-p.closed:
			return
		case <-p.endCh:
			p.handleEnded()
		}
	}
}

// ============ 对前端暴露的 App 方法 ============

func (a *MusicService) PlayerLoad(track format.MscData) error { return a.player.loadTrack(track) }
func (a *MusicService) PlayerPlay()                           { a.player.resume() }
func (a *MusicService) PlayerPause()                          { a.player.pause() }
func (a *MusicService) PlayerToggle()                         { a.player.toggle() }
func (a *MusicService) PlayerSeek(seconds float64) error      { return a.player.seek(seconds) }
func (a *MusicService) PlayerStop()                           { a.player.stop() }
func (a *MusicService) PlayerGetState() PlayerState           { return a.player.snapshot() }
func (a *MusicService) PlayerTogglePlayMode() string          { return a.player.togglePlayMode() }
func (a *MusicService) PlayerGetPlayMode() string {
	a.player.mu.Lock()
	defer a.player.mu.Unlock()
	return a.player.playMode
}
func (a *MusicService) PlayerRestart() error { return a.player.restart() }

// 均衡器方法 Stub
func (a *MusicService) PlayerGetEqBandCount() int                 { return 0 }
func (a *MusicService) PlayerGetEqFreqs() []float64               { return []float64{} }
func (a *MusicService) PlayerSetEqBand(index int, gainDB float64) {}
func (a *MusicService) PlayerSetEqGains(gains []float64)          {}
func (a *MusicService) PlayerGetEqGains() []float64               { return []float64{} }
func (a *MusicService) PlayerSetEqEnabled(on bool)                {}
func (a *MusicService) PlayerGetEqEnabled() bool                  { return false }
func (a *MusicService) PlayerResetEq()                            {}
func (a *MusicService) PlayerSetSmartEQEnabled(on bool)           {}
func (a *MusicService) PlayerGetSmartEQEnabled() bool             { return false }
func (a *MusicService) PlayerSetSmartEQIntensity(v float64)       {}
func (a *MusicService) PlayerGetSmartEQIntensity() float64        { return 0 }

// 队列与音量方法
func (a *MusicService) QueueAddTrack(id int64) QueueItem {
	item, _ := a.player.queue.AddTrack(id)
	return item
}
func (a *MusicService) QueueAddAll(ids []int64) int  { return a.player.queue.AddAll(ids) }
func (a *MusicService) QueueAddAllFromLibrary() int  { return a.player.queue.AddAllFromLibrary() }
func (a *MusicService) QueueRemoveAt(index int) bool { return a.player.queue.RemoveAt(index) }
func (a *MusicService) QueueClear()                  { a.player.queue.Clear() }
func (a *MusicService) QueueShuffle()                { a.player.queue.Shuffle() }
func (a *MusicService) QueueMove(from, to int) bool  { return a.player.queue.Move(from, to) }
func (a *MusicService) QueueJumpTo(index int) error {
	if item, ok := a.player.queue.JumpTo(index); ok {
		a.player.mu.Lock()
		curTrack := a.player.track
		isSame := curTrack != nil && curTrack.ID == item.Track.ID
		a.player.mu.Unlock()

		if isSame {
			a.player.resume()
			return nil
		}

		if err := a.player.loadTrack(item.Track); err != nil {
			return err
		}
		a.player.resume()
		return nil
	}
	return fmt.Errorf("队列下标越界")
}
func (a *MusicService) QueueGetStatus() QueueStatus { return a.player.queue.Status() }
func (a *MusicService) QueueGetNext() QueueItem {
	item, _ := a.player.queue.GetNext(true)
	return item
}
func (a *MusicService) QueueGetPrev() QueueItem {
	item, _ := a.player.queue.GetPrev(true)
	return item
}
func (a *MusicService) SetApplicationVolume(vol int) error {
	a.player.SetVolume(vol)
	return nil
}
func (a *MusicService) GetApplicationVolume() (int, error) {
	return a.player.GetVolume(), nil
}

// ============ Player 内部实现 ============

func (p *Player) loadTrack(track format.MscData) error {
	if !p.ready {
		return fmt.Errorf("音频设备未初始化")
	}

	filePath, err := p.db.GetTrackFilePath(strconv.FormatInt(track.ID, 10))
	if err != nil {
		return err
	}

	// 先停止旧播放并释放旧 PCM
	p.isPlaying.Store(false)
	p.isPaused.Store(true)
	p.muteBytes.Store(0)

	p.closeOtoPlayer()
	p.freePCM()

	p.mu.Lock()
	p.track = nil
	p.mu.Unlock()

	var cBuf unsafe.Pointer
	var cSize C.int
	cPath := C.CString(filePath)
	defer C.free(unsafe.Pointer(cPath))

	// 核心：CGO 调用 FFmpeg 将整个文件解码到 RAM
	ret := C.ffmpeg_decode_to_ram(cPath, &cBuf, &cSize)
	if ret != 0 || cBuf == nil || cSize <= 0 {
		if cBuf != nil {
			C.free(cBuf)
		}
		return fmt.Errorf("FFmpeg 解码失败或音频为空")
	}

	// 内存上限保护：单首歌 PCM 超过 1GB 时拒绝加载
	const maxAllowedBytes = int64(1 << 30)
	if int64(cSize) > maxAllowedBytes {
		C.free(cBuf)
		runtime.GC()
		return fmt.Errorf("曲目过大，解码后大小 %.1f MB 超过上限 1024 MB", float64(cSize)/(1024*1024))
	}

	// 发布新的不可变 PCM 快照
	snap := &pcmSnapshot{
		data:       unsafe.Slice((*byte)(cBuf), int(cSize)),
		totalBytes: int64(cSize),
		cPtr:       cBuf,
	}
	p.pcm.Store(snap)

	p.readOffset.Store(0)
	p.seekSeq.Store(0)
	p.muteBytes.Store(0)
	p.isPaused.Store(true)
	p.isPlaying.Store(false)

	p.mu.Lock()
	p.track = &track

	// 重建 otoPlayer，清空上一首歌的 Oto 内部缓冲。
	// 切歌频率低，重建是安全的。
	if p.otoCtx != nil {
		if p.otoPlayer != nil {
			p.otoPlayer.Close()
		}
		p.otoPlayer = p.otoCtx.NewPlayer(&PCMReader{p: p})
		p.otoPlayer.Play()
	}
	p.mu.Unlock()

	log.Printf("[Player] 已加载曲目 %q: 解码后 %.1f MB, 时长 %.1fs",
		filePath,
		float64(cSize)/(1024*1024),
		float64(cSize)/float64(playerSampleRate*bytesPerFrame),
	)

	if p.queue != nil {
		p.queue.EnsureCurrent(track.ID)
	}

	p.emitTrackLoaded()
	p.emitState()
	return nil
}

func (p *Player) resume() {
	if !p.ready || p.pcm.Load() == nil {
		return
	}

	wasPaused := p.isPaused.Load()

	p.isPaused.Store(false)
	p.isPlaying.Store(true)

	p.mu.Lock()
	if p.otoPlayer == nil && p.otoCtx != nil {
		p.otoPlayer = p.otoCtx.NewPlayer(&PCMReader{p: p})
	}
	if p.otoPlayer != nil {
		p.otoPlayer.Play()
	}
	p.mu.Unlock()

	if wasPaused && p.track != nil && p.app != nil {
		p.app.RecordPlayStart(p.track.ID)
	}
	p.emitState()
}

func (p *Player) pause() {
	if !p.ready {
		return
	}

	wasPlaying := p.isPlaying.Load() && !p.isPaused.Load()
	p.isPaused.Store(true)

	if wasPlaying && p.track != nil && p.app != nil {
		p.app.RecordPlayPause(p.track.ID)
	}
	p.emitState()
}

func (p *Player) toggle() {
	if p.isPaused.Load() {
		p.resume()
	} else {
		p.pause()
	}
}

// seek：
// 不重建 oto.Player，只更新 offset，并用静音冲刷旧缓冲。
// 这样连续拖动进度条更稳定。
func (p *Player) seek(seconds float64) error {
	snap := p.pcm.Load()
	if snap == nil {
		return fmt.Errorf("无曲目")
	}

	total := snap.totalBytes

	targetByte := int64(seconds * float64(playerSampleRate) * float64(bytesPerFrame))
	if targetByte < 0 {
		targetByte = 0
	}
	if targetByte > total {
		targetByte = total
	}

	// 对齐到完整采样帧，避免 Float32 stereo 帧边界错位
	targetByte -= targetByte % bytesPerFrame

	p.readOffset.Store(targetByte)
	p.seekSeq.Add(1)

	// seek 后进入短暂静音冲刷阶段
	p.muteBytes.Store(seekFlushBytes)

	p.emitTimeUpdate()
	return nil
}

func (p *Player) stop() {
	p.mu.Lock()
	track := p.track
	p.track = nil
	p.mu.Unlock()

	trackID := int64(0)
	if track != nil {
		trackID = track.ID
	}

	wasPlaying := p.isPlaying.Load() && !p.isPaused.Load()
	if wasPlaying && trackID > 0 && p.app != nil {
		p.app.RecordPlayPause(trackID)
	}

	p.isPlaying.Store(false)
	p.isPaused.Store(true)
	p.muteBytes.Store(0)

	p.closeOtoPlayer()
	p.freePCM()

	if p.app != nil {
		p.app.EmitEvent("player:state", map[string]any{
			"isPlaying": false,
			"position":  0.0,
			"duration":  0.0,
			"trackId":   int64(0),
		})
	}
}

func (p *Player) restart() error {
	if p.pcm.Load() == nil {
		return fmt.Errorf("无曲目")
	}

	p.readOffset.Store(0)
	p.seekSeq.Add(1)
	p.muteBytes.Store(seekFlushBytes)

	p.isPlaying.Store(true)
	p.isPaused.Store(false)

	p.mu.Lock()
	if p.otoPlayer == nil && p.otoCtx != nil {
		p.otoPlayer = p.otoCtx.NewPlayer(&PCMReader{p: p})
	}
	if p.otoPlayer != nil {
		p.otoPlayer.Play()
	}
	p.mu.Unlock()

	if p.track != nil && p.app != nil {
		p.app.RecordPlayStart(p.track.ID)
	}
	p.emitState()
	return nil
}

func (p *Player) togglePlayMode() string {
	p.mu.Lock()
	modes := []string{"none", "loopOne", "random"}
	idx := 0
	for i, m := range modes {
		if m == p.playMode {
			idx = i
			break
		}
	}
	p.playMode = modes[(idx+1)%len(modes)]
	mode := p.playMode
	p.mu.Unlock()

	if p.app != nil {
		p.app.EmitEvent("player:modechange", mode)
	}
	return mode
}

func (p *Player) handleEnded() {
	snap := p.pcm.Load()
	if snap == nil {
		return
	}

	// 如果用户已经 seek / restart 回到中间位置，则不处理结束
	if p.readOffset.Load() < snap.totalBytes {
		return
	}

	p.mu.Lock()
	mode := p.playMode
	track := p.track
	queue := p.queue
	p.mu.Unlock()

	trackID := int64(0)
	if track != nil {
		trackID = track.ID
	}

	// 单曲循环
	if mode == "loopOne" {
		_ = p.restart()
		return
	}

	if trackID > 0 && p.app != nil {
		p.app.RecordPlayPause(trackID)
	}

	// 队列继续播放
	if queue != nil && !queue.IsEmpty() {
		var item QueueItem
		var ok bool

		if mode == "random" {
			item, ok = queue.AdvanceRandom(true)
		} else {
			item, ok = queue.AdvanceNext(true)
		}

		if ok {
			if err := p.loadTrack(item.Track); err == nil {
				p.resume()
				if p.app != nil {
					status := queue.Status()
					p.app.EmitEvent("player:queuenext", map[string]any{
						"trackId":    item.Track.ID,
						"queueIndex": status.CurrentIndex,
					})
				}
			}
			return
		}
	}

	// 真结束
	if p.app != nil {
		p.app.EmitEvent("player:ended", trackID)
		p.emitState()
	}
}

func (p *Player) snapshot() PlayerState {
	p.mu.Lock()
	track := p.track
	volume := int(p.volume.Load())
	mode := p.playMode
	p.mu.Unlock()

	state := PlayerState{
		Track:     track,
		IsPlaying: p.isPlaying.Load() && !p.isPaused.Load(),
		Volume:    volume,
		PlayMode:  mode,
	}

	if p.pcm.Load() != nil {
		state.Position = p.safePosition()
		state.Duration = p.safeDuration()
	}
	return state
}

func (p *Player) safePosition() float64 {
	if p.pcm.Load() == nil {
		return 0
	}
	return float64(p.readOffset.Load()) / float64(playerSampleRate*bytesPerFrame)
}

func (p *Player) safeDuration() float64 {
	snap := p.pcm.Load()
	if snap == nil || snap.totalBytes == 0 {
		return 0
	}
	return float64(snap.totalBytes) / float64(playerSampleRate*bytesPerFrame)
}

func (p *Player) emitTrackLoaded() {
	if p.app == nil || p.track == nil {
		return
	}
	p.app.EmitEvent("player:trackloaded", map[string]any{
		"track":    p.track,
		"duration": p.safeDuration(),
	})
}

func (p *Player) emitState() {
	if p.app == nil {
		return
	}

	trackID := int64(0)
	p.mu.Lock()
	if p.track != nil {
		trackID = p.track.ID
	}
	p.mu.Unlock()

	p.app.EmitEvent("player:state", map[string]any{
		"isPlaying": p.isPlaying.Load() && !p.isPaused.Load(),
		"position":  p.safePosition(),
		"duration":  p.safeDuration(),
		"trackId":   trackID,
	})
}

func (p *Player) emitTimeUpdate() {
	if p.app == nil || p.pcm.Load() == nil {
		return
	}
	p.app.EmitEvent("player:timeupdate", map[string]float64{
		"position": p.safePosition(),
		"duration": p.safeDuration(),
	})
}

func (p *Player) timeUpdateLoop() {
	ticker := time.NewTicker(playerTimeUpdateInterval)
	defer ticker.Stop()

	for {
		select {
		case <-p.closed:
			return
		case <-ticker.C:
			if p.isPlaying.Load() && !p.isPaused.Load() {
				p.emitTimeUpdate()
			}
		}
	}
}

func (p *Player) SetVolume(vol int) {
	if vol < 0 {
		vol = 0
	}
	if vol > 100 {
		vol = 100
	}
	p.volume.Store(int32(vol))
}

func (p *Player) GetVolume() int {
	return int(p.volume.Load())
}

func (p *Player) SetInitialVolume(vol int) {
	p.volume.Store(int32(vol))
}

func (p *Player) SetSmartEQDefaults(enabled bool, intensity float64) {}

func volumeToGain(vol int) float64 {
	if vol <= 0 {
		return 0
	}
	if vol >= 100 {
		return 1.0
	}
	return math.Pow(float64(vol)/100.0, 2.0)
}

// HasTrack 返回当前是否加载了曲目
func (p *Player) HasTrack() bool {
	return p.pcm.Load() != nil
}

// IsPaused 返回是否处于暂停态
func (p *Player) IsPaused() bool {
	return p.isPaused.Load()
}

// IsIdle 返回播放器是否空闲
func (p *Player) IsIdle() bool {
	return p.pcm.Load() == nil || p.isPaused.Load()
}
