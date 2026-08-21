package app

// ============ 检查更新（跨平台）============
//
// 流程：
//   1. CheckForUpdate() 拉取 GitHub Releases API（latest），解析 tag_name / assets / body
//   2. 平台分派：
//      - Windows: 找便携包（MusicLite_B*_amd64.exe），PerformUpdate() 下载到 %TEMP%，
//                 生成 .cmd 文件在主进程退出后替换自己并启动新 exe
//      - 其他平台: 仅返回 UpdateInfo，由前端引导用户打开 Release 页面手动下载
//
// 注意：版本号格式由 scripts/version.mjs 生成：
//   - 正式发布：0.7.1
//   - 开发构建：0.7.1-dev.5.gabc1234
//   - 未打 tag：0.0.0-dev.N.gSHA

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"runtime"
	"strconv"
	"strings"
	"time"
)

// GitHubAPIBase GitHub API 基础路径
const GitHubAPIBase = "https://api.github.com/repos/LobbyChen/MusicLite"

// githubReleaseAsset 对应 GitHub Releases API 中的 asset 子对象
type githubReleaseAsset struct {
	Name               string `json:"name"`
	BrowserDownloadURL string `json:"browser_download_url"`
	Size               int64  `json:"size"`
}

// githubRelease 对应 GitHub Releases API 的精简响应
type githubRelease struct {
	TagName     string               `json:"tag_name"`
	Name        string               `json:"name"`
	Body        string               `json:"body"`     // Release notes（markdown）
	HTMLURL     string               `json:"html_url"` // Release 网页地址
	Prerelease  bool                 `json:"prerelease"`
	PublishedAt time.Time            `json:"published_at"`
	Assets      []githubReleaseAsset `json:"assets"`
}

// UpdateInfo 检查更新返回结构
type UpdateInfo struct {
	HasUpdate    bool   `json:"hasUpdate"`    // 是否有新版本
	CurrentVer   string `json:"currentVer"`   // 当前版本（已剥离 -dev 后缀）
	LatestVer    string `json:"latestVer"`    // 最新版本
	LatestTag    string `json:"latestTag"`    // 最新版本 tag（如 Beta0.7.1）
	ReleaseTitle string `json:"releaseTitle"` // Release 标题
	ReleaseNotes string `json:"releaseNotes"` // Release notes（markdown 原文）
	ReleaseURL   string `json:"releaseURL"`   // Release 网页地址
	DownloadURL  string `json:"downloadURL"`  // 当前平台的便携包下载地址（无则空）
	DownloadName string `json:"downloadName"` // 下载文件名（展示用）
	DownloadSize int64  `json:"downloadSize"` // 下载字节数
	PublishedAt  string `json:"publishedAt"`  // 发布时间 RFC3339
	Platform     string `json:"platform"`     // 当前平台（windows/darwin/linux）
	IsPrerelease bool   `json:"isPrerelease"`
	Error        string `json:"error"` // 检查失败时的错误信息
}

// CheckForUpdate 拉取 GitHub 最新 Release 并与当前版本比较
// 不抛出错误，错误信息放在 UpdateInfo.Error 中（前端可直接显示）
func (a *MusicService) CheckForUpdate() UpdateInfo {
	info := UpdateInfo{
		CurrentVer: stripDevSuffix(Version),
		Platform:   runtime.GOOS,
	}

	// HTTP 客户端（带超时）
	client := &http.Client{Timeout: 20 * time.Second}
	req, err := http.NewRequest("GET", GitHubAPIBase+"/releases/latest", nil)
	if err != nil {
		info.Error = fmt.Sprintf("构建请求失败: %v", err)
		return info
	}
	// 加 User-Agent（GitHub API 要求）
	req.Header.Set("User-Agent", "MusicLite/"+Version)
	req.Header.Set("Accept", "application/vnd.github+json")

	resp, err := client.Do(req)
	if err != nil {
		info.Error = fmt.Sprintf("网络请求失败: %v", err)
		return info
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		info.Error = fmt.Sprintf("GitHub API 返回 %d: %s", resp.StatusCode, truncate(string(body), 200))
		return info
	}

	var rel githubRelease
	if err := json.NewDecoder(resp.Body).Decode(&rel); err != nil {
		info.Error = fmt.Sprintf("解析响应失败: %v", err)
		return info
	}

	// 解析 tag_name 中的版本号（如 "Beta0.7.1" → "0.7.1"）
	info.LatestTag = rel.TagName
	info.LatestVer = parseVersionFromTag(rel.TagName)
	info.ReleaseTitle = rel.Name
	info.ReleaseNotes = rel.Body
	info.ReleaseURL = rel.HTMLURL
	info.IsPrerelease = rel.Prerelease
	if !rel.PublishedAt.IsZero() {
		info.PublishedAt = rel.PublishedAt.Format(time.RFC3339)
	}

	// 选取当前平台的便携包资源
	info.DownloadURL, info.DownloadName, info.DownloadSize = pickPlatformAsset(rel.Assets, runtime.GOOS)

	// 版本比较
	info.HasUpdate = compareVersion(info.LatestVer, info.CurrentVer) > 0

	return info
}

// stripDevSuffix 去掉开发版本后缀：0.7.1-dev.5.gabc1234 → 0.7.1
func stripDevSuffix(v string) string {
	if i := strings.Index(v, "-dev."); i >= 0 {
		return v[:i]
	}
	return v
}

// parseVersionFromTag 从 tag 名中提取版本号
//
//	"Beta0.7.1"  → "0.7.1"
//	"B0.7.0"     → "0.7.0"
//	"v0.7.1"     → "0.7.1"
//	"0.7.1"      → "0.7.1"
func parseVersionFromTag(tag string) string {
	if tag == "" {
		return ""
	}
	// 匹配开头非数字前缀 + 数字版本号（x.y.z 或 x.y.z.w）
	re := regexp.MustCompile(`^[A-Za-zvV]*([0-9]+\.[0-9]+\.[0-9]+(?:\.[0-9]+)?)`)
	m := re.FindStringSubmatch(tag)
	if len(m) >= 2 {
		return m[1]
	}
	return tag
}

// compareVersion 比较两个语义化版本号
//
//	返回 -1 / 0 / 1 表示 a<b / a==b / a>b
//	忽略无法解析的部分（按 0 处理）
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

// splitVersionParts 拆分版本号字符串，过滤掉非数字段（如 -dev 后缀）
func splitVersionParts(v string) []string {
	// 先剥离 -dev. 后缀
	v = stripDevSuffix(v)
	parts := strings.Split(v, ".")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		p = strings.TrimSpace(p)
		if p == "" {
			continue
		}
		// 仅保留纯数字段
		if _, err := strconv.Atoi(p); err == nil {
			out = append(out, p)
		}
	}
	return out
}

// pickPlatformAsset 为指定平台选取合适的便携包资源
//
//	Windows: 匹配 "MusicLite_B*_amd64.exe"（便携单文件，排除 Setup 安装包）
//	macOS:   匹配 "*darwin*" / "*macos*" / "*.dmg"
//	Linux:   匹配 "*linux*" / "*.deb" / "*.rpm" / "*.tar.gz"
func pickPlatformAsset(assets []githubReleaseAsset, goos string) (url, name string, size int64) {
	var patterns []string
	switch goos {
	case "windows":
		patterns = []string{
			`^MusicLite_B.*_amd64\.exe$`, // 便携包
			`^MusicLite_.*_amd64\.exe$`,  // 宽松兜底
			`^MusicLite_.*\.exe$`,        // 最宽松兜底
		}
	case "darwin":
		patterns = []string{
			`(?i).*darwin.*`,
			`(?i).*macos.*`,
			`(?i).*\.dmg$`,
		}
	default: // linux 及其他
		patterns = []string{
			`(?i).*linux.*amd64.*`,
			`(?i).*linux.*x86_64.*`,
			`(?i).*\.deb$`,
			`(?i).*\.rpm$`,
			`(?i).*linux.*\.tar\.gz$`,
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
