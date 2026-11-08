package playback

/*
#cgo linux pkg-config: libavformat libavcodec libswresample libavutil
#cgo darwin pkg-config: libavformat libavcodec libswresample libavutil
#cgo windows LDFLAGS: -lavformat -lavcodec -lswresample -lavutil -lm

#include <libavformat/avformat.h>
#include <libavcodec/avcodec.h>
#include <libswresample/swresample.h>
#include <libavutil/opt.h>
#include <libavutil/channel_layout.h>
#include <libavutil/error.h>
#include <errno.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define ML_TARGET_RATE 44100
#define ML_TARGET_CHANNELS 2

typedef struct {
    AVFormatContext* fmt;
    AVCodecContext* dec;
    SwrContext* swr;
    AVPacket* pkt;
    AVFrame* frame;
    int stream_index;
    int eof;
    int swr_flushed;
    uint8_t* pending;
    int pending_len;
    int pending_pos;
    int pending_cap;
    int64_t duration_us;
} MLDecoder;

static void ml_set_error(char* buf, int len, const char* prefix, int err) {
    if (!buf || len <= 0) {
        return;
    }
    char detail[256];
    detail[0] = '\0';
    if (err != 0) {
        av_strerror(err, detail, sizeof(detail));
    }
    if (detail[0] != '\0') {
        snprintf(buf, len, "%s: %s", prefix, detail);
    } else {
        snprintf(buf, len, "%s", prefix);
    }
}

static int ml_ensure_pending(MLDecoder* d, int need) {
    if (need <= d->pending_cap) {
        return 0;
    }
    int cap = d->pending_cap > 0 ? d->pending_cap : 65536;
    while (cap < need) {
        cap *= 2;
    }
    uint8_t* p = (uint8_t*)realloc(d->pending, (size_t)cap);
    if (!p) {
        return -1;
    }
    d->pending = p;
    d->pending_cap = cap;
    return 0;
}

static int ml_flush_resampler(MLDecoder* d) {
    if (d->swr_flushed) {
        return 0;
    }
    d->swr_flushed = 1;
    int out_samples = swr_get_out_samples(d->swr, 0);
    if (out_samples <= 0) {
        return 0;
    }
    int need = (out_samples + 64) * ML_TARGET_CHANNELS * (int)sizeof(float);
    if (ml_ensure_pending(d, need) != 0) {
        return AVERROR(ENOMEM);
    }
    uint8_t* out = d->pending;
    int converted = swr_convert(d->swr, &out, out_samples, NULL, 0);
    if (converted < 0) {
        return converted;
    }
    d->pending_len = converted * ML_TARGET_CHANNELS * (int)sizeof(float);
    d->pending_pos = 0;
    return 0;
}

// ml_decode_more 返回 1=有数据，0=EOF，负值=错误。
static int ml_decode_more(MLDecoder* d) {
    for (;;) {
        if (d->pending_pos < d->pending_len) {
            return 1;
        }
        d->pending_pos = 0;
        d->pending_len = 0;

        int ret = avcodec_receive_frame(d->dec, d->frame);
        if (ret == AVERROR(EAGAIN)) {
            if (d->eof) {
                int flush_ret = ml_flush_resampler(d);
                if (flush_ret < 0) {
                    return flush_ret;
                }
                return d->pending_len > 0 ? 1 : 0;
            }

            int read_ret = 0;
            int sent = 0;
            while ((read_ret = av_read_frame(d->fmt, d->pkt)) >= 0) {
                if (d->pkt->stream_index == d->stream_index) {
                    int send_ret = avcodec_send_packet(d->dec, d->pkt);
                    av_packet_unref(d->pkt);
                    if (send_ret < 0 && send_ret != AVERROR(EAGAIN)) {
                        return send_ret;
                    }
                    sent = 1;
                    break;
                }
                av_packet_unref(d->pkt);
            }
            if (read_ret < 0) {
                d->eof = 1;
                avcodec_send_packet(d->dec, NULL);
            } else if (!sent) {
                continue;
            }
            continue;
        }

        if (ret == AVERROR_EOF) {
            d->eof = 1;
            int flush_ret = ml_flush_resampler(d);
            if (flush_ret < 0) {
                return flush_ret;
            }
            return d->pending_len > 0 ? 1 : 0;
        }
        if (ret < 0) {
            return ret;
        }

        int out_samples = swr_get_out_samples(d->swr, d->frame->nb_samples);
        if (out_samples <= 0) {
            av_frame_unref(d->frame);
            continue;
        }
        int need = (out_samples + 64) * ML_TARGET_CHANNELS * (int)sizeof(float);
        if (ml_ensure_pending(d, need) != 0) {
            av_frame_unref(d->frame);
            return AVERROR(ENOMEM);
        }
        uint8_t* out = d->pending;
        int converted = swr_convert(
            d->swr,
            &out,
            out_samples,
            (const uint8_t**)d->frame->extended_data,
            d->frame->nb_samples
        );
        av_frame_unref(d->frame);
        if (converted < 0) {
            return converted;
        }
        d->pending_len = converted * ML_TARGET_CHANNELS * (int)sizeof(float);
        d->pending_pos = 0;
        if (d->pending_len > 0) {
            return 1;
        }
    }
}

MLDecoder* ml_decoder_open(const char* path, char* errbuf, int errlen) {
    MLDecoder* d = (MLDecoder*)calloc(1, sizeof(MLDecoder));
    if (!d) {
        ml_set_error(errbuf, errlen, "out of memory", 0);
        return NULL;
    }

    int ret = avformat_open_input(&d->fmt, path, NULL, NULL);
    if (ret < 0) {
        ml_set_error(errbuf, errlen, "avformat_open_input", ret);
        goto fail;
    }
    ret = avformat_find_stream_info(d->fmt, NULL);
    if (ret < 0) {
        ml_set_error(errbuf, errlen, "avformat_find_stream_info", ret);
        goto fail;
    }

    d->stream_index = av_find_best_stream(d->fmt, AVMEDIA_TYPE_AUDIO, -1, -1, NULL, 0);
    if (d->stream_index < 0) {
        ml_set_error(errbuf, errlen, "no audio stream", d->stream_index);
        goto fail;
    }

    AVStream* stream = d->fmt->streams[d->stream_index];
    AVCodecParameters* par = stream->codecpar;
    const AVCodec* codec = avcodec_find_decoder(par->codec_id);
    if (!codec) {
        ml_set_error(errbuf, errlen, "decoder not found", 0);
        goto fail;
    }

    d->dec = avcodec_alloc_context3(codec);
    if (!d->dec) {
        ml_set_error(errbuf, errlen, "avcodec_alloc_context3 failed", 0);
        goto fail;
    }
    ret = avcodec_parameters_to_context(d->dec, par);
    if (ret < 0) {
        ml_set_error(errbuf, errlen, "avcodec_parameters_to_context", ret);
        goto fail;
    }
    ret = avcodec_open2(d->dec, codec, NULL);
    if (ret < 0) {
        ml_set_error(errbuf, errlen, "avcodec_open2", ret);
        goto fail;
    }

#if LIBAVUTIL_VERSION_INT >= AV_VERSION_INT(57, 28, 100)
    AVChannelLayout out_layout = AV_CHANNEL_LAYOUT_STEREO;
    ret = swr_alloc_set_opts2(
        &d->swr,
        &out_layout,
        AV_SAMPLE_FMT_FLT,
        ML_TARGET_RATE,
        &d->dec->ch_layout,
        d->dec->sample_fmt,
        d->dec->sample_rate,
        0,
        NULL
    );
#else
    d->swr = swr_alloc_set_opts(
        NULL,
        AV_CH_LAYOUT_STEREO,
        AV_SAMPLE_FMT_FLT,
        ML_TARGET_RATE,
        d->dec->channel_layout,
        d->dec->sample_fmt,
        d->dec->sample_rate,
        0,
        NULL
    );
    ret = d->swr ? 0 : AVERROR(ENOMEM);
#endif
    if (ret < 0 || !d->swr) {
        ml_set_error(errbuf, errlen, "swr_alloc_set_opts2", ret);
        goto fail;
    }
    ret = swr_init(d->swr);
    if (ret < 0) {
        ml_set_error(errbuf, errlen, "swr_init", ret);
        goto fail;
    }

    d->pkt = av_packet_alloc();
    d->frame = av_frame_alloc();
    if (!d->pkt || !d->frame) {
        ml_set_error(errbuf, errlen, "av_packet_alloc/av_frame_alloc failed", 0);
        goto fail;
    }

    if (d->fmt->duration > 0) {
        d->duration_us = d->fmt->duration;
    } else if (stream->duration > 0) {
        double seconds = (double)stream->duration * av_q2d(stream->time_base);
        d->duration_us = (int64_t)(seconds * 1000000.0);
    }

    return d;

fail:
    if (d->pkt) av_packet_free(&d->pkt);
    if (d->frame) av_frame_free(&d->frame);
    if (d->swr) swr_free(&d->swr);
    if (d->dec) avcodec_free_context(&d->dec);
    if (d->fmt) avformat_close_input(&d->fmt);
    free(d->pending);
    free(d);
    return NULL;
}

int ml_decoder_read(MLDecoder* d, uint8_t* out, int out_bytes) {
    if (!d || !out || out_bytes <= 0) {
        return 0;
    }
    int written = 0;
    while (written < out_bytes) {
        if (d->pending_pos >= d->pending_len) {
            int ret = ml_decode_more(d);
            if (ret < 0) {
                return ret;
            }
            if (ret == 0) {
                break;
            }
        }
        int available = d->pending_len - d->pending_pos;
        int want = out_bytes - written;
        int n = available < want ? available : want;
        memcpy(out + written, d->pending + d->pending_pos, (size_t)n);
        d->pending_pos += n;
        written += n;
    }
    return written;
}

int ml_decoder_seek(MLDecoder* d, double seconds) {
    if (!d) {
        return AVERROR(EINVAL);
    }
    if (seconds < 0) {
        seconds = 0;
    }

    AVStream* stream = d->fmt->streams[d->stream_index];
    int64_t ts = (int64_t)(seconds / av_q2d(stream->time_base));
    int ret = avformat_seek_file(d->fmt, d->stream_index, INT64_MIN, ts, INT64_MAX, 0);
    if (ret < 0) {
        ret = av_seek_frame(d->fmt, d->stream_index, ts, AVSEEK_FLAG_BACKWARD);
    }
    if (ret < 0) {
        return ret;
    }

    avcodec_flush_buffers(d->dec);
    av_packet_unref(d->pkt);
    av_frame_unref(d->frame);

    d->pending_len = 0;
    d->pending_pos = 0;
    d->eof = 0;
    d->swr_flushed = 0;

    swr_close(d->swr);
    ret = swr_init(d->swr);
    if (ret < 0) {
        return ret;
    }
    return 0;
}

double ml_decoder_duration(MLDecoder* d) {
    if (!d || d->duration_us <= 0) {
        return 0;
    }
    return (double)d->duration_us / 1000000.0;
}

void ml_decoder_close(MLDecoder* d) {
    if (!d) {
        return;
    }
    if (d->pkt) av_packet_free(&d->pkt);
    if (d->frame) av_frame_free(&d->frame);
    if (d->swr) swr_free(&d->swr);
    if (d->dec) avcodec_free_context(&d->dec);
    if (d->fmt) avformat_close_input(&d->fmt);
    free(d->pending);
    free(d);
}
*/
import "C"

import (
	"fmt"
	"io"
	"sync"
	"unsafe"
)

// Decoder 是 FFmpeg 增量解码器，输出 44100Hz / 双声道 / Float32LE PCM。
type Decoder struct {
	c         *C.MLDecoder
	closeOnce sync.Once
}

// OpenDecoder 打开音频文件并准备增量解码。
func OpenDecoder(path string) (*Decoder, error) {
	cPath := C.CString(path)
	defer C.free(unsafe.Pointer(cPath))

	errBuf := make([]byte, 512)
	cErr := (*C.char)(unsafe.Pointer(&errBuf[0]))
	d := C.ml_decoder_open(cPath, cErr, C.int(len(errBuf)))
	if d == nil {
		return nil, fmt.Errorf("ffmpeg: %s", C.GoString(cErr))
	}
	return &Decoder{c: d}, nil
}

// Read 读取最多 len(p) 字节的 PCM；返回 0 表示 EOF。
func (d *Decoder) Read(p []byte) (int, error) {
	if d == nil || d.c == nil {
		return 0, io.EOF
	}
	if len(p) == 0 {
		return 0, nil
	}
	n := int(C.ml_decoder_read(d.c, (*C.uint8_t)(unsafe.Pointer(&p[0])), C.int(len(p))))
	if n < 0 {
		return 0, fmt.Errorf("ffmpeg read error: %d", n)
	}
	if n == 0 {
		return 0, io.EOF
	}
	return n, nil
}

// Seek 跳转到指定秒数（会清理解码器与重采样器状态）。
func (d *Decoder) Seek(seconds float64) error {
	if d == nil || d.c == nil {
		return fmt.Errorf("decoder closed")
	}
	ret := int(C.ml_decoder_seek(d.c, C.double(seconds)))
	if ret < 0 {
		return fmt.Errorf("ffmpeg seek error: %d", ret)
	}
	return nil
}

// Duration 返回媒体时长（秒）；未知时返回 0。
func (d *Decoder) Duration() float64 {
	if d == nil || d.c == nil {
		return 0
	}
	return float64(C.ml_decoder_duration(d.c))
}

// Close 释放解码器。
func (d *Decoder) Close() {
	if d == nil {
		return
	}
	d.closeOnce.Do(func() {
		if d.c != nil {
			C.ml_decoder_close(d.c)
			d.c = nil
		}
	})
}
