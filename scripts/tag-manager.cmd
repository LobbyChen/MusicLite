@echo off
chcp 65001 >nul
rem MusicLite Tag 管理器启动器（实际逻辑在 tag-manager.ps1）
setlocal
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tag-manager.ps1"
set "CODE=%ERRORLEVEL%"
if not "%CODE%"=="0" (
    echo.
    echo 脚本异常退出，错误码：%CODE%
    pause
)
endlocal
exit /b %CODE%
