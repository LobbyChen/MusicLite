//go:build !windows

package app

// ============ 非 Windows 平台：自定义更新方式（打开浏览器到 Release 页面）============
//
// 用户需求：其他平台更新方式自定义。
// 这里采取最简实现：PerformUpdate() 直接在系统默认浏览器中打开 Release 网页，
// 由用户手动下载对应平台安装包（macOS .dmg / Linux .deb/.rpm）。
//
// 若未来需要更精细的平台更新（如 macOS Sparkle、Linux apt 仓库），
// 可在此文件按 GOOS 进一步分派。

import (
	"fmt"
	"runtime"
)

// PerformUpdate 非 Windows 平台：打开 Release 页面让用户手动下载
// info 由前端传入，仅用于在没有 ReleaseURL 时兜底
func (a *MusicService) PerformUpdate(info UpdateInfo) error {
	url := info.ReleaseURL
	if url == "" {
		url = GitHubRepoURL + "/releases/latest"
	}
	if err := openURL(url); err != nil {
		return fmt.Errorf("无法打开浏览器: %w", err)
	}
	return nil
}

// 防止 "declared and not used"：在 darwin/linux 下 runtime.GOOS 间接通过 openURL 使用
var _ = runtime.GOOS
