package app

import (
	"fmt"

	"MusicLite/internal/metadata"
	"MusicLite/internal/playback"
)

func (s *MusicService) QueueAddTrack(id int64) playback.QueueItem {
	item, _ := s.player.Queue().AddTrack(id)
	return item
}

func (s *MusicService) QueueAddAll(ids []int64) int {
	return s.player.Queue().AddAll(ids)
}

func (s *MusicService) QueueAddAllFromLibrary() int {
	return s.player.Queue().AddAllFromLibrary()
}

func (s *MusicService) QueueRemoveAt(index int) bool {
	return s.player.Queue().RemoveAt(index)
}

func (s *MusicService) QueueClear() {
	s.player.Queue().Clear()
}

func (s *MusicService) QueueShuffle() {
	s.player.Queue().Shuffle()
}

func (s *MusicService) QueueMove(from, to int) bool {
	return s.player.Queue().Move(from, to)
}

func (s *MusicService) QueueJumpTo(index int) error {
	item, ok := s.player.Queue().JumpTo(index)
	if !ok {
		return fmt.Errorf("队列下标越界")
	}

	state := s.player.State()
	if state.Track != nil && state.Track.ID == item.Track.ID {
		s.player.Resume()
		return nil
	}

	if err := s.player.LoadTrack(item.Track); err != nil {
		return err
	}
	s.player.Resume()
	return nil
}

func (s *MusicService) QueueGetStatus() playback.QueueStatus {
	return s.player.Queue().Status()
}

func (s *MusicService) QueueGetNext() playback.QueueItem {
	item, _ := s.player.Queue().GetNext(true)
	return item
}

func (s *MusicService) QueueGetPrev() playback.QueueItem {
	item, _ := s.player.Queue().GetPrev(true)
	return item
}

// GetRandomTrack 返回随机下一首（供前端旧逻辑使用）。
func (s *MusicService) GetRandomTrack(currTrackID int64) metadata.MscData {
	item, ok := s.player.Queue().AdvanceRandom(true)
	if !ok {
		return metadata.MscData{}
	}
	return item.Track
}

// GetNextTracks 返回下一首。
func (s *MusicService) GetNextTracks(currTrackID int64) metadata.MscData {
	item, ok := s.player.Queue().GetNext(true)
	if !ok {
		return metadata.MscData{}
	}
	return item.Track
}

// GetPrevTracks 返回上一首。
func (s *MusicService) GetPrevTracks(currTrackID int64) metadata.MscData {
	item, ok := s.player.Queue().GetPrev(true)
	if !ok {
		return metadata.MscData{}
	}
	return item.Track
}
