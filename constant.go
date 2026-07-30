package main

import (
	"os"
	"path/filepath"
)

// constant defination file

func init() {
	filePath, _ := filepath.Abs(os.Args[0])
	rootDir = filepath.Dir(filePath)
	// 数据库固定到 exe 旁，避免拖放/命令行打开时工作目录漂移导致用错数据库
	dbFile = filepath.Join(rootDir, "msc_lite_storage.db")
}

// root path
var rootDir string

// database file（绝对路径，固定到 exe 旁）
var dbFile string

// audio folder
const audioFolder string = ""
