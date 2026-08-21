//go:build windows

package app

// ============ Windows 便携包自动更新（自替换 + 单实例接管）============
//
// 更新流程（无需 .cmd 脚本）：
//   1. 从已下载的更新包中提取 MusicLite.exe 到临时位置
//   2. 解压更新包中除 exe 外的所有文件到当前 exe 所在目录
//   3. 把自己（当前运行的 exe）重命名为 xxx.exe~
//      （Windows 允许重命名运行中的 exe，但不允许删除）
//   4. 把新 exe 移动到原 exe 路径
//   5. 启动新 exe（通过原路径）
//      新实例的单实例机制会通知旧实例退出，旧实例 os.Exit(0)
//   6. 下次启动时检测并删除所有 .exe~ 文件（CleanupOldExeBackups）

import (
	"archive/zip"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
	"time"
)

// PerformUpdate Windows 平台：下载便携包并自替换
func (a *MusicService) PerformUpdate(info UpdateInfo) error {
	if info.DownloadURL == "" {
		return fmt.Errorf("没有可用的 Windows 便携包下载地址")
	}

	tempDir := os.Getenv("TEMP")
	if tempDir == "" {
		tempDir = os.TempDir()
	}
	downloadName := info.DownloadName
	if downloadName == "" {
		downloadName = "MusicLite_update.zip"
	}
	downloadPath := filepath.Join(tempDir, "MusicLite_update"+filepath.Ext(downloadName))

	if err := downloadFile(info.DownloadURL, downloadPath); err != nil {
		return fmt.Errorf("下载更新包失败: %w", err)
	}
	return a.applyDownloadedFile(downloadPath)
}

// applyDownloadedFile Windows 平台：自替换更新
// downloadedPath: 已下载的更新包路径（.zip 或 .exe）
func (a *MusicService) applyDownloadedFile(downloadedPath string) error {
	// 1. 获取当前 exe 路径和所在目录
	exePath, err := os.Executable()
	if err != nil {
		return fmt.Errorf("无法获取当前可执行文件路径: %w", err)
	}
	exePath, _ = filepath.Abs(exePath)
	LogUpdateEvent("applyDownloadedFile", fmt.Sprintf("exePath=%s, downloadedPath=%s", exePath, downloadedPath))

	tempDir := os.Getenv("TEMP")
	if tempDir == "" {
		tempDir = os.TempDir()
	}
	newExeTempPath := filepath.Join(tempDir, "MusicLite_new.exe")

	// 2. 处理已下载的文件
	lower := strings.ToLower(filepath.Ext(downloadedPath))
	if lower == ".zip" {
		// 从 zip 中提取 exe 到临时位置
		if err := extractExeFromZipToPath(downloadedPath, newExeTempPath); err != nil {
			return fmt.Errorf("提取新 exe 失败: %w", err)
		}
		LogUpdateEvent("extractExe", fmt.Sprintf("新 exe 已提取到 %s", newExeTempPath))
		// 解压 zip 中除 exe 外的所有文件到当前 exe 所在目录
		if err := extractAllExceptExeFromZip(downloadedPath, filepath.Dir(exePath)); err != nil {
			return fmt.Errorf("解压更新文件失败: %w", err)
		}
		LogUpdateEvent("extractFiles", "非 exe 文件已解压到当前目录")
	} else if lower == ".exe" {
		if err := copyFile(downloadedPath, newExeTempPath); err != nil {
			return fmt.Errorf("复制新 exe 失败: %w", err)
		}
	} else {
		return fmt.Errorf("不支持的更新包格式: %s", filepath.Ext(downloadedPath))
	}

	// 3. 把自己重命名为 xxx.exe~
	// Windows 允许重命名运行中的 exe（只是不能删除）
	backupPath := exePath + "~"
	os.Remove(backupPath) // 清理上一次遗留的备份
	LogUpdateEvent("renameOldExe", fmt.Sprintf("rename %s -> %s", exePath, backupPath))
	if err := os.Rename(exePath, backupPath); err != nil {
		// rename 失败（可能被杀软/WebView2 锁定）
		// 回退方案：用 copy 覆盖旧 exe，旧 exe 保留在原位（下次启动时 CleanupOldExeBackups 无法清理，但至少能更新）
		LogUpdateEvent("renameOldExe", fmt.Sprintf("rename 失败: %v，尝试 copy 覆盖", err))
		if err := copyFile(newExeTempPath, exePath); err != nil {
			return fmt.Errorf("覆盖旧 exe 失败（rename 和 copy 均失败）: %w", err)
		}
		LogUpdateEvent("copyOverwrite", "已用 copy 覆盖旧 exe")
		// copy 成功，删除临时新 exe
		os.Remove(newExeTempPath)
	} else {
		// 4. rename 成功，把新 exe 移动到原 exe 路径
		LogUpdateEvent("moveNewExe", fmt.Sprintf("rename %s -> %s", newExeTempPath, exePath))
		if err := os.Rename(newExeTempPath, exePath); err != nil {
			// move 失败，尝试 copy
			LogUpdateEvent("moveNewExe", fmt.Sprintf("rename 失败: %v，尝试 copy", err))
			if err := copyFile(newExeTempPath, exePath); err != nil {
				os.Rename(backupPath, exePath) // 尝试恢复
				return fmt.Errorf("移动新 exe 失败: %w", err)
			}
			os.Remove(newExeTempPath)
		}
	}

	// 5. 启动新 exe（单实例机制会让旧实例自行退出）
	LogUpdateEvent("startNewExe", fmt.Sprintf("启动 %s", exePath))
	cmd := exec.Command(exePath)
	cmd.SysProcAttr = &syscall.SysProcAttr{
		CreationFlags: 0x00000008 | 0x00000200, // DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP
		HideWindow:    true,
	}
	cmd.Stdin = nil
	cmd.Stdout = nil
	cmd.Stderr = nil
	if err := cmd.Start(); err != nil {
		return fmt.Errorf("启动新 exe 失败: %w", err)
	}
	LogUpdateEvent("startNewExe", "新 exe 已启动，等待单实例接管")

	// 清理下载的压缩包
	os.Remove(downloadedPath)

	return nil
}

// extractExeFromZipToPath 从 zip 中查找 exe 并提取到指定路径
// 查找规则：优先 MusicLite.exe，否则任意 .exe
func extractExeFromZipToPath(zipPath, targetPath string) error {
	r, err := zip.OpenReader(zipPath)
	if err != nil {
		return err
	}
	defer r.Close()

	tryMatch := func(match func(name string) bool) bool {
		for _, f := range r.File {
			if f.FileInfo().IsDir() {
				continue
			}
			if match(filepath.Base(f.Name)) {
				out, err := os.Create(targetPath)
				if err != nil {
					return false
				}
				rc, err := f.Open()
				if err != nil {
					out.Close()
					return false
				}
				_, err = io.Copy(out, rc)
				rc.Close()
				out.Close()
				return err == nil
			}
		}
		return false
	}

	// 第一轮：精确匹配 MusicLite.exe
	if tryMatch(func(base string) bool {
		return strings.EqualFold(base, "MusicLite.exe")
	}) {
		return nil
	}
	// 第二轮：任意 .exe
	if tryMatch(func(base string) bool {
		return strings.EqualFold(filepath.Ext(base), ".exe")
	}) {
		return nil
	}
	return fmt.Errorf("zip 中找不到 exe 文件")
}

// extractAllExceptExeFromZip 解压 zip 中除 exe 外的所有文件到 destDir
func extractAllExceptExeFromZip(zipPath, destDir string) error {
	r, err := zip.OpenReader(zipPath)
	if err != nil {
		return err
	}
	defer r.Close()

	for _, f := range r.File {
		if f.FileInfo().IsDir() {
			os.MkdirAll(filepath.Join(destDir, f.Name), 0755)
			continue
		}

		base := filepath.Base(f.Name)
		// 跳过所有 .exe 文件（已单独提取）
		if strings.EqualFold(filepath.Ext(base), ".exe") {
			continue
		}

		target := filepath.Join(destDir, f.Name)
		os.MkdirAll(filepath.Dir(target), 0755)

		out, err := os.Create(target)
		if err != nil {
			continue // 文件被占用，跳过
		}
		rc, err := f.Open()
		if err != nil {
			out.Close()
			continue
		}
		io.Copy(out, rc)
		rc.Close()
		out.Close()
	}
	return nil
}

// copyFile 复制文件
func copyFile(src, dst string) error {
	srcFile, err := os.Open(src)
	if err != nil {
		return err
	}
	defer srcFile.Close()

	dstFile, err := os.Create(dst)
	if err != nil {
		return err
	}
	defer dstFile.Close()

	_, err = io.Copy(dstFile, srcFile)
	return err
}

// downloadFile 下载 URL 到本地文件
func downloadFile(url, destPath string) error {
	client := &http.Client{Timeout: 10 * time.Minute}
	req, err := http.NewRequest("GET", url, nil)
	if err != nil {
		return err
	}
	req.Header.Set("User-Agent", "MusicLite/"+Version)

	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("HTTP %d", resp.StatusCode)
	}

	out, err := os.Create(destPath)
	if err != nil {
		return err
	}
	defer out.Close()

	_, err = io.Copy(out, resp.Body)
	return err
}
