@echo off
chcp 65001 >nul
title SheerID Web 验证器

echo ========================================
echo   SheerID Web 验证器
echo ========================================
echo.

cd /d "%~dp0"

echo [%date% %time%] 正在启动Web服务器...
echo.

node local-server.js

echo.
echo ========================================
echo   服务器已停止运行
echo ========================================
pause

