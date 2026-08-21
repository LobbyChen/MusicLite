package app

// ============ 后端日志功能 ============
//
// 把标准 log 包的输出重定向到 exe 同目录的 log.txt
// 同时保留 stderr 输出（dev 模式可见）
//
// 使用方式：
//   app.InitLogger()  // 在 main.go 最早调用
//   log.Printf(...)    // 已有的 log 调用自动写入 log.txt

import (
	"io"
	"log"
	"os"
	"path/filepath"
)

// InitLogger 初始化日志输出到 log.txt
// 在 main.go 最早期调用，确保后续所有 log.Printf 都写入文件
func InitLogger() {
	exePath, err := os.Executable()
	if err != nil {
		return
	}
	exeDir := filepath.Dir(exePath)
	logPath := filepath.Join(exeDir, "log.txt")

	// 以追加模式打开（保留历史日志）
	logFile, err := os.OpenFile(logPath, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0644)
	if err != nil {
		return
	}

	// 同时输出到文件和 stderr
	log.SetOutput(io.MultiWriter(logFile, os.Stderr))
	log.SetFlags(log.LstdFlags | log.Lshortfile)
	log.Println("===== MusicLite 启动 =====")
}

// LogUpdateEvent 记录更新相关事件到日志
func LogUpdateEvent(stage string, info string) {
	log.Printf("[UPDATE] %s: %s", stage, info)
}
