package app

import (
	"os"
	"path/filepath"
	"runtime"
)

// constant defination file

func init() {
	// 数据库路径策略：
	// 1. 优先检查 exe 旁是否已有数据库（兼容老用户，便携模式）
	// 2. 否则使用跨平台用户数据目录（推荐，避免权限问题）
	exePath, _ := os.Executable()
	exePath, _ = filepath.Abs(exePath)
	RootDir = filepath.Dir(exePath)
	portableDB := filepath.Join(RootDir, "msc_lite_storage.db")

	if _, err := os.Stat(portableDB); err == nil {
		// 便携模式：exe 旁已有数据库，沿用之
		DBFile = portableDB
	} else {
		// 标准模式：使用跨平台用户数据目录
		dataDir := filepath.Join(getUserDataDir(), "MusicLite")
		os.MkdirAll(dataDir, 0755)
		DBFile = filepath.Join(dataDir, "msc_lite_storage.db")
	}

	// 确保 getUserDataDir 即使在 settings 未初始化时也可用
	_ = runtime.GOOS
}

// root path (exe 所在目录，用于便携模式检测)
var RootDir string

// database file（绝对路径）
var DBFile string
