package main

import (
	"unsafe"
)

// Config 通用环形缓冲区配置
type Config struct {
	Freq         uint // 采样率/写入频率
	ChannelCount uint // 通道数量
	WindowSec    uint // 窗口时长(秒)
}

// Buffer 通用多通道环形缓冲区
type Buffer struct {
	cfg Config

	// OrgPtr[i] 指向第 i 个通道的起始地址
	OrgPtr []unsafe.Pointer

	// BufferSize 每个通道的缓冲区大小
	BufferSize uint

	// CurrWriteIndex[i] 代表第 i 个通道的目前写入位置索引
	CurrWriteIndex []uint
}

func NewBuffer(freq, channelCount, windowSec uint) *Buffer {
	bufferSize := freq * windowSec
	ret := &Buffer{
		cfg: Config{
			Freq:         freq,
			ChannelCount: channelCount,
			WindowSec:    windowSec,
		},
		BufferSize:     bufferSize,
		CurrWriteIndex: make([]uint, channelCount),
	}

	dat := make([][]float64, channelCount)
	for i := range dat {
		dat[i] = make([]float64, bufferSize)
		ret.OrgPtr = append(ret.OrgPtr, unsafe.Pointer(&dat[i][0]))
	}

	return ret
}

func (b *Buffer) check() bool {
	return len(b.OrgPtr) != 0
}

func (b *Buffer) WriteData(channel uint, data float64) {
	if !b.check() || channel == 0 || channel > b.cfg.ChannelCount {
		return
	}

	currChannel := channel - 1
	writeIdx := b.CurrWriteIndex[currChannel]

	// 计算当前写入位置的指针
	elemSize := uintptr(8) // float64 的大小
	currPtr := unsafe.Add(b.OrgPtr[currChannel], uintptr(writeIdx)*elemSize)

	*(*float64)(currPtr) = data

	b.CurrWriteIndex[currChannel] = (writeIdx + 1) % b.BufferSize
}

func (b *Buffer) GetChannelData(channel uint) []float64 {
	if !b.check() || channel == 0 || channel > b.cfg.ChannelCount {
		return nil
	}

	currChannel := channel - 1
	writeIdx := b.CurrWriteIndex[currChannel]
	elemSize := uintptr(8)

	retslice := make([]float64, b.BufferSize)

	if writeIdx == 0 {
		orgSlice := unsafe.Slice((*float64)(b.OrgPtr[currChannel]), b.BufferSize)
		copy(retslice, orgSlice)
	} else {
		part1Len := b.BufferSize - writeIdx
		orgSlice1 := unsafe.Slice((*float64)(unsafe.Add(b.OrgPtr[currChannel], uintptr(writeIdx)*elemSize)), part1Len)
		copy(retslice[:part1Len], orgSlice1)
		orgSlice2 := unsafe.Slice((*float64)(b.OrgPtr[currChannel]), writeIdx)
		copy(retslice[part1Len:], orgSlice2)
	}

	return retslice
}
