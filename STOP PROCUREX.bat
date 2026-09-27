@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0launcher\public\ProcureX.ps1" -Action Stop
if errorlevel 1 pause
