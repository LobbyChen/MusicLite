package library

import (
	"encoding/binary"
	"math"
	"os"
	"path/filepath"
	"testing"

	"MusicLite/internal/storage"
)

func makeWAV(t *testing.T) string {
	t.Helper()
	const rate = 44100
	samples := rate / 10 // 0.1s
	path := filepath.Join(t.TempDir(), "sample.wav")

	f, err := os.Create(path)
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()

	dataSize := samples * 2 * 2
	header := make([]byte, 44)
	copy(header[0:4], "RIFF")
	binary.LittleEndian.PutUint32(header[4:8], uint32(36+dataSize))
	copy(header[8:12], "WAVE")
	copy(header[12:16], "fmt ")
	binary.LittleEndian.PutUint32(header[16:20], 16)
	binary.LittleEndian.PutUint16(header[20:22], 1)
	binary.LittleEndian.PutUint16(header[22:24], 2)
	binary.LittleEndian.PutUint32(header[24:28], rate)
	binary.LittleEndian.PutUint32(header[28:32], rate*4)
	binary.LittleEndian.PutUint16(header[32:34], 4)
	binary.LittleEndian.PutUint16(header[34:36], 16)
	copy(header[36:40], "data")
	binary.LittleEndian.PutUint32(header[40:44], uint32(dataSize))
	if _, err := f.Write(header); err != nil {
		t.Fatal(err)
	}

	buf := make([]byte, dataSize)
	for i := 0; i < samples; i++ {
		v := int16(math.Sin(2*math.Pi*440*float64(i)/rate) * 8000)
		binary.LittleEndian.PutUint16(buf[i*4:], uint16(v))
		binary.LittleEndian.PutUint16(buf[i*4+2:], uint16(v))
	}
	if _, err := f.Write(buf); err != nil {
		t.Fatal(err)
	}
	return path
}

func TestImportAndQuery(t *testing.T) {
	db := storage.CreateDataBaseObj()
	if _, err := db.OpenConnect(filepath.Join(t.TempDir(), "test.db")); err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if err := db.EnsureTracksTable(); err != nil {
		t.Fatal(err)
	}

	svc := New(db)
	path := makeWAV(t)
	if n, err := svc.ImportPaths([]string{path}); err != nil || n != 1 {
		t.Fatalf("ImportPaths = %d, %v", n, err)
	}

	tracks, err := svc.GetAllTracks()
	if err != nil {
		t.Fatal(err)
	}
	if len(tracks) != 1 {
		t.Fatalf("got %d tracks, want 1", len(tracks))
	}
	if tracks[0].Name != "sample" {
		t.Fatalf("name = %q, want sample", tracks[0].Name)
	}
	if tracks[0].Format != "wav" {
		t.Fatalf("format = %q, want wav", tracks[0].Format)
	}

	if err := svc.DeleteTrack(tracks[0].ID); err != nil {
		t.Fatal(err)
	}
	tracks, _ = svc.GetAllTracks()
	if len(tracks) != 0 {
		t.Fatalf("got %d tracks after delete, want 0", len(tracks))
	}
}
