package app

// ============ 打包分享功能（跨平台）============
//
// 用户右键点击"打包分享"后：
// 0. 在 %TEMP%/<歌曲名称>_LiteShare.mp3 创建新文件
// 1. 读取原文件音频写入新文件
// 2. 将 Cover 图片和 LRC 歌词写入新文件的 ID3v2.4 标签（见 app/share 包）
// 3. 将新文件路径写入系统剪贴板（各平台实现见 share_windows.go / share_notwindows.go）
// 4. 前端显示"已生成分享并复制到剪贴板"提示

import (
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strconv"

	"MusicLite/app/share"
)

// PackShare 打包分享：读取曲目音频，写入封面和歌词标签，复制到剪贴板
// 剪贴板写入逻辑按平台分派：
//   - Windows:   CF_HDROP (share_windows.go)
//   - macOS:     AppleScript + NSPasteboard (share_notwindows.go)
//   - Linux:     xclip / wl-copy (share_notwindows.go)
func (a *MusicService) PackShare(id int64) error {
	rec, err := a.database.GetTrackByID(id)
	if err != nil {
		return fmt.Errorf("获取曲目失败: %w", err)
	}

	origData, err := os.ReadFile(rec.FilePath)
	if err != nil {
		return fmt.Errorf("读取音频文件失败: %w", err)
	}

	coverData, coverMIME, _ := a.database.GetTrackCover(strconv.FormatInt(id, 10))
	lyrics := rec.Lyrics

	audioData := share.StripID3v2(origData)
	tag := share.BuildID3v2Tag(rec.Title, rec.Artist, coverData, coverMIME, lyrics)
	output := append(tag, audioData...)

	safeTitle := share.SanitizeFilename(rec.Title)
	if safeTitle == "" {
		safeTitle = "track"
	}
	tempDir := os.Getenv("TEMP")
	if tempDir == "" {
		tempDir = os.TempDir()
	}
	outPath := filepath.Join(tempDir, safeTitle+"_LiteShare.mp3")

	if err := os.WriteFile(outPath, output, 0644); err != nil {
		return fmt.Errorf("写入分享文件失败: %w", err)
	}

	log.Printf("[Share] 已生成分享文件: %s (tag=%d bytes, audio=%d bytes)", outPath, len(tag), len(audioData))

	if err := setClipboardFilesGo(outPath); err != nil {
		return fmt.Errorf("文件已生成但剪贴板写入失败: %w", err)
	}

	return nil
}
