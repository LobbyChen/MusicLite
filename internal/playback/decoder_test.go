package playback

import (
	"encoding/binary"
	"math"
	"os"
	"path/filepath"
	"testing"
)

func writeTestWAV(t *testing.T, seconds float64) string {
	t.Helper()
	const (
		rate     = 44100
		channels = 2
		bits     = 16
	)
	samples := int(seconds * rate)
	dataSize := samples * channels * bits / 8

	path := filepath.Join(t.TempDir(), "test.wav")
	f, err := os.Create(path)
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()

	header := make([]byte, 44)
	copy(header[0:4], "RIFF")
	binary.LittleEndian.PutUint32(header[4:8], uint32(36+dataSize))
	copy(header[8:12], "WAVE")
	copy(header[12:16], "fmt ")
	binary.LittleEndian.PutUint32(header[16:20], 16)
	binary.LittleEndian.PutUint16(header[20:22], 1)
	binary.LittleEndian.PutUint16(header[22:24], channels)
	binary.LittleEndian.PutUint32(header[24:28], rate)
	binary.LittleEndian.PutUint32(header[28:32], rate*channels*bits/8)
	binary.LittleEndian.PutUint16(header[32:34], channels*bits/8)
	binary.LittleEndian.PutUint16(header[34:36], bits)
	copy(header[36:40], "data")
	binary.LittleEndian.PutUint32(header[40:44], uint32(dataSize))
	if _, err := f.Write(header); err != nil {
		t.Fatal(err)
	}

	buf := make([]byte, dataSize)
	for i := 0; i < samples; i++ {
		v := int16(math.Sin(2*math.Pi*440*float64(i)/rate) * 12000)
		for c := 0; c < channels; c++ {
			off := (i*channels + c) * 2
			binary.LittleEndian.PutUint16(buf[off:off+2], uint16(v))
		}
	}
	if _, err := f.Write(buf); err != nil {
		t.Fatal(err)
	}
	return path
}

func TestDecoderStreamAndSeek(t *testing.T) {
	path := writeTestWAV(t, 1.0)
	dec, err := OpenDecoder(path)
	if err != nil {
		t.Fatal(err)
	}
	defer dec.Close()

	if d := dec.Duration(); d < 0.9 || d > 1.1 {
		t.Fatalf("duration = %v, want ~1s", d)
	}

	chunk := make([]byte, 64*1024)
	total := 0
	for {
		n, err := dec.Read(chunk)
		total += n
		if err != nil {
			break
		}
	}
	want := 44100 * 2 * 4 // 1s, stereo, float32
	if total < want*95/100 || total > want*105/100 {
		t.Fatalf("decoded %d bytes, want ~%d", total, want)
	}

	if err := dec.Seek(0.5); err != nil {
		t.Fatal(err)
	}
	n, err := dec.Read(chunk)
	if err != nil || n == 0 {
		t.Fatalf("read after seek: n=%d err=%v", n, err)
	}
}
