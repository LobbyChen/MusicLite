package app

func (s *MusicService) GetListenTime(trackID int64) int64 {
	if s.listenTime == nil {
		return 0
	}
	return s.listenTime.Get(trackID)
}

func (s *MusicService) GetTotalListenTime() int64 {
	if s.listenTime == nil {
		return 0
	}
	return s.listenTime.Total()
}
