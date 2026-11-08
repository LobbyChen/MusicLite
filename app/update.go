package app

// ============ 检查更新（跨平台）============
//
// 流程：
//   1. CheckForUpdate() 拉取 GitHub Releases API（latest），解析 tag_name / assets / body
//   2. 平台分派：
//      - Windows: 找便携包，PerformUpdate() 下载后自替换
//      - 其他平台: 仅返回 UpdateInfo，由前端引导用户打开 Release 页面手动下载

import (
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"runtime"
	"strconv"
	"strings"
	"time"

	"MusicLite/internal/platform"
)

// GitHubAPIBase GitHub API 基础路径。
const GitHubAPIBase = "https://api.github.com/repos/LobbyChen/MusicLite"

// githubReleaseAsset 对应 GitHub Releases API 中的 asset 子对象。
type githubReleaseAsset struct {
	Name               string `json:"name"`
	BrowserDownloadURL string `json:"browser_download_url"`
	Size               int64  `json:"size"`
}

// githubRelease 对应 GitHub Releases API 的精简响应。
type githubRelease struct {
	TagName     string               `json:"tag_name"`
	Name        string               `json:"name"`
	Body        string               `json:"body"`
	HTMLURL     string               `json:"html_url"`
	Prerelease  bool                 `json:"prerelease"`
	PublishedAt time.Time            `json:"published_at"`
	Assets      []githubReleaseAsset `json:"assets"`
}

// UpdateInfo 检查更新返回结构。
type UpdateInfo struct {
	HasUpdate    bool   `json:"hasUpdate"`
	CurrentVer   string `json:"currentVer"`
	LatestVer    string `json:"latestVer"`
	LatestTag    string `json:"latestTag"`
	ReleaseTitle string `json:"releaseTitle"`
	ReleaseNotes string `json:"releaseNotes"`
	ReleaseURL   string `json:"releaseURL"`
	DownloadURL  string `json:"downloadURL"`
	DownloadName string `json:"downloadName"`
	DownloadSize int64  `json:"downloadSize"`
	PublishedAt  string `json:"publishedAt"`
	Platform     string `json:"platform"`
	IsPrerelease bool   `json:"isPrerelease"`
	Error        string `json:"error"`
}

// applyGhProxy 根据设置决定是否对 GitHub 下载 URL 应用 gh-proxy 前缀。
func (s *MusicService) applyGhProxy(rawURL string) string {
	if rawURL == "" {
		return rawURL
	}
	cfg := s.LoadSettings()
	if cfg.UpdateProxyMode != "ghproxy" {
		return rawURL
	}
	prefix := strings.TrimRight(cfg.GhProxyURL, "/") + "/"
	lower := strings.ToLower(rawURL)
	if strings.HasPrefix(lower, "https://github.com/") ||
		strings.HasPrefix(lower, "https://objects.githubusercontent.com/") ||
		strings.HasPrefix(lower, "https://github-releases.githubusercontent.com/") ||
		(strings.HasPrefix(lower, "https://") && strings.Contains(lower, ".githubusercontent.com/")) {
		return prefix + rawURL
	}
	return rawURL
}

// CheckForUpdate 拉取 GitHub 最新 Release 并与当前版本比较。
// 不抛出错误，错误信息放在 UpdateInfo.Error 中。
func (s *MusicService) CheckForUpdate() UpdateInfo {
	info := UpdateInfo{
		CurrentVer: stripDevSuffix(platform.Version),
		Platform:   runtime.GOOS,
	}

	client := &http.Client{Timeout: 20 * time.Second}
	// 检查更新与下载共用更新代理配置：ghproxy 模式下 API 也走代理，
	// 避免部分网络环境下 api.github.com 直连超时导致按钮长时间无响应。
	apiURL := GitHubAPIBase + "/releases/latest"
	cfg := s.LoadSettings()
	if cfg.UpdateProxyMode == "ghproxy" {
		if prefix := strings.TrimSpace(cfg.GhProxyURL); prefix != "" {
			apiURL = strings.TrimRight(prefix, "/") + "/" + apiURL
		}
	}
	logUpdateEvent("check", "GET "+apiURL)
	req, err := http.NewRequest("GET", apiURL, nil)
	if err != nil {
		info.Error = fmt.Sprintf("构建请求失败: %v", err)
		return info
	}
	req.Header.Set("User-Agent", "MusicLite/"+platform.Version)
	req.Header.Set("Accept", "application/vnd.github+json")

	resp, err := client.Do(req)
	if err != nil {
		info.Error = fmt.Sprintf("网络请求失败: %v", err)
		logUpdateEvent("check", "失败: "+info.Error)
		return info
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		info.Error = fmt.Sprintf("GitHub API 返回 %d: %s", resp.StatusCode, truncate(string(body), 200))
		logUpdateEvent("check", "失败: "+info.Error)
		return info
	}

	var rel githubRelease
	if err := json.NewDecoder(resp.Body).Decode(&rel); err != nil {
		info.Error = fmt.Sprintf("解析响应失败: %v", err)
		return info
	}

	info.LatestTag = rel.TagName
	info.LatestVer = parseVersionFromTag(rel.TagName)
	info.ReleaseTitle = rel.Name
	info.ReleaseNotes = rel.Body
	info.ReleaseURL = rel.HTMLURL
	info.IsPrerelease = rel.Prerelease
	if !rel.PublishedAt.IsZero() {
		info.PublishedAt = rel.PublishedAt.Format(time.RFC3339)
	}

	info.DownloadURL, info.DownloadName, info.DownloadSize = pickPlatformAsset(rel.Assets, runtime.GOOS)
	info.DownloadURL = s.applyGhProxy(info.DownloadURL)

	// dev 版本默认不提示更新
	if isDevVersion(platform.Version) {
		info.HasUpdate = false
	} else {
		info.HasUpdate = compareVersion(info.LatestVer, info.CurrentVer) > 0
	}

	return info
}

// isDevVersion 判断是否为开发版本（含 -dev. 后缀）。
func isDevVersion(v string) bool {
	return strings.Contains(v, "-dev.")
}

// stripDevSuffix 去掉开发版本后缀。
func stripDevSuffix(v string) string {
	if i := strings.Index(v, "-dev."); i >= 0 {
		return v[:i]
	}
	return v
}

// parseVersionFromTag 从 tag 名中提取版本号。
func parseVersionFromTag(tag string) string {
	if tag == "" {
		return ""
	}
	re := regexp.MustCompile(`^[A-Za-zvV]*([0-9]+\.[0-9]+\.[0-9]+(?:\.[0-9]+)?)`)
	m := re.FindStringSubmatch(tag)
	if len(m) >= 2 {
		return m[1]
	}
	return tag
}

// compareVersion 比较两个语义化版本号，返回 -1 / 0 / 1。
func compareVersion(a, b string) int {
	pa := splitVersionParts(a)
	pb := splitVersionParts(b)
	n := len(pa)
	if len(pb) > n {
		n = len(pb)
	}
	for i := 0; i < n; i++ {
		xa, xb := 0, 0
		if i < len(pa) {
			xa, _ = strconv.Atoi(pa[i])
		}
		if i < len(pb) {
			xb, _ = strconv.Atoi(pb[i])
		}
		if xa < xb {
			return -1
		}
		if xa > xb {
			return 1
		}
	}
	return 0
}

// splitVersionParts 拆分版本号字符串，过滤掉非数字段。
func splitVersionParts(v string) []string {
	v = stripDevSuffix(v)
	parts := strings.Split(v, ".")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		p = strings.TrimSpace(p)
		if p == "" {
			continue
		}
		if _, err := strconv.Atoi(p); err == nil {
			out = append(out, p)
		}
	}
	return out
}

// pickPlatformAsset 为指定平台选取合适的便携包资源。
func pickPlatformAsset(assets []githubReleaseAsset, goos string) (url, name string, size int64) {
	var patterns []string
	switch goos {
	case "windows":
		patterns = []string{
			`(?i)^MusicLite.*Portable.*\.(exe|zip)$`,
			`(?i)^MusicLite.*portable.*\.(exe|zip)$`,
			`(?i)^MusicLite.*x64.*Portable.*\.(exe|zip)$`,
		}
	case "darwin":
		patterns = []string{
			`(?i)^MusicLite.*macos.*\.(zip|dmg)$`,
			`(?i)^MusicLite.*darwin.*\.(zip|dmg)$`,
			`(?i).*\.dmg$`,
		}
	default: // linux 及其他
		patterns = []string{
			`(?i)^musiclite\.(deb|rpm)$`,
			`(?i)^MusicLite.*linux.*\.(tar\.gz|deb|rpm)$`,
		}
	}

	for _, p := range patterns {
		re := regexp.MustCompile(p)
		for _, a := range assets {
			if re.MatchString(a.Name) && a.BrowserDownloadURL != "" {
				return a.BrowserDownloadURL, a.Name, a.Size
			}
		}
	}
	return "", "", 0
}

// truncate 字符串截断，附加 ...
func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n] + "..."
}

// logUpdateEvent 记录更新流程日志。
func logUpdateEvent(stage, info string) {
	log.Printf("[update:%s] %s", stage, info)
}

// CleanupOldExeBackups 清理上次更新遗留的 .exe~ 文件。
// 在程序启动时调用，删除 exe 所在目录下所有 .exe~ 结尾的文件。
func CleanupOldExeBackups() {
	exePath, err := os.Executable()
	if err != nil {
		return
	}
	exeDir := filepath.Dir(exePath)

	entries, err := os.ReadDir(exeDir)
	if err != nil {
		return
	}
	for _, entry := range entries {
		if strings.HasSuffix(strings.ToLower(entry.Name()), ".exe~") {
			_ = os.Remove(filepath.Join(exeDir, entry.Name()))
		}
	}
}
