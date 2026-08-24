[CmdletBinding()]
param(
    [string] $Version = '0.3.0',
    [string] $IsccPath
)

$ErrorActionPreference = 'Stop'
$installerDirectory = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = Split-Path -Parent $installerDirectory
$outputDirectory = Join-Path $installerDirectory 'output'
$resolvedInstallerDirectory = [IO.Path]::GetFullPath($installerDirectory)
$resolvedOutputDirectory = [IO.Path]::GetFullPath($outputDirectory)
if ([IO.Path]::GetDirectoryName($resolvedOutputDirectory) -ne $resolvedInstallerDirectory) {
    throw "Refusing to write to an unexpected output directory: $resolvedOutputDirectory"
}
New-Item -ItemType Directory -Path $outputDirectory -Force | Out-Null
foreach ($staleAudit in @(
    'ProcureXSetup.build-manifest.json',
    'ProcureXSetup.included-files.json',
    'ProcureXSetup.sensitive-scan.json',
    'ProcureXSetup.sha256'
)) {
    $stalePath = Join-Path $outputDirectory $staleAudit
    if (Test-Path -LiteralPath $stalePath) {
        Remove-Item -LiteralPath $stalePath -Force
    }
}
$python = Join-Path $projectRoot '.venv\Scripts\python.exe'
$npm = (Get-Command npm.cmd -ErrorAction Stop).Source
if (-not (Test-Path -LiteralPath $python)) { throw "Project Python is missing: $python" }

Push-Location (Join-Path $projectRoot 'frontend')
try {
    $env:CI = 'true'
    $env:GENERATE_SOURCEMAP = 'false'
    $env:REACT_APP_BACKEND_URL = 'http://127.0.0.1:8000'
    $env:REACT_APP_PUBLIC_API_URL = 'http://127.0.0.1:8000'
    & $npm run build
    if ($LASTEXITCODE -ne 0) { throw 'Production frontend build failed.' }
} finally {
    Pop-Location
}

$buildRoot = Join-Path $installerDirectory '.build'
$runtimeDist = Join-Path $buildRoot 'runtime-dist'
$workPath = Join-Path $buildRoot 'pyinstaller-work'
$specPath = Join-Path $buildRoot 'pyinstaller-spec'
$desktopVersionInfo = Join-Path $projectRoot 'desktop\version-info.txt'
foreach ($directory in @($runtimeDist, $workPath, $specPath)) {
    New-Item -ItemType Directory -Path $directory -Force | Out-Null
}

& $python -m PyInstaller --noconfirm --clean --onedir `
    --name ProcureXDesktopHost `
    --icon (Join-Path $projectRoot 'launcher\assets\ProcureX.ico') `
    --version-file $desktopVersionInfo `
    --paths (Join-Path $projectRoot 'backend') `
    --distpath $runtimeDist --workpath $workPath --specpath $specPath `
    --hidden-import server --hidden-import business_codes --hidden-import database `
    --hidden-import db_migrations --hidden-import excel_io --hidden-import incoming_requests `
    --hidden-import price_comparisons --collect-submodules document_capture `
    --collect-all uvicorn `
    (Join-Path $projectRoot 'desktop\ProcureXDesktopHost.py')
if ($LASTEXITCODE -ne 0) { throw 'Frozen ProcureX runtime build failed.' }

$analysisToc = Join-Path $workPath 'ProcureXDesktopHost\Analysis-00.toc'
if (-not (Test-Path -LiteralPath $analysisToc)) {
    throw "PyInstaller analysis report is missing: $analysisToc"
}
$analysisText = Get-Content -LiteralPath $analysisToc -Raw
$forbiddenConstructionModules = @(
    'construction_calculator.domain',
    'construction_calculator.permissions',
    'construction_calculator.repository',
    'construction_calculator.router',
    'construction_calculator.seed',
    'construction_calculator.service',
    'construction_calculator.workbook_import'
)
$constructionRuntimeMatches = @(
    $forbiddenConstructionModules | Where-Object {
        $analysisText -match [regex]::Escape($_)
    }
)

& (Join-Path $installerDirectory 'Stage-Payload.ps1') `
    -RuntimeDirectory (Join-Path $runtimeDist 'ProcureXDesktopHost') -Version $Version

$stagingDirectory = Join-Path $installerDirectory 'staging'
$payloadFiles = @(Get-ChildItem -LiteralPath $stagingDirectory -Recurse -File | Sort-Object FullName)
$includedFiles = @($payloadFiles | ForEach-Object {
    [ordered]@{
        path = $_.FullName.Substring($stagingDirectory.Length).TrimStart('\')
        bytes = $_.Length
        sha256 = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
    }
})
$sensitivePattern = '(?i)(^|[\\/])(?:procurement\.db(?:-wal|-shm)?|workbook\.xlsm|\.env|\.git|node_modules|__pycache__|\.pytest_cache|tests|backups|attachments)([\\/]|$)'
$sensitiveMatches = @($includedFiles | Where-Object { $_.path -match $sensitivePattern })
$constructionPayloadMatches = @(
    $includedFiles | Where-Object {
        $_.path -match '(?i)(construction[_-]calculator|construction_rates)'
    }
)
$includedFiles | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath `
    (Join-Path $outputDirectory 'ProcureXSetup.included-files.json') -Encoding UTF8
[ordered]@{
    status = if (
        $sensitiveMatches.Count -or
        $constructionRuntimeMatches.Count -or
        $constructionPayloadMatches.Count
    ) { 'failed' } else { 'passed' }
    scanned_files = $includedFiles.Count
    forbidden_matches = $sensitiveMatches
    construction_feature_runtime_modules = $constructionRuntimeMatches
    construction_feature_payload_files = $constructionPayloadMatches
} | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath `
    (Join-Path $outputDirectory 'ProcureXSetup.sensitive-scan.json') -Encoding UTF8
if ($sensitiveMatches.Count -or $constructionRuntimeMatches.Count -or $constructionPayloadMatches.Count) {
    throw "Forbidden sensitive, development, or active Construction content entered the payload."
}

if (-not $IsccPath) {
    $candidates = @(
        "$env:LOCALAPPDATA\Programs\Inno Setup 6\ISCC.exe",
        "$env:ProgramFiles(x86)\Inno Setup 6\ISCC.exe",
        "$env:ProgramFiles\Inno Setup 6\ISCC.exe"
    )
    $IsccPath = $candidates | Where-Object { $_ -and (Test-Path -LiteralPath $_) } |
        Select-Object -First 1
}
if (-not $IsccPath -or -not (Test-Path -LiteralPath $IsccPath)) {
    throw 'Inno Setup 6 compiler (ISCC.exe) was not found.'
}

& $IsccPath "/DMyAppVersion=$Version" (Join-Path $installerDirectory 'ProcureX.iss')
if ($LASTEXITCODE -ne 0) { throw 'Inno Setup compilation failed.' }

$setup = Join-Path $outputDirectory 'ProcureXSetup.exe'
$hash = Get-FileHash -LiteralPath $setup -Algorithm SHA256
$hashLine = "$($hash.Hash.ToLowerInvariant())  ProcureXSetup.exe"
Set-Content -LiteralPath (Join-Path $outputDirectory 'ProcureXSetup.sha256') `
    -Value $hashLine -Encoding ascii
$setupVersion = (Get-Item -LiteralPath $setup).VersionInfo
$launcherPath = Join-Path $stagingDirectory 'launcher\ProcureXLauncher.exe'
$desktopHostPath = Join-Path $stagingDirectory 'runtime\ProcureXDesktopHost.exe'
$launcherVersion = (Get-Item -LiteralPath $launcherPath).VersionInfo
$desktopHostVersion = (Get-Item -LiteralPath $desktopHostPath).VersionInfo
$gitCommit = try { (& git -C $projectRoot rev-parse HEAD).Trim() } catch { 'unavailable' }
$payloadBytes = ($payloadFiles | Measure-Object -Property Length -Sum).Sum
function Normalize-Version([string] $Value) {
    if ([string]::IsNullOrWhiteSpace($Value)) { return 'unknown' }
    return $Value.Trim()
}
$manifest = [ordered]@{
    product = 'ProcureX'
    version = $Version
    created_utc = [DateTime]::UtcNow.ToString('o')
    git_commit = $gitCommit
    installer = [ordered]@{
        path = $setup
        bytes = (Get-Item -LiteralPath $setup).Length
        sha256 = $hash.Hash.ToLowerInvariant()
        file_version = Normalize-Version $setupVersion.FileVersion
        product_version = Normalize-Version $setupVersion.ProductVersion
    }
    payload = [ordered]@{
        files = $payloadFiles.Count
        bytes = $payloadBytes
        included_file_audit = 'ProcureXSetup.included-files.json'
        sensitive_file_report = 'ProcureXSetup.sensitive-scan.json'
    }
    launcher = [ordered]@{
        file_version = Normalize-Version $launcherVersion.FileVersion
        product_version = Normalize-Version $launcherVersion.ProductVersion
    }
    desktop_host = [ordered]@{
        file_version = Normalize-Version $desktopHostVersion.FileVersion
        product_version = Normalize-Version $desktopHostVersion.ProductVersion
    }
}
$manifest | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath `
    (Join-Path $outputDirectory 'ProcureXSetup.build-manifest.json') -Encoding UTF8
Write-Host "Installer: $setup"
Write-Host "SHA-256:  $($hash.Hash)"
