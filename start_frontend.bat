@echo off
setlocal
cd /d "%~dp0frontend"

where node >nul 2>nul
if errorlevel 1 (
    echo Node.js was not found. Install Node.js 20 LTS and try again.
    pause
    exit /b 1
)

where npm >nul 2>nul
if errorlevel 1 (
    echo npm was not found. Reinstall Node.js with npm enabled.
    pause
    exit /b 1
)

if not exist "node_modules\react-scripts\package.json" (
    echo Installing frontend dependencies...
    call npm install --no-audit --no-fund
    if errorlevel 1 (
        echo Frontend dependency installation failed.
        pause
        exit /b 1
    )
)

set "BROWSER=none"
set "PORT=3000"
echo Starting the frontend at http://localhost:3000 ...
call npm start
