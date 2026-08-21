# MusicLite Cuckoo

> Lightweight, cross-platform offline music player

<div align="center">

[![License](https://img.shields.io/badge/license-GPL-blue.svg)](./LICENSE.txt)  [![Wails](https://img.shields.io/badge/wails-v3-ff5722.svg)](https://wails.io/) [![Platforms](https://img.shields.io/badge/Platforms-Windows|Linux|MacOS-brightgreen)](#)   [![Go](https://img.shields.io/badge/go-1.21+-00ADD8.svg?logo=go)](https://go.dev/) [![Discord](https://img.shields.io/badge/discord-join-5865F2.svg?logo=discord&logoColor=white)](https://discord.gg/4WpQRwFcWf)

</div>
<div align="center">

[English](README.en.md) · [简体中文](README.md)

</div>

**MusicLite Cuckoo** is a desktop music application focused on local playback experience, powered by the Wails v3 framework for high-performance cross-platform desktop packaging.

## Core Features

- **🎨 Highly Customizable UI**: Built-in designer for real-time adjustment of visual tokens such as rounded corners, blur, shadows, glow, animation levels, supports transparent mode and custom background images/videos
- **📝 Lyrics System**: LRC format support with card/fullscreen dual modes and multiple transition animations
- **🗂️ Play Queue Management**: Drag-and-drop sorting, shuffle, bulk add from library, supports direct drag-and-drop within the queue
- **⌨️ Global Shortcuts**: Customizable global hotkeys for play/pause, previous track, next track
- **🌍 Internationalization (i18n)**: Chinese/English support, translation data bundled with the application and supports user-defined extensions
- **💾 Settings Import/Export**: One-click `.msclte.zip` packaging, includes settings and fonts for easy migration
- **🔊 Volume Control**: App-level volume mixer control (Windows) and system master volume modes
- **🖥️ System Tray**: Custom-drawn tray menu, supports background playback and quick actions
- **📦 Package & Share**: Embed tracks, covers, lyrics into ID3v2 tags and copy to clipboard
- **⏱️ Listening Statistics**: Records cumulative playback duration for each song
- **🪟 Two UI Options**: Optional two UI configurations

## Demo
### Legacy UI Chinese Main Interface
<img src=".\example\main_old_cn.png" alt="Legacy UI Main Interface">

### New UI Chinese Main Interface

<img src=".\example\main_new_cn.png" alt="New UI Main Interface">

### Legacy UI Designer

<img src=".\example\designer_old.png" alt="Legacy UI Designer">

### New UI With Translucent Background

<img src=".\example\main_translucent.png" alt="New UI With Translucent Background">

## Quick Start

### Prerequisites

- Go 1.21+
- Node.js 18+
- Wails v3 CLI (`go install github.com/wailsapp/wails/v3/cmd/wails3@latest`)
- CGO dependencies:
  - **Windows**: MinGW-w64, `ffmpeg`
  - **macOS**: `brew install ffmpeg`
  - **Linux**: `sudo apt install libgtk-3-dev libwebkit2gtk-4.1-dev ffmpeg`

### Development Mode

```bash
# Install frontend dependencies
cd frontend && npm install && cd ..

# Start development server
wails3 dev
```

### Build Production Release

```bash
# Windows
compile.cmd

# macOS / Linux
wails3 build
```

Build artifacts are located in the `build/bin/` directory.


## Supported Audio Formats


| Format | <= Cuckoo Beta0.6.4 Support | > Cuckoo Beta0.6.4 Support |
| :--- | :--- | :--- |
| MP3 | ✅ Full Support | ✅ Full Support |
| WAV | ✅ Full Support | ✅ Full Support |
| FLAC | ✅ Full Support | ✅ Full Support|
| AAC | ❌ Not Supported | ✅ Full Support|
| OGG (Vorbis) | ❌ Not Supported | ✅ Full Support|
| OPUS | ❌ Not Supported | ✅ Full Support |
| WMA | ❌ Not Supported | ✅ Partial Support|
| AIFF | ❌ Not Supported | ✅ Full Support|
| AMR | ❌ Not Supported | ✅ Full Support|
| AC3 / E-AC3 | ❌ Not Supported | ✅ Full Support|
| DTS | ❌ Not Supported | ✅ Full Support|
| ALAC | ❌ Not Supported | ✅ Full Support|
| APE | ❌ Not Supported | ✅ Decode Only|
| TTA | ❌ Not Supported | ✅ Decode Only|


## License

This project is open source under the [GNU GPL V3](./LICENCE.txt).

## Acknowledgments

- `https://wails.io/` - Excellent Go desktop framework
- `https://ffmpeg.org/` - Open source cross-platform audio/video processing framework
- `https://github.com/dhowden/tag` - Audio tag parsing
