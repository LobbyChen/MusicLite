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
// 如果你发现极快速拖动仍有一瞬间旧声残留，可以调大到 256 * 1024。
const seekFlushBytes = 160 * 1024

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
	pcmMu    sync.RWMutex
	db       *storage.Database
	app      *MusicService
	ready    bool
	closed   chan struct{}
	stopOnce sync.Once

	track   *format.MscData
	pcmData []byte
	cPtr    unsafe.Pointer

	hasPCM     atomic.Bool
	totalBytes atomic.Int64

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

// PCMReader 实现 io.Reader，供 oto 回调读取 RAM 中的数据
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

	// seek 后的静音冲刷阶段
	if r.p.muteBytes.Load() > 0 {
		for i := range buf {
			buf[i] = 0
		}
		r.p.muteBytes.Add(-int64(len(buf)))
		return len(buf), nil
	}

	r.p.pcmMu.RLock()
	pcm := r.p.pcmData
	total := r.p.totalBytes.Load()
	offset := r.p.readOffset.Load()
	r.p.pcmMu.RUnlock() // ← 立即释放，不阻塞音频线程

	// 播放结束检测（锁外判断，pcm 指针仍有效）
	if pcm == nil || offset >= total {
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

	n := copy(buf, pcm[offset:])

	// readOffset 是原子变量，无需锁
	r.p.readOffset.Add(int64(n))

	// 尾部补静音
	if n < len(buf) {
		for i := n; i < len(buf); i++ {
			buf[i] = 0
		}
	}

	// 应用音量
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
	op.BufferSize = 20 * time.Millisecond

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
}

func (p *Player) Stop() {
	p.stopOnce.Do(func() {
		close(p.closed)

		p.isPlaying.Store(false)
		p.isPaused.Store(true)
		p.muteBytes.Store(0)

		p.closeOtoPlayer()
		p.freePCM()
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
func (p *Player) freePCM() {
	p.pcmMu.Lock()
	ptr := p.cPtr
	p.cPtr = nil
	p.pcmData = nil
	p.totalBytes.Store(0)
	p.hasPCM.Store(false)
	p.pcmMu.Unlock() // ← 先释放锁
	if ptr != nil {
		C.free(ptr)
		runtime.GC()
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

	ret := C.ffmpeg_decode_to_ram(cPath, &cBuf, &cSize)
	if ret != 0 || cBuf == nil || cSize <= 0 {
		if cBuf != nil {
			C.free(cBuf)
		}
		return fmt.Errorf("FFmpeg 解码失败或音频为空")
	}

	// 内存上限保护
	const maxAllowedBytes = int64(1 << 30)
	if int64(cSize) > maxAllowedBytes {
		C.free(cBuf)
		runtime.GC()
		return fmt.Errorf("曲目过大，解码后大小 %.1f MB 超过上限 1024 MB", float64(cSize)/(1024*1024))
	}

	// 写入新 PCM
	p.pcmMu.Lock()
	p.cPtr = cBuf
	p.pcmData = unsafe.Slice((*byte)(cBuf), int(cSize))
	p.totalBytes.Store(int64(cSize))
	p.hasPCM.Store(true)
	p.pcmMu.Unlock()

	p.readOffset.Store(0)
	p.seekSeq.Store(0)
	p.muteBytes.Store(0)
	p.isPaused.Store(true)
	p.isPlaying.Store(false)

	p.mu.Lock()
	p.track = &track
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
	if !p.ready || !p.hasPCM.Load() {
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

// seek：不再重建 oto.Player，只更新 offset，并用静音冲刷旧缓冲
func (p *Player) seek(seconds float64) error {
	if !p.hasPCM.Load() {
		return fmt.Errorf("无曲目")
	}

	total := p.totalBytes.Load()

	targetByte := int64(seconds * float64(playerSampleRate) * float64(bytesPerFrame))
	if targetByte < 0 {
		targetByte = 0
	}
	if targetByte > total {
		targetByte = total
	}

	// 对齐到完整采样帧，避免 Float32 stereo 帧边界错位
	targetByte -= targetByte % bytesPerFrame

	p.pcmMu.Lock()
	p.readOffset.Store(targetByte)
	p.seekSeq.Add(1)
	p.pcmMu.Unlock()

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
	if !p.hasPCM.Load() {
		return fmt.Errorf("无曲目")
	}

	p.pcmMu.Lock()
	p.readOffset.Store(0)
	p.seekSeq.Add(1)
	p.pcmMu.Unlock()

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
	if !p.hasPCM.Load() {
		return
	}

	// 如果用户已经 seek / restart 回到中间位置，则不处理结束
	if p.readOffset.Load() < p.totalBytes.Load() {
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

	if p.hasPCM.Load() {
		state.Position = p.safePosition()
		state.Duration = p.safeDuration()
	}
	return state
}

func (p *Player) safePosition() float64 {
	if !p.hasPCM.Load() {
		return 0
	}
	return float64(p.readOffset.Load()) / float64(playerSampleRate*bytesPerFrame)
}

func (p *Player) safeDuration() float64 {
	total := p.totalBytes.Load()
	if total == 0 {
		return 0
	}
	return float64(total) / float64(playerSampleRate*bytesPerFrame)
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
	if p.app == nil || !p.hasPCM.Load() {
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
	return p.hasPCM.Load()
}

// IsPaused 返回是否处于暂停态
func (p *Player) IsPaused() bool {
	return p.isPaused.Load()
}

// IsIdle 返回播放器是否空闲
func (p *Player) IsIdle() bool {
	return !p.hasPCM.Load() || p.isPaused.Load()
}
