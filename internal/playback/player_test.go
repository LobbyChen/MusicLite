package playback

import (
	"path/filepath"
	"strings"
	"testing"
	"time"

	"MusicLite/internal/metadata"
	"MusicLite/internal/storage"
)

func TestPlayerStreamingPlayback(t *testing.T) {
	db := storage.CreateDataBaseObj()
	if _, err := db.OpenConnect(filepath.Join(t.TempDir(), "player.db")); err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if err := db.EnsureTracksTable(); err != nil {
		t.Fatal(err)
	}

	path := writeTestWAV(t, 2.0)
	id, err := db.InsertTrack(storage.TrackRecord{
		Title:      "test",
		FilePath:   path,
		Format:     "wav",
		ImportedAt: time.Now().Unix(),
	})
	if err != nil {
		t.Fatal(err)
	}

	p := NewPlayer(db, nil, nil, nil)
	p.Start()
	defer p.Stop()

	if err := p.LoadTrack(metadata.MscData{ID: id, Name: "test", Format: metadata.Wav}); err != nil {
		if strings.Contains(err.Error(), "音频设备未初始化") {
			t.Skip("no audio device available")
		}
		t.Fatal(err)
	}

	p.Resume()
	time.Sleep(400 * time.Millisecond)
	state := p.State()
	if !state.IsPlaying {
		t.Fatal("player should be playing")
	}
	if state.Position < 0.05 {
		t.Fatalf("position did not advance: %v", state.Position)
	}
	if state.Duration < 1.5 || state.Duration > 2.5 {
		t.Fatalf("duration = %v, want ~2s", state.Duration)
	}

	if err := p.Seek(1.0); err != nil {
		t.Fatal(err)
	}
	time.Sleep(600 * time.Millisecond)
	if pos := p.State().Position; pos < 0.95 {
		t.Fatalf("position after seek = %v, want >= 0.95", pos)
	}

	p.StopTrack()
}
