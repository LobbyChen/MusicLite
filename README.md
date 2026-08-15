# MusicLite Cuckoo

> 轻量级、跨平台的离线音乐播放器
> 旧分支

[![License](https://img.shields.io/badge/license-GPL-blue.svg)](./license/LICENCE.txt)
[![Wails](https://img.shields.io/badge/wails-v2-ff5722.svg)](https://wails.io/)
[![Go](https://img.shields.io/badge/go-1.21+-00ADD8.svg)](https://go.dev/)

**MusicLite Cuckoo** 是一款专注于本地播放体验的桌面音乐应用，通过 Wails v2 框架实现高性能的跨平台桌面封装。

## 核心特性

- **📝 歌词系统**：支持 LRC 格式，提供卡片/全屏双模式，多种切换动画
- **🌍 国际化 (i18n)**：支持中文/英文，翻译数据随应用分发且支持用户自定义扩展
- **💾 设置导入/导出**：一键打包 `.msclte.zip`，包含设置与字体，方便迁移
- **🔊 音量控制**：支持应用级音量合成器控制 (Windows) 与系统主音量两种模式
- **🖥️ 系统托盘**：自绘托盘菜单，支持后台播放与快速操作
- **📦 打包分享**：将曲目、封面、歌词嵌入 ID3v2 标签并复制到剪贴板
- **⏱️ 听歌统计**：记录每首歌曲的累计播放时长

## 支持的音频格式

| 格式 | 状态 |
|------|------|
| MP3  | ✅ 完整支持 |
| WAV  | ✅ 完整支持 |
| FLAC | ✅ 完整支持 |

## 许可证

本项目基于 [GNU GPL V3](.LICENSE.txt) 开源。

## 致谢

- [Wails](https://wails.io/) - 优秀的 Go 桌面框架
- [beep](https://github.com/gopxl/beep) - Go 音频处理库
- [FFTW](http://www.fftw.org/) - 快速傅里叶变换库
- [dhowden/tag](https://github.com/dhowden/tag) - 音频标签解析
