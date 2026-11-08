package app

import (
	"MusicLite/internal/equalizer"
	"MusicLite/internal/metadata"
	"MusicLite/internal/playback"
)

func (s *MusicService) PlayerLoad(track metadata.MscData) error { return s.player.LoadTrack(track) }
func (s *MusicService) PlayerPlay()                             { s.player.Resume() }
func (s *MusicService) PlayerPause()                            { s.player.Pause() }
func (s *MusicService) PlayerToggle()                           { s.player.Toggle() }
func (s *MusicService) PlayerSeek(seconds float64) error        { return s.player.Seek(seconds) }
func (s *MusicService) PlayerStop()                             { s.player.StopTrack() }
func (s *MusicService) PlayerGetState() playback.PlayerState    { return s.player.State() }
func (s *MusicService) PlayerTogglePlayMode() string            { return s.player.TogglePlayMode() }
func (s *MusicService) PlayerGetPlayMode() string               { return s.player.PlayMode() }
func (s *MusicService) PlayerRestart() error                    { return s.player.Restart() }

func (s *MusicService) PlayerGetEqBandCount() int { return equalizer.EqBandCount }

func (s *MusicService) PlayerGetEqFreqs() []float64 {
	out := make([]float64, equalizer.EqBandCount)
	for i, f := range equalizer.EqCenterFreqs {
		out[i] = f
	}
	return out
}

func (s *MusicService) PlayerSetEqBand(index int, gainDB float64) {
	if s.player.Equalizer() != nil {
		s.player.Equalizer().SetBand(index, gainDB)
	}
}

func (s *MusicService) PlayerSetEqGains(gains []float64) {
	if s.player.Equalizer() != nil {
		s.player.Equalizer().SetGains(gains)
	}
}

func (s *MusicService) PlayerGetEqGains() []float64 {
	eq := s.player.Equalizer()
	if eq == nil {
		return make([]float64, equalizer.EqBandCount)
	}
	g := eq.GetGains()
	out := make([]float64, equalizer.EqBandCount)
	for i, v := range g {
		out[i] = v
	}
	return out
}

func (s *MusicService) PlayerSetEqEnabled(on bool) {
	if s.player.Equalizer() != nil {
		s.player.Equalizer().SetEnabled(on)
	}
}

func (s *MusicService) PlayerGetEqEnabled() bool {
	eq := s.player.Equalizer()
	return eq != nil && eq.IsEnabled()
}

func (s *MusicService) PlayerResetEq() {
	if s.player.Equalizer() != nil {
		s.player.Equalizer().SetGains(make([]float64, equalizer.EqBandCount))
	}
}

func (s *MusicService) SetApplicationVolume(vol int) error {
	s.player.SetVolume(vol)
	return nil
}

func (s *MusicService) GetApplicationVolume() (int, error) {
	return s.player.GetVolume(), nil
}
