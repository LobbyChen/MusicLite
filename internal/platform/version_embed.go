package platform

import (
	_ "embed"
	"strings"
)

// version.txt 由 scripts/version.mjs 在构建前生成，格式为三行：
//
//	<version>
//	<buildSha>
//	<buildNum>
//
//go:embed version.txt
var versionFile string

func init() {
	lines := strings.Split(strings.ReplaceAll(versionFile, "\r\n", "\n"), "\n")
	if len(lines) > 0 {
		if v := strings.TrimSpace(lines[0]); v != "" {
			Version = v
		}
	}
	if len(lines) > 1 {
		if v := strings.TrimSpace(lines[1]); v != "" {
			BuildSHA = v
		}
	}
	if len(lines) > 2 {
		if v := strings.TrimSpace(lines[2]); v != "" {
			BuildNum = v
		}
	}
}
