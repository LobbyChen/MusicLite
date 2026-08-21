package app

// 版本信息：由 -ldflags='-X MusicLite/app.Version=...' 在构建期注入。
// 未注入时使用兜底值，便于本地无 git tag 时直接 go build 运行。
//
// CI 与 scripts/version.{ps1,sh} 通过 git describe --tags --always 计算：
//   - 正式发布（tag v0.7.1）          → Version = "0.7.1"
//   - 开发构建（main 上的 commit）   → Version = "0.7.1-dev.5.gabc1234"
//   - 未打 tag                         → Version = "0.0.0-dev.N.gSHA"
var (
	Version  = "0.0.0-dev"
	BuildSHA = "unknown"
	BuildNum = "0"
)

// VersionInfo 供前端 bindings 直接消费的结构
type VersionInfo struct {
	Version  string `json:"version"`
	BuildSHA string `json:"buildSha"`
	BuildNum string `json:"buildNum"`
}
