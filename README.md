# MusicLite Cuckoo

> 轻量级、跨平台的离线音乐播放器

[![License](https://img.shields.io/badge/license-GPL-blue.svg)](./license/LICENCE.txt)
[![Wails](https://img.shields.io/badge/wails-v3-ff5722.svg)](https://wails.io/)
[![Go](https://img.shields.io/badge/go-1.21+-00ADD8.svg)](https://go.dev/)

**MusicLite Cuckoo** 是一款专注于本地播放体验的桌面音乐应用，通过 Wails v3 框架实现高性能的跨平台桌面封装。

## 核心特性

- **🎨 高度可定制 UI**：内置设计器，实时调整圆角、模糊、阴影、辉光、动画级别等视觉令牌
- **📝 歌词系统**：支持 LRC 格式，提供卡片/全屏双模式，多种切换动画
- **🗂️ 播放队列管理**：拖拽排序、洗牌、从媒体库批量添加，支持队列内直接拖放
- **⌨️ 全局快捷键**：可自定义播放/暂停、上一曲、下一曲的全局热键
- **🌍 国际化 (i18n)**：支持中文/英文，翻译数据随应用分发且支持用户自定义扩展
- **💾 设置导入/导出**：一键打包 `.msclte.zip`，包含设置与字体，方便迁移
- **🔊 音量控制**：支持应用级音量合成器控制 (Windows) 与系统主音量两种模式
- **🖥️ 系统托盘**：自绘托盘菜单，支持后台播放与快速操作
- **📦 打包分享**：将曲目、封面、歌词嵌入 ID3v2 标签并复制到剪贴板
- **⏱️ 听歌统计**：记录每首歌曲的累计播放时长
- **🪟 两种UI可选**：可选的两种UI配置

## 快速开始

### 环境要求

- Go 1.21+
- Node.js 18+
- Wails v3 CLI (`go install github.com/wailsapp/wails/v3/cmd/wails3@latest`)
- CGO 依赖：
  - **Windows**: MinGW-w64, `libfftw3-3.dll`（已随仓库提供）
  - **macOS**: `brew install fftw`
  - **Linux**: `sudo apt install libfftw3-dev libgtk-3-dev libwebkit2gtk-4.1-dev`

### 开发模式

```bash
# 安装前端依赖
cd frontend && npm install && cd ..

# 启动开发服务器
wails3 dev
```

### 构建生产版本

```bash
# Windows
compile.cmd

# macOS / Linux
wails3 build
```

构建产物位于 `build/bin/` 目录。


## 支持的音频格式

| 格式 | 状态 |
|------|------|
| MP3  | ✅ 完整支持 |
| WAV  | ✅ 完整支持 |
| FLAC | ✅ 完整支持 |

## 许可证

本项目基于 [GNU GPL V3](./license/LICENCE.txt) 开源。

## 致谢

- [Wails](https://wails.io/) - 优秀的 Go 桌面框架
- [beep](https://github.com/gopxl/beep) - Go 音频处理库
- [FFTW](http://www.fftw.org/) - 快速傅里叶变换库
- [dhowden/tag](https://github.com/dhowden/tag) - 音频标签解析