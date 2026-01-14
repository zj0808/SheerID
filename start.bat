@echo off
echo Starting SheerID Verifier...
echo.

node --version >nul 2>&1
if %errorlevel% neq 0 (
    echo ERROR: Node.js not found
    echo Please install Node.js from: https://nodejs.org/
    pause
    exit
)

if not exist local-server.js (
    echo ERROR: local-server.js not found
    pause
    exit
)

echo Starting server...
start "SheerID Server" cmd /k "echo SheerID Verification Server && echo URL: http://localhost:8787 && echo Close this window to stop server && echo. && node local-server.js"

echo.
echo Startup complete!
echo Server running at: http://localhost:8787
echo You can now use the verification page.
echo.
pause
