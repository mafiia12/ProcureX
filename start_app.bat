@echo off
setlocal
cd /d "%~dp0"

if exist "%~dp0runtime\ProcureXDesktopHost.exe" if exist "%~dp0launcher\ProcureXLauncher.exe" (
    echo Starting the installed ProcureX application...
    "%~dp0launcher\ProcureXLauncher.exe"
    if errorlevel 1 (
        echo ProcureX did not start. Review:
        echo   %%LOCALAPPDATA%%\ProcureX\logs\launcher.log
        echo   %%LOCALAPPDATA%%\ProcureX\logs\backend.log
        echo   %%LOCALAPPDATA%%\ProcureX\logs\frontend.log
        pause
        exit /b 1
    )
    exit /b 0
)

echo Starting ProcureX backend and frontend...
start "ProcureX Backend" cmd /k call "%~dp0start_backend.bat"
start "ProcureX Frontend" cmd /k call "%~dp0start_frontend.bat"

echo Waiting for both services to become ready...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$deadline=(Get-Date).AddMinutes(5); do { try { $api=Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 'http://127.0.0.1:8000/api/'; $ui=Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 'http://localhost:3000'; if ($api.StatusCode -eq 200 -and $ui.StatusCode -eq 200) { exit 0 } } catch {}; Start-Sleep -Seconds 2 } while ((Get-Date) -lt $deadline); exit 1"

if errorlevel 1 (
    echo The services did not become ready within five minutes. Check both command windows for details.
    pause
    exit /b 1
)

start "" "http://localhost:3000"
