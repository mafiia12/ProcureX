@echo off
setlocal
cd /d "%~dp0"

echo Starting the ProcureX WhatsApp live-test tunnel...
echo (backend + frontend windows will open separately if not already running)
echo.

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start_whatsapp_test.ps1"
if errorlevel 1 (
    echo.
    echo The tunnel helper failed - see the messages above.
    pause
    exit /b 1
)

echo.
echo Leave this window open only if you want to re-read the summary above.
pause
