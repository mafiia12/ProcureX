$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$desktop = [Environment]::GetFolderPath('Desktop')
foreach ($entry in @(@('START PROCUREX PUBLIC.bat','Start'), @('STOP PROCUREX.bat','Stop'))) {
    $content = @"
@echo off
setlocal
if not exist "$root\launcher\public\ProcureX.ps1" (
  echo ProcureX has moved. Run launcher\public\Install-Desktop.ps1 from its new location.
  pause
  exit /b 1
)
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$root\launcher\public\ProcureX.ps1" -Action $($entry[1])
if errorlevel 1 (
  pause
  exit /b 1
)
exit /b 0
"@
    [IO.File]::WriteAllText((Join-Path $desktop $entry[0]), $content.Replace("`r`n", "`n").Replace("`n", "`r`n"), [Text.Encoding]::Default)
}
Write-Host "Installed START PROCUREX PUBLIC.bat and STOP PROCUREX.bat on $desktop"
