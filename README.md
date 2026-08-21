# <div align="center"> MusicLite Cuckoo </div>
<br>
<div align="center">
  <img src=".\appicon.png" alt="icon" height="100px" width="100px">
</div>
<br>
<div align="center"> 轻量级、跨平台的离线音乐播放器 </div>
<br>
<div align="center">

[![License](https://img.shields.io/badge/license-GPL-blue.svg)](./LICENSE.txt)  [![Wails](https://img.shields.io/badge/wails-v3-ff5722.svg)](https://wails.io/) [![Platforms](https://img.shields.io/badge/Platforms-Windows|Linux|MacOS-brightgreen)](#)   [![Go](https://img.shields.io/badge/go-1.21+-00ADD8.svg?logo=go)](https://go.dev/) [![Discord](https://img.shields.io/badge/discord-join-5865F2.svg?logo=discord&logoColor=white)](https://discord.gg/4WpQRwFcWf)

</div>
<div align="center">

[English](README.en.md) · [简体中文](README.md)

</div>



**MusicLite Cuckoo** 是一款专注于本地播放体验的桌面音乐应用，通过 Wails v3 框架实现高性能的跨平台桌面封装。

## 核心特性

- **🎨 高度可定制 UI**：内置设计器，实时调整圆角、模糊、阴影、辉光、动画级别等视觉令牌，支持透明模式和自定义背景图片/视频
- **📝 歌词系统**：支持 LRC 格式，提供卡片/全屏双模式，多种切换动画
- **🗂️ 播放队列管理**：拖拽排序、洗牌、从媒体库批量添加，支持队列内直接拖放
- **⌨️ 全局快捷键**：可自定义播放/暂停、上一曲、下一曲的全局热键
- **🌍 国际化 (i18n)**：支持中文/英文，翻译数据随应用分发且支持用户自定义扩展
- **💾 设置导入/导出**：一键打包 `.msclte.zip`，包含设置与字体，方便迁移
- **🔊 音量控制**：支持应用级音量合成器控制 (Windows) 与系统主音量两种模式
- **🖥️ 系统托盘**：自绘托盘菜单，支持后台播放与快速操作
- **📦 打包分享**：将曲目、封面、歌词嵌入 ID3v2 标签并复制到剪贴板
- **⏱️ 听歌统计**：记录每首歌曲的累计播放时长
- **🪟 两种UI可选**：可选的两套UI，完全不同的设计语言，彻底重写
- **⬆️ 自动更新**：可以自行进行更新

## 演示
### 传统UI中文主界面
<img src=".\example\main_old_cn.png" alt="中文主界面">

### 新UI中文主界面

<img src=".\example\main_new_cn.png" alt="中文主界面">

### 传统UI设计器

<img src=".\example\designer_old.png" alt="中文主界面">

### 新UI 半透明背景

<img src=".\example\main_translucent.png" alt="半透明新UI">

## 快速开始

### 环境要求

- Go 1.21+
- Node.js 18+
- Wails v3 CLI (`go install github.com/wailsapp/wails/v3/cmd/wails3@latest`)
- CGO 依赖：
  - **Windows**: MinGW-w64, `ffmpeg`
  - **macOS**: `brew install ffmpeg`
  - **Linux**: `sudo apt install libgtk-3-dev libwebkit2gtk-4.1-dev ffmpeg`

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


| 格式 | <= Cuckoo Beta0.6.4 支持 | > Cuckoo Beta0.6.4 支持 |
| :--- | :--- | :--- |
| MP3 | ✅ 完整支持 | ✅ 完整支持 |
| WAV | ✅ 完整支持 | ✅ 完整支持 |
| FLAC | ✅ 完整支持 | ✅ 完整支持|
| AAC | ❌ 不支持 | ✅ 完整支持|
| OGG (Vorbis) | ❌ 不支持 | ✅ 完整支持|
| OPUS | ❌ 不支持 | ✅ 完整支持 |
| WMA | ❌ 不支持 | ✅ 部分支持|
| AIFF | ❌ 不支持 | ✅ 完整支持|
| AMR | ❌ 不支持 | ✅ 完整支持|
| AC3 / E-AC3 | ❌ 不支持 | ✅ 完整支持|
| DTS | ❌ 不支持 | ✅ 完整支持|
| ALAC | ❌ 不支持 | ✅ 完整支持|
| APE | ❌ 不支持 | ✅ 仅解码支持|
| TTA | ❌ 不支持 | ✅ 仅解码支持|


## 许可证

本项目基于 [GNU GPL V3](./LICENSE.txt) 开源。

## 致谢

- [Wails](https://wails.io/) - 优秀的 Go 桌面框架
- [FFmpeg](https://ffmpeg.org/) - 开源的跨平台音视频处理框架
- [dhowden/tag](https://github.com/dhowden/tag) - 音频标签解析
