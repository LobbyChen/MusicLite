package library

import (
	"net/http"
	"os"
	"strings"

	"MusicLite/internal/storage"
)

// StreamHandler 处理 /audio/<id> 与 /cover/<id> 请求。
type StreamHandler struct {
	db *storage.Database
}

func NewStreamHandler(db *storage.Database) *StreamHandler {
	return &StreamHandler{db: db}
}

func (h *StreamHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	switch {
	case strings.HasPrefix(r.URL.Path, "/audio/"):
		h.serveAudio(w, r)
	case strings.HasPrefix(r.URL.Path, "/cover/"):
		h.serveCover(w, r)
	default:
		http.NotFound(w, r)
	}
}

func (h *StreamHandler) serveAudio(w http.ResponseWriter, r *http.Request) {
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

	// ServeFile 自动处理 Content-Type、Range（拖动进度条）与 ETag。
	http.ServeFile(w, r, filePath)
}

func (h *StreamHandler) serveCover(w http.ResponseWriter, r *http.Request) {
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
	_, _ = w.Write(data)
}
