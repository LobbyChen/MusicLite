package main

import (
	"archive/zip"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/wailsapp/wails/v2/pkg/runtime"
	"golang.org/x/sys/windows/registry"
)

// ============ 设置导出/导入（.msclte.zip） ============
//
// 导出格式：ZIP 包含
//   settings.json — 当前 Settings 结构
//   fonts.json    — { "FontName": "base64编码的字体文件数据", ... }
//
// 导入时：解压 → 应用 settings → 将字体文件写入用户字体目录并注册到注册表

// ExportSettings 导出当前设置为 .msclte.zip 文件
// 包含 settings.json + 当前所用字体的 base64 编码数据
func (a *App) ExportSettings() (string, error) {
	strs := a.getBackendStrings()
	// 1. 获取当前设置
	s := a.LoadSettings()

	// 2. 收集需要导出的字体名
	fontNames := collectFontNamesFromSettings(s)

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
	savePath, err := runtime.SaveFileDialog(a.ctx, runtime.SaveDialogOptions{
		Title:           strs.ExportSettings,
		DefaultFilename: "my-settings.msclte.zip",
		Filters: []runtime.FileFilter{
			{DisplayName: strs.SettingsFilter, Pattern: "*.msclte.zip"},
		},
	})
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
	settingsJSON, _ := json.MarshalIndent(s, "", "  ")
	if err := addZipEntry(zipWriter, "settings.json", settingsJSON); err != nil {
		return "", err
	}

	// 写入 fonts.json
	fontsJSON, _ := json.MarshalIndent(fontsData, "", "  ")
	if err := addZipEntry(zipWriter, "fonts.json", []byte(fontsJSON)); err != nil {
		return "", err
	}

	// 写入 manifest.json（版本信息）
	manifest := map[string]interface{}{
		"version":    1,
		"app":        "MusicLite",
		"font_count": len(fontsData),
		"exported_at": time.Now().Format("2006-01-02 15:04:05"),
	}
	manifestJSON, _ := json.MarshalIndent(manifest, "", "  ")
	if err := addZipEntry(zipWriter, "manifest.json", manifestJSON); err != nil {
		return "", err
	}

	return savePath, nil
}

// ImportSettings 从 .msclte.zip 文件导入设置
// 返回导入后的新设置，前端可直接应用
func (a *App) ImportSettings() (Settings, error) {
	strs := a.getBackendStrings()
	// 1. 弹出打开对话框
	openPath, err := runtime.OpenFileDialog(a.ctx, runtime.OpenDialogOptions{
		Title: strs.ImportSettings,
		Filters: []runtime.FileFilter{
			{DisplayName: strs.SettingsFilter, Pattern: "*.msclte.zip;*.zip"},
		},
	})
	if err != nil || openPath == "" {
		return a.LoadSettings(), err
	}

	// 2. 读取 ZIP 文件
	zipReader, err := zip.OpenReader(openPath)
	if err != nil {
		return Settings{}, fmt.Errorf("打开设置包失败: %w", err)
	}
	defer zipReader.Close()

	var newSettings Settings
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
				return Settings{}, fmt.Errorf("解析 settings.json 失败: %w", err)
			}
		case "fonts.json":
			_ = json.Unmarshal(content, &fontsData) // 字体可选，解析失败不阻断
		}
	}

	// 3. 安装字体文件
	for fontName, b64data := range fontsData {
		if err := installFontFromBase64(fontName, b64data); err != nil {
			log.Printf("安装字体 %s 失败: %v", fontName, err)
		}
	}

	// 4. 保留 last_track_id 和 last_position（导入设置不应覆盖播放状态）
	current := a.LoadSettings()
	newSettings.LastTrackID = current.LastTrackID
	newSettings.LastPosition = current.LastPosition

	// 5. 保存并返回
	if err := a.SaveSettings(newSettings); err != nil {
		return Settings{}, fmt.Errorf("保存设置失败: %w", err)
	}

	return newSettings, nil
}

// ============ 辅助函数 ============

// addZipEntry 向 ZIP 写入一个文件条目
func addZipEntry(w *zip.Writer, name string, data []byte) error {
	f, err := w.Create(name)
	if err != nil {
		return err
	}
	_, err = f.Write(data)
	return err
}

// collectFontNamesFromSettings 从设置中提取需要导出的字体名
// 跳过通用字体族（system-ui, sans-serif, serif, monospace 等）
func collectFontNamesFromSettings(s Settings) []string {
	skip := map[string]bool{
		"system-ui": true, "sans-serif": true, "serif": true,
		"monospace": true, "cursive": true, "fantasy": true,
	}
	var names []string

	for _, fontVal := range []string{s.PlayerFont, s.LyricsFont} {
		// 解析字体值：去掉引号，取第一个字体名
		clean := strings.TrimSpace(fontVal)
		clean = strings.Trim(clean, "'\"")
		// 按逗号分割，取每段第一个字体名
		parts := strings.Split(clean, ",")
		for _, p := range parts {
			name := strings.TrimSpace(p)
			name = strings.Trim(name, "'\"")
			if name == "" || skip[strings.ToLower(name)] {
				continue
			}
			// 去重
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

// readFontFileBase64 根据字体名查找字体文件路径，读取并返回 base64 编码
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

// findFontFilePath 在注册表中查找字体名对应的字体文件路径
// 返回完整路径（通常在 C:\Windows\Fonts\ 下）
func findFontFilePath(fontName string) (string, error) {
	// 在注册表中搜索匹配的字体条目
	for _, root := range []registry.Key{registry.LOCAL_MACHINE, registry.CURRENT_USER} {
		path, ok := searchFontInRegistry(root, `SOFTWARE\Microsoft\Windows NT\CurrentVersion\Fonts`, fontName)
		if ok {
			return path, nil
		}
	}
	return "", fmt.Errorf("字体 %s 未在注册表中找到", fontName)
}

// searchFontInRegistry 在指定注册表路径中搜索字体文件
func searchFontInRegistry(root registry.Key, regPath, targetName string) (string, bool) {
	k, err := registry.OpenKey(root, regPath, registry.QUERY_VALUE)
	if err != nil {
		return "", false
	}
	defer k.Close()

	names, err := k.ReadValueNames(0)
	if err != nil {
		return "", false
	}

	targetLower := strings.ToLower(targetName)
	for _, name := range names {
		// 键名格式: "Microsoft YaHei (TrueType)" → 字体名 = "Microsoft YaHei"
		clean := name
		if i := strings.LastIndex(clean, " ("); i > 0 {
			clean = clean[:i]
		}
		// 按 & 或 , 拆分多个字体族名
		parts := strings.FieldsFunc(clean, func(r rune) bool {
			return r == '&' || r == ','
		})
		for _, p := range parts {
			p = strings.TrimSpace(p)
			if strings.ToLower(p) == targetLower {
				// 读取值（字体文件名）
				val, _, err := k.GetStringValue(name)
				if err != nil {
					continue
				}
				// val 可能是 "msyh.ttc" 或绝对路径
				fullPath := val
				if !filepath.IsAbs(val) {
					fullPath = filepath.Join(os.Getenv("WINDIR"), "Fonts", val)
				}
				if _, err := os.Stat(fullPath); err == nil {
					return fullPath, true
				}
			}
		}
	}
	return "", false
}

// installFontFromBase64 将 base64 编码的字体文件安装到用户字体目录
// Windows: 复制到 %LOCALAPPDATA%\Microsoft\Windows\Fonts\ 并注册到 HKCU 注册表
func installFontFromBase64(fontName, b64data string) error {
	data, err := base64.StdEncoding.DecodeString(b64data)
	if err != nil {
		return fmt.Errorf("base64 解码失败: %w", err)
	}

	// 用户字体目录
	localAppData := os.Getenv("LOCALAPPDATA")
	if localAppData == "" {
		return fmt.Errorf("无法获取 LOCALAPPDATA")
	}
	userFontsDir := filepath.Join(localAppData, "Microsoft", "Windows", "Fonts")
	os.MkdirAll(userFontsDir, 0755)

	// 根据字体名生成文件名（尝试常见扩展名）
	// 实际扩展名未知，统一用 .ttf 作为默认；如果已有同名 .ttc/.otf 则覆盖
	fileName := sanitizeFileName(fontName) + ".ttf"
	destPath := filepath.Join(userFontsDir, fileName)

	// 写入字体文件
	if err := os.WriteFile(destPath, data, 0644); err != nil {
		return fmt.Errorf("写入字体文件失败: %w", err)
	}

	// 注册到 HKCU 注册表
	regPath := `SOFTWARE\Microsoft\Windows NT\CurrentVersion\Fonts`
	k, _, err := registry.CreateKey(registry.CURRENT_USER, regPath, registry.SET_VALUE|registry.QUERY_VALUE)
	if err != nil {
		return fmt.Errorf("打开注册表失败: %w", err)
	}
	defer k.Close()

	regValueName := fontName + " (TrueType)"
	if err := k.SetStringValue(regValueName, destPath); err != nil {
		return fmt.Errorf("注册字体失败: %w", err)
	}

	// 通知系统字体变化（广播 WM_FONTCHANGE）
	broadcastFontChange()

	log.Printf("字体 %s 已安装到 %s", fontName, destPath)
	return nil
}

// sanitizeFileName 将字体名转换为安全的文件名
func sanitizeFileName(name string) string {
	replacer := strings.NewReplacer(" ", "_", "/", "_", "\\", "_", ":", "_", "*", "_", "?", "_", "\"", "_", "<", "_", ">", "_", "|", "_")
	return replacer.Replace(name)
}
