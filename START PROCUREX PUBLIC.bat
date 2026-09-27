@echo off
setlocal
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0launcher\public\ProcureX.ps1" -Action Start
if errorlevel 1 (
  pause
  exit /b 1
)
exit /b 0
