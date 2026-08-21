package app

import (
	"MusicLite/internal/storage"
	"net/http"
	"os"
	"strings"
)

// AudioHandler 处理前端对音频文件和封面图片的 HTTP 请求
type AudioHandler struct {
	db *storage.Database
}

// NewAudioHandler 创建音频/封面请求处理器
func NewAudioHandler(db *storage.Database) *AudioHandler {
	return &AudioHandler{db: db}
}

// ServeHTTP 实现 http.Handler 接口
func (h *AudioHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	path := r.URL.Path

	switch {
	case strings.HasPrefix(path, "/audio/"):
		h.serveAudio(w, r)
	case strings.HasPrefix(path, "/cover/"):
		h.serveCover(w, r)
	default:
		http.NotFound(w, r)
	}
}

// serveAudio 处理 /audio/<id> 请求，返回音频文件流
func (h *AudioHandler) serveAudio(w http.ResponseWriter, r *http.Request) {
	id := strings.TrimPrefix(r.URL.Path, "/audio/")
	if id == "" {
		http.NotFound(w, r)
		return
	}

	filePath, err := h.db.GetTrackFilePath(id)
	if err != nil {
		http.NotFound(w, r)
		return
	}

	if _, err := os.Stat(filePath); err != nil {
		http.NotFound(w, r)
		return
	}

	http.ServeFile(w, r, filePath)
}

// serveCover 处理 /cover/<id> 请求，返回封面图片
func (h *AudioHandler) serveCover(w http.ResponseWriter, r *http.Request) {
	id := strings.TrimPrefix(r.URL.Path, "/cover/")
	if id == "" {
		http.NotFound(w, r)
		return
	}

	data, mime, err := h.db.GetTrackCover(id)
	if err != nil || len(data) == 0 {
		http.NotFound(w, r)
		return
	}

	if mime == "" {
		mime = "image/jpeg"
	}
	w.Header().Set("Content-Type", mime)
	w.Header().Set("Cache-Control", "max-age=3600")
	w.Write(data)
}
