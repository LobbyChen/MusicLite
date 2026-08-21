@echo off
setlocal
REM 计算版本号（生成 build\version.txt + build\version-set.cmd）
node "%~dp0scripts\version.mjs"
REM 把 build\version-set.cmd 中的 set 命令 source 到当前 cmd 环境
if exist build\version-set.cmd call build\version-set.cmd
REM VERSION_LDFLAGS 由 version-set.cmd 设置好，供 Taskfile BUILD_FLAGS 模板读取
wails3 task common:update:build-assets
wails3 build
endlocal
