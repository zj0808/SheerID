@echo off
chcp 65001 >nul
title SheerID Telegram 机器人

echo ========================================
echo   SheerID Telegram 机器人
echo ========================================
echo.

cd /d "%~dp0bot"

echo [%date% %time%] 正在启动机器人...
echo.

python bot.py

echo.
echo ========================================
echo   机器人已停止运行
echo ========================================
pause

