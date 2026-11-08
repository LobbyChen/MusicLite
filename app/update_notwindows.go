//go:build !windows

package app

// ============ 非 Windows 平台：打开 Release 页面手动更新 ============

import (
	"fmt"

	"MusicLite/internal/platform"
)

// PerformUpdate 非 Windows 平台：打开 Release 页面让用户手动下载。
func (s *MusicService) PerformUpdate(info UpdateInfo) error {
	url := info.ReleaseURL
	if url == "" {
		url = GitHubRepoURL + "/releases/latest"
	}
	if err := platform.OpenURL(url); err != nil {
		return fmt.Errorf("无法打开浏览器: %w", err)
	}
	return nil
}

// applyDownloadedFile 非 Windows 平台：打开 Release 页面让用户手动安装。
func (s *MusicService) applyDownloadedFile(downloadedPath string) error {
	if err := platform.OpenURL(GitHubRepoURL + "/releases/latest"); err != nil {
		return fmt.Errorf("无法打开浏览器: %w", err)
	}
	return nil
}
