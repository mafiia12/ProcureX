[CmdletBinding()]
param(
    [Parameter(Mandatory)] [string] $RuntimeDirectory,
    [string] $Version = '0.3.0'
)

$ErrorActionPreference = 'Stop'
$installerDirectory = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = Split-Path -Parent $installerDirectory
$stagingDirectory = Join-Path $installerDirectory 'staging'
$resolvedInstaller = [IO.Path]::GetFullPath($installerDirectory)
$resolvedStaging = [IO.Path]::GetFullPath($stagingDirectory)
if ([IO.Path]::GetDirectoryName($resolvedStaging) -ne $resolvedInstaller) {
    throw "Refusing to rebuild an unexpected staging directory: $resolvedStaging"
}
if (Test-Path -LiteralPath $stagingDirectory) {
    Remove-Item -LiteralPath $stagingDirectory -Recurse -Force
}

$runtimeSource = [IO.Path]::GetFullPath($RuntimeDirectory)
$frontendSource = Join-Path $projectRoot 'frontend\build'
foreach ($required in @(
    (Join-Path $runtimeSource 'ProcureXDesktopHost.exe'),
    (Join-Path $frontendSource 'index.html'),
    (Join-Path $projectRoot 'launcher\ProcureXLauncher.exe'),
    (Join-Path $projectRoot 'launcher\assets\ProcureX.ico')
)) {
    if (-not (Test-Path -LiteralPath $required)) { throw "Required payload file is missing: $required" }
}

New-Item -ItemType Directory -Path $stagingDirectory | Out-Null
Copy-Item -LiteralPath $runtimeSource -Destination (Join-Path $stagingDirectory 'runtime') -Recurse
Copy-Item -LiteralPath $frontendSource -Destination (Join-Path $stagingDirectory 'frontend') -Recurse
New-Item -ItemType Directory -Path (Join-Path $stagingDirectory 'launcher\assets') -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $projectRoot 'launcher\ProcureXLauncher.exe') `
    -Destination (Join-Path $stagingDirectory 'launcher\ProcureXLauncher.exe')
Copy-Item -LiteralPath (Join-Path $projectRoot 'launcher\assets\ProcureX.ico') `
    -Destination (Join-Path $stagingDirectory 'launcher\assets\ProcureX.ico')
Copy-Item -LiteralPath (Join-Path $projectRoot 'start_app.bat') -Destination $stagingDirectory
Copy-Item -LiteralPath (Join-Path $installerDirectory 'tools') -Destination $stagingDirectory -Recurse
Copy-Item -LiteralPath (Join-Path $installerDirectory 'README.md') `
    -Destination (Join-Path $stagingDirectory 'INSTALLATION.md')
Set-Content -LiteralPath (Join-Path $stagingDirectory 'version.txt') -Value $Version -Encoding ascii

$forbiddenNames = @(
    'procurement.db', 'procurement.db-wal', 'procurement.db-shm', 'workbook.xlsm',
    '.git', 'node_modules', '__pycache__', '.pytest_cache', 'tests', 'backups'
)
$forbidden = Get-ChildItem -LiteralPath $stagingDirectory -Recurse -Force | Where-Object {
    $forbiddenNames -contains $_.Name
}
if ($forbidden) {
    throw "Forbidden development or business-data content entered the payload: $($forbidden.FullName -join ', ')"
}

$payloadFiles = Get-ChildItem -LiteralPath $stagingDirectory -Recurse -File
$payloadBytes = ($payloadFiles | Measure-Object -Property Length -Sum).Sum
Write-Host "Staged $($payloadFiles.Count) files ($payloadBytes bytes) in $stagingDirectory"
