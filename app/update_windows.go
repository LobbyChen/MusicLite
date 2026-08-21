//go:build windows

package app

// ============ Windows 便携包自动更新（cmd 文件替换自身）============
//
// PerformUpdate 在 Windows 平台的实现：
//   1. 下载便携包（MusicLite_B*_amd64.exe）到 %TEMP%\MusicLite_update.exe
//   2. 生成 %TEMP%\MusicLite_updater.cmd：
//        - 轮询等待当前进程退出（tasklist /PID <pid>）
//        - 备份旧 exe → MusicLite.exe.bak（失败不影响）
//        - 用下载的新 exe 覆盖原 exe
//        - 启动新 exe
//        - 删除备份与 .cmd 自身
//   3. 用 cmd /c 启动该 .cmd（detached），返回前端
//   4. 前端收到返回后调用 Quit() 退出主进程；.cmd 接管完成替换
//
// 失败时返回 error，前端展示错误信息。

import (
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

// PerformUpdate Windows 平台：下载便携包并通过 .cmd 文件替换自己后重启
// info 由前端传入（来自 CheckForUpdate 的结果），也可为 nil 时重新检查
func (a *MusicService) PerformUpdate(info UpdateInfo) error {
	if info.DownloadURL == "" {
		return fmt.Errorf("没有可用的 Windows 便携包下载地址")
	}
	if info.LatestVer == "" {
		return fmt.Errorf("缺少版本号信息")
	}

	// 1. 获取当前 exe 路径
	exePath, err := os.Executable()
	if err != nil {
		return fmt.Errorf("无法获取当前可执行文件路径: %w", err)
	}
	exePath, _ = filepath.Abs(exePath)
	exeDir := filepath.Dir(exePath)

	// 2. 下载新 exe 到临时文件
	tempDir := os.Getenv("TEMP")
	if tempDir == "" {
		tempDir = os.TempDir()
	}
	newExePath := filepath.Join(tempDir, "MusicLite_update.exe")
	if err := downloadFile(info.DownloadURL, newExePath); err != nil {
		return fmt.Errorf("下载更新包失败: %w", err)
	}
	// 校验：下载文件不能为空
	if st, err := os.Stat(newExePath); err != nil || st.Size() == 0 {
		return fmt.Errorf("下载的更新包无效或为空")
	}

	// 3. 当前进程 PID
	pid := os.Getpid()

	// 4. 生成 .cmd 文件
	cmdPath := filepath.Join(tempDir, "MusicLite_updater.cmd")
	cmdContent := buildWindowsUpdaterCMD(exePath, newExePath, pid)
	if err := os.WriteFile(cmdPath, []byte(cmdContent), 0644); err != nil {
		return fmt.Errorf("写入更新脚本失败: %w", err)
	}

	// 5. detached 启动 .cmd（不阻塞当前进程退出）
	cmd := exec.Command("cmd", "/c", "start", "\"\"", "/b", cmdPath)
	// CREATE_NEW_PROCESS_GROUP | DETACHED_PROCESS：脱离父进程
	cmd.SysProcAttr = &syscall.SysProcAttr{
		CreationFlags: 0x00000008 | 0x00000200, // DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP
		HideWindow:    true,
	}
	cmd.Stdin = nil
	cmd.Stdout = nil
	cmd.Stderr = nil
	if err := cmd.Start(); err != nil {
		return fmt.Errorf("启动更新脚本失败: %w", err)
	}

	// 后续由前端调用 Quit() 退出主进程，.cmd 轮询到 PID 消失后接管替换
	_ = exeDir // 保留目录引用，未来可能需要清理
	return nil
}

// downloadFile 下载 URL 到本地文件（覆盖写入）
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

// buildWindowsUpdaterCMD 生成 Windows 更新脚本
//
// 脚本逻辑：
//  1. timeout 1 秒（让原进程有时间响应退出请求）
//  2. 轮询 tasklist /PID <pid>，直到进程消失（最多 30 次）
//  3. 备份旧 exe → .bak
//  4. copy /Y 新 exe → 旧 exe 路径
//  5. 启动新 exe
//  6. 删除备份（延迟 1 秒）与 .cmd 自身
//
// 使用 chcp 65001 切换 UTF-8，避免中文路径乱码
func buildWindowsUpdaterCMD(exePath, newExePath string, pid int) string {
	// 用 \\\\?\\ 前缀绕过 MAX_PATH 限制并支持特殊字符（cmd copy 支持）
	exeQuoted := "\"" + exePath + "\""
	newQuoted := "\"" + newExePath + "\""
	bakQuoted := "\"" + exePath + ".bak\""

	var b strings.Builder
	b.WriteString("@echo off\r\n")
	b.WriteString("chcp 65001 > nul\r\n")
	b.WriteString("setlocal\r\n\r\n")

	// 等待原进程退出
	b.WriteString(fmt.Sprintf("rem waiting for PID %d to exit\r\n", pid))
	b.WriteString("set /a tries=0\r\n")
	b.WriteString(":waitloop\r\n")
	b.WriteString(fmt.Sprintf("tasklist /FI \"PID eq %d\" 2>nul | find \"%d\" >nul\r\n", pid, pid))
	b.WriteString("if errorlevel 1 goto :proceed\r\n")
	b.WriteString("set /a tries+=1\r\n")
	b.WriteString("if %tries% GEQ 60 goto :forcekill\r\n")
	b.WriteString("timeout /t 1 /nobreak > nul\r\n")
	b.WriteString("goto :waitloop\r\n\r\n")

	// 强杀兜底
	b.WriteString(":forcekill\r\n")
	b.WriteString(fmt.Sprintf("taskkill /F /PID %d >nul 2>&1\r\n", pid))
	b.WriteString("timeout /t 1 /nobreak > nul\r\n\r\n")

	// 备份 + 替换 + 启动
	b.WriteString(":proceed\r\n")
	b.WriteString("echo Updating MusicLite...\r\n")
	// 备份旧 exe（失败也继续）
	b.WriteString(fmt.Sprintf("copy /Y %s %s >nul 2>&1\r\n", exeQuoted, bakQuoted))
	// 覆盖为新 exe（最多重试 5 次）
	b.WriteString("set /a copytries=0\r\n")
	b.WriteString(":copyloop\r\n")
	b.WriteString(fmt.Sprintf("copy /Y %s %s >nul 2>&1\r\n", newQuoted, exeQuoted))
	b.WriteString("if errorlevel 1 (\r\n")
	b.WriteString("  set /a copytries+=1\r\n")
	b.WriteString("  if %copytries% LSS 5 (\r\n")
	b.WriteString("    timeout /t 1 /nobreak > nul\r\n")
	b.WriteString("    goto :copyloop\r\n")
	b.WriteString("  )\r\n")
	b.WriteString("  echo Update failed: cannot replace exe.\r\n")
	b.WriteString("  goto :cleanup\r\n")
	b.WriteString(")\r\n\r\n")

	// 启动新 exe（不阻塞 .cmd 退出）
	b.WriteString("echo Starting new version...\r\n")
	b.WriteString(fmt.Sprintf("start \"\" %s\r\n\r\n", exeQuoted))

	// 清理
	b.WriteString(":cleanup\r\n")
	b.WriteString(fmt.Sprintf("del /F /Q %s >nul 2>&1\r\n", newQuoted))
	b.WriteString("timeout /t 2 /nobreak > nul\r\n")
	b.WriteString(fmt.Sprintf("del /F /Q %s >nul 2>&1\r\n", bakQuoted))
	// 自删除：用 (goto) 2>nul & del 技巧
	b.WriteString("(goto) 2>nul & del \"%~f0\"\r\n")
	b.WriteString("endlocal\r\n")
	b.WriteString("exit /b 0\r\n")

	return b.String()
}
