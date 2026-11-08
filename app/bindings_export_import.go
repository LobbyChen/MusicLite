package app

import (
	"archive/zip"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"os"
	"strings"
	"time"

	"MusicLite/internal/settings"

	"github.com/wailsapp/wails/v3/pkg/application"
)

// ============ 设置导出/导入（.msclte.zip） ============
//
// 导出格式：ZIP 包含
//   settings.json — 当前 Settings 结构
//   fonts.json    — { "FontName": "base64编码的字体文件数据", ... }
//   manifest.json — 版本信息
//
// 导入时：解压 → 安装字体 → 应用 settings。

// ExportSettings 导出当前设置为 .msclte.zip 文件，包含 settings.json + 当前所用字体的 base64 数据。
func (s *MusicService) ExportSettings() (string, error) {
	strs := s.getBackendStrings()
	// 1. 获取当前设置
	cur := s.LoadSettings()

	// 2. 收集需要导出的字体名
	fontNames := collectFontNamesFromSettings(cur)

	// 3. 读取字体文件并 base64 编码
	fontsData := make(map[string]string)
	for _, name := range fontNames {
		data, err := readFontFileBase64(name)
		if err != nil {
			log.Printf("跳过字体 %s: %v", name, err)
			continue
		}
		if data != "" {
			fontsData[name] = data
		}
	}

	// 4. 弹出保存对话框
	savePath, err := s.app.Dialog.SaveFileWithOptions(&application.SaveFileDialogOptions{
		Title:    strs.ExportSettings,
		Filename: "my-settings.msclte.zip",
		Filters: []application.FileFilter{
			{DisplayName: strs.SettingsFilter, Pattern: "*.msclte.zip"},
		},
	}).PromptForSingleSelection()
	if err != nil || savePath == "" {
		return "", err
	}

	// 5. 创建 ZIP 文件
	zipFile, err := os.Create(savePath)
	if err != nil {
		return "", fmt.Errorf("创建文件失败: %w", err)
	}
	defer zipFile.Close()

	zipWriter := zip.NewWriter(zipFile)
	defer zipWriter.Close()

	// 写入 settings.json
	settingsJSON, _ := json.MarshalIndent(cur, "", "  ")
	if err := addZipEntry(zipWriter, "settings.json", settingsJSON); err != nil {
		return "", err
	}

	// 写入 fonts.json
	fontsJSON, _ := json.MarshalIndent(fontsData, "", "  ")
	if err := addZipEntry(zipWriter, "fonts.json", fontsJSON); err != nil {
		return "", err
	}

	// 写入 manifest.json（版本信息）
	manifest := map[string]interface{}{
		"version":     1,
		"app":         "MusicLite",
		"font_count":  len(fontsData),
		"exported_at": time.Now().Format("2006-01-02 15:04:05"),
	}
	manifestJSON, _ := json.MarshalIndent(manifest, "", "  ")
	if err := addZipEntry(zipWriter, "manifest.json", manifestJSON); err != nil {
		return "", err
	}

	return savePath, nil
}

// ImportSettings 从 .msclte.zip 文件导入设置，返回导入后的新设置供前端直接应用。
func (s *MusicService) ImportSettings() (settings.Settings, error) {
	strs := s.getBackendStrings()
	// 1. 弹出打开对话框
	openPath, err := s.app.Dialog.OpenFileWithOptions(&application.OpenFileDialogOptions{
		Title: strs.ImportSettings,
		Filters: []application.FileFilter{
			{DisplayName: strs.SettingsFilter, Pattern: "*.msclte.zip;*.zip"},
		},
	}).PromptForSingleSelection()
	if err != nil {
		return settings.Settings{}, err
	}
	if openPath == "" {
		// 用户取消：返回零值设置（前端据此跳过应用，避免误报导入成功）
		return settings.Settings{}, nil
	}

	// 2. 读取 ZIP 文件
	zipReader, err := zip.OpenReader(openPath)
	if err != nil {
		return settings.Settings{}, fmt.Errorf("打开设置包失败: %w", err)
	}
	defer zipReader.Close()

	var newSettings settings.Settings
	fontsData := make(map[string]string)

	for _, file := range zipReader.File {
		rc, err := file.Open()
		if err != nil {
			continue
		}
		content, err := io.ReadAll(rc)
		rc.Close()
		if err != nil {
			continue
		}

		switch file.Name {
		case "settings.json":
			if err := json.Unmarshal(content, &newSettings); err != nil {
				return settings.Settings{}, fmt.Errorf("解析 settings.json 失败: %w", err)
			}
		case "fonts.json":
			_ = json.Unmarshal(content, &fontsData) // 字体可选，解析失败不阻断
		}
	}

	// 3. 安装字体文件
	for fontName, b64data := range fontsData {
		if len(b64data) > 10*1024*1024 { // 10MB 上限
			log.Printf("字体 %s 数据过大 (%d bytes)，跳过", fontName, len(b64data))
			continue
		}
		if err := installFontFromBase64(fontName, b64data); err != nil {
			log.Printf("安装字体 %s 失败: %v", fontName, err)
		}
	}

	// 4. 保留播放状态（导入设置不应覆盖 last_track_id / last_position）
	current := s.LoadSettings()
	newSettings.LastTrackID = current.LastTrackID
	newSettings.LastPosition = current.LastPosition

	// 5. 保存并返回
	if err := s.SaveSettings(newSettings); err != nil {
		return settings.Settings{}, fmt.Errorf("保存设置失败: %w", err)
	}

	return newSettings, nil
}

// ============ 辅助函数 ============

// addZipEntry 向 ZIP 写入一个文件条目。
func addZipEntry(w *zip.Writer, name string, data []byte) error {
	f, err := w.Create(name)
	if err != nil {
		return err
	}
	_, err = f.Write(data)
	return err
}

// collectFontNamesFromSettings 从设置中提取需要导出的字体名，跳过通用字体族。
func collectFontNamesFromSettings(s settings.Settings) []string {
	skip := map[string]bool{
		"system-ui": true, "sans-serif": true, "serif": true,
		"monospace": true, "cursive": true, "fantasy": true,
	}
	var names []string

	for _, fontVal := range []string{s.PlayerFont, s.LyricsFont} {
		clean := strings.TrimSpace(fontVal)
		clean = strings.Trim(clean, "'\"")
		parts := strings.Split(clean, ",")
		for _, p := range parts {
			name := strings.TrimSpace(p)
			name = strings.Trim(name, "'\"")
			if name == "" || skip[strings.ToLower(name)] {
				continue
			}
			found := false
			for _, n := range names {
				if n == name {
					found = true
					break
				}
			}
			if !found {
				names = append(names, name)
			}
		}
	}
	return names
}

// readFontFileBase64 根据字体名查找字体文件路径，读取并返回 base64 编码。
func readFontFileBase64(fontName string) (string, error) {
	filePath, err := findFontFilePath(fontName)
	if err != nil || filePath == "" {
		return "", err
	}
	data, err := os.ReadFile(filePath)
	if err != nil {
		return "", err
	}
	return base64.StdEncoding.EncodeToString(data), nil
}

// sanitizeFileName 将字体名转换为安全的文件名（跨平台通用实现）。
func sanitizeFileName(name string) string {
	replacer := strings.NewReplacer(
		" ", "_", "/", "_", "\\", "_", ":", "_", "*", "_",
		"?", "_", "\"", "_", "<", "_", ">", "_", "|", "_",
	)
	return replacer.Replace(name)
}
