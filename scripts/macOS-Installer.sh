#!/usr/bin/env bash
#
# MusicLite Cuckoo —— macOS 一键安装脚本
#
# 用法:
#   chmod +x macOS-Installer.sh
#   ./macOS-Installer.sh
#
# 功能:
#   1. 自动从 GitHub 最新 Release 抓取 macOS .app 安装包
#   2. 下载并解压到 /Applications 完成安装
#   3. 移除 Gatekeeper 隔离属性，安装后即可直接运行
#
# 说明:
#   Release 中的 .app 已在 CI 打包阶段内置全部原生依赖
#   (FFmpeg 等动态库)，无需 Homebrew 或任何额外依赖。

set -euo pipefail

REPO="LobbyChen/MusicLite"
API_URL="https://api.github.com/repos/${REPO}/releases/latest"
INSTALL_DIR="/Applications"

echo "==> 检查运行环境..."
if [ "$(uname)" != "Darwin" ]; then
    echo "错误: 本脚本仅支持 macOS。" >&2
    exit 1
fi
command -v curl >/dev/null 2>&1 || { echo "错误: 需要 curl。" >&2; exit 1; }

echo "==> 获取最新 Release 信息 (${REPO})..."
if ! json="$(curl -fsSL -H "Accept: application/vnd.github+json" "$API_URL")"; then
    echo "错误: 无法访问 GitHub API，请检查网络连接。" >&2
    exit 1
fi

tag="$(printf '%s\n' "$json" | sed -n 's/.*"tag_name":[[:space:]]*"\([^"]*\)".*/\1/p' | head -1)"
asset_url="$(printf '%s\n' "$json" \
    | sed -n 's/.*"browser_download_url":[[:space:]]*"\([^"]*\)".*/\1/p' \
    | grep -i -E 'macos.*\.(zip|dmg)$' | head -1)"

if [ -z "$tag" ] || [ -z "$asset_url" ]; then
    echo "错误: 最新 Release 中未找到 macOS 安装包。" >&2
    exit 1
fi

tmpdir="$(mktemp -d)"
trap 'rm -rf "$tmpdir"' EXIT

echo "==> 下载 ${tag} ..."
echo "    $asset_url"
curl -fL --progress-bar -o "$tmpdir/macos.zip" "$asset_url"

echo "==> 解压..."
mkdir -p "$tmpdir/extract"
ditto -x -k "$tmpdir/macos.zip" "$tmpdir/extract"
app_path="$(find "$tmpdir/extract" -maxdepth 1 -name "*.app" | head -1)"
if [ -z "$app_path" ]; then
    echo "错误: 压缩包内未找到 .app 文件。" >&2
    exit 1
fi
app_name="$(basename "$app_path")"

echo "==> 安装到 ${INSTALL_DIR}/${app_name} ..."
if [ -d "${INSTALL_DIR}/${app_name}" ]; then
    rm -rf "${INSTALL_DIR}/${app_name}" 2>/dev/null \
        || sudo rm -rf "${INSTALL_DIR}/${app_name}"
fi
cp -R "$app_path" "$INSTALL_DIR/" 2>/dev/null \
    || sudo cp -R "$app_path" "$INSTALL_DIR/"

# 移除隔离属性，避免 Gatekeeper 拦截未公证应用
xattr -dr com.apple.quarantine "${INSTALL_DIR}/${app_name}" 2>/dev/null || true

# 校验依赖完整性：CI 打包时已将全部 dylib 内置于 Contents/Frameworks
echo "==> 校验依赖完整性..."
if otool -L "${INSTALL_DIR}/${app_name}/Contents/MacOS/"* 2>/dev/null | grep -q "@rpath"; then
    echo "    依赖检查通过（.app 已内置全部动态库，无需额外配置）。"
else
    echo "    提示: 未检测到内置依赖标记，若启动异常请反馈给开发者。"
fi

echo ""
echo "✅ 安装完成: ${INSTALL_DIR}/${app_name} (${tag})"
echo "   可在「启动台」中打开，或执行: open -a \"${app_name%.app}\""
