package app

import (
	"MusicLite/internal/platform"
	"MusicLite/internal/settings"
	"MusicLite/internal/volume"
)

// GitHubRepoURL 项目仓库地址。
const GitHubRepoURL = "https://github.com/LobbyChen/MusicLite"

func (s *MusicService) LoadSettings() settings.Settings {
	return s.store.Load()
}

func (s *MusicService) SaveSettings(v settings.Settings) error {
	if err := s.store.Save(v); err != nil {
		return err
	}
	if s.hotkeys != nil {
		s.hotkeys.UpdateConfig(v)
	}
	return nil
}

func (s *MusicService) ResetSettings() settings.Settings {
	return settings.DefaultSettings()
}

func (s *MusicService) GetVersionInfo() platform.VersionInfo {
	return platform.GetVersionInfo()
}

func (s *MusicService) OpenAppDataFolder() error {
	return platform.OpenPath(platform.AppDataDir())
}

func (s *MusicService) OpenGitHubRepo() error {
	return platform.OpenURL(GitHubRepoURL)
}

func (s *MusicService) SetSystemMasterVolume(vol int) error {
	return volume.SetMaster(vol)
}

func (s *MusicService) GetSystemMasterVolume() (int, error) {
	return volume.GetMaster()
}

func (s *MusicService) MuteSystemMasterVolume() error {
	return volume.MuteMaster()
}

func (s *MusicService) UnmuteSystemMasterVolume() error {
	return volume.UnmuteMaster()
}
