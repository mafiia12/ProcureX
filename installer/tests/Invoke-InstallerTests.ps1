[CmdletBinding()]
param(
    [string] $SetupPath,
    [string] $DataRoot,
    [switch] $SkipInstallCycle
)

$ErrorActionPreference = 'Stop'
$installerDirectory = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$projectRoot = Split-Path -Parent $installerDirectory
$projectPython = Join-Path $projectRoot '.venv\Scripts\python.exe'
if (-not $SetupPath) { $SetupPath = Join-Path $installerDirectory 'output\ProcureXSetup.exe' }
$SetupPath = [IO.Path]::GetFullPath($SetupPath)
if (-not (Test-Path -LiteralPath $SetupPath)) { throw "Setup.exe is missing: $SetupPath" }
if (-not (Test-Path -LiteralPath $projectPython)) { throw "Project Python is missing: $projectPython" }

$testRoot = Join-Path $projectRoot '.tmp\installer verification with spaces'
$installRoot = Join-Path $testRoot 'Program Files\ProcureX'
if (-not $DataRoot) { $DataRoot = Join-Path $testRoot 'Data\ProcureX' }
$dataRoot = [IO.Path]::GetFullPath($DataRoot)
if ([IO.Path]::GetFileName($dataRoot.TrimEnd('\')) -ne 'ProcureX') {
    throw "The isolated installer-test data root must end with 'ProcureX': $dataRoot"
}
$runtimeResult = Join-Path $testRoot 'runtime-result.json'
$startMenuDirectory = Join-Path ([Environment]::GetFolderPath('StartMenu')) 'Programs\ProcureX'
$desktopShortcut = Join-Path ([Environment]::GetFolderPath('Desktop')) 'ProcureX.lnk'

function Assert-True([bool] $Condition, [string] $Message) {
    if (-not $Condition) { throw $Message }
}

function Invoke-Checked([string] $FilePath, [string[]] $Arguments, [hashtable] $Environment = @{}) {
    $saved = @{}
    foreach ($name in $Environment.Keys) {
        $saved[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
        [Environment]::SetEnvironmentVariable($name, $Environment[$name], 'Process')
    }
    try {
        $renderedArguments = ($Arguments | ForEach-Object {
            if ($_ -match '\s') { '"' + $_.Replace('"', '\"') + '"' } else { $_ }
        }) -join ' '
        $process = Start-Process -FilePath $FilePath -ArgumentList $renderedArguments `
            -Wait -PassThru -WindowStyle Hidden
        if ($process.ExitCode -ne 0) {
            throw "$FilePath failed with exit code $($process.ExitCode)."
        }
    } finally {
        foreach ($name in $Environment.Keys) {
            [Environment]::SetEnvironmentVariable($name, $saved[$name], 'Process')
        }
    }
}

function Start-And-VerifyProcureX([string] $Launcher, [hashtable] $Environment) {
    $savedPath = $env:PATH
    $savedBrowser = $env:PROCUREX_NO_BROWSER
    $savedDataRoot = $env:PROCUREX_DATA_ROOT
    $savedConstructionApi = $env:CONSTRUCTION_API_ENABLED
    $savedConstructionInstall = $env:CONSTRUCTION_AUTO_INSTALL
    try {
        $env:PATH = $Environment.PATH
        $env:PROCUREX_NO_BROWSER = '1'
        $env:PROCUREX_DATA_ROOT = $Environment.PROCUREX_DATA_ROOT
        $env:CONSTRUCTION_API_ENABLED = $Environment.CONSTRUCTION_API_ENABLED
        $env:CONSTRUCTION_AUTO_INSTALL = $Environment.CONSTRUCTION_AUTO_INSTALL
        $supervisor = Start-Process -FilePath $Launcher -ArgumentList @(
            '--no-browser', '--no-dialog', '--timeout-seconds=90'
        ) -PassThru -WindowStyle Hidden
        $deadline = (Get-Date).AddSeconds(90)
        $api = $null
        $ui = $null
        do {
            try {
                $api = Invoke-RestMethod -Uri 'http://127.0.0.1:8000/api/' -TimeoutSec 2
                $ui = Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:3000' -TimeoutSec 2
                if ($api.message -match 'Procurement ERP API' -and $ui.Content -match 'id="root"') {
                    return $supervisor
                }
            } catch {}
            Start-Sleep -Milliseconds 500
        } while ((Get-Date) -lt $deadline)
        if (-not $supervisor.HasExited) { $supervisor.Kill() }
        throw 'Installed ProcureX services did not become healthy within 90 seconds.'
    } finally {
        $env:PATH = $savedPath
        $env:PROCUREX_NO_BROWSER = $savedBrowser
        $env:PROCUREX_DATA_ROOT = $savedDataRoot
        $env:CONSTRUCTION_API_ENABLED = $savedConstructionApi
        $env:CONSTRUCTION_AUTO_INSTALL = $savedConstructionInstall
    }
}

function Assert-HttpStatus([string] $Uri, [int] $ExpectedStatus) {
    $status = 0
    try {
        $response = Invoke-WebRequest -UseBasicParsing -Uri $Uri -TimeoutSec 5 -ErrorAction Stop
        $status = [int] $response.StatusCode
    } catch {
        if ($_.Exception.Response) {
            $status = [int] $_.Exception.Response.StatusCode
        }
    }
    Assert-True ($status -eq $ExpectedStatus) `
        "Expected HTTP $ExpectedStatus from $Uri, received $status."
}

if (-not $SkipInstallCycle) {
    if (Test-Path -LiteralPath $dataRoot) {
        throw "Refusing to run an isolated installer test over existing ProcureX data: $dataRoot"
    }
    New-Item -ItemType Directory -Path $testRoot -Force | Out-Null
    Invoke-Checked $SetupPath @('/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', '/CURRENTUSER', "/DIR=$installRoot", "/DATAROOT=$dataRoot")
    Assert-True (Test-Path -LiteralPath (Join-Path $installRoot 'launcher\ProcureXLauncher.exe')) `
        'Launcher was not installed.'
    Assert-True (Test-Path -LiteralPath (Join-Path $installRoot 'runtime\ProcureXDesktopHost.exe')) `
        'Bundled runtime was not installed.'
    Assert-True (Test-Path -LiteralPath (Join-Path $installRoot 'frontend\index.html')) `
        'Production frontend was not installed.'
    Assert-True (-not (Test-Path -LiteralPath (Join-Path $installRoot 'frontend\node_modules'))) `
        'node_modules must not be installed.'
    foreach ($shortcut in @(
        (Join-Path $startMenuDirectory 'ProcureX.lnk'),
        (Join-Path $startMenuDirectory 'Stop ProcureX.lnk'),
        (Join-Path $startMenuDirectory 'Backup ProcureX Data.lnk'),
        (Join-Path $startMenuDirectory 'Restore ProcureX Data.lnk'),
        $desktopShortcut
    )) {
        Assert-True (Test-Path -LiteralPath $shortcut) "Expected shortcut is missing: $shortcut"
    }
    foreach ($forbidden in @(
        'procurement.db', 'workbook.xlsm', '.git', 'tests', 'backups',
        'construction_rates_v1.xlsx', 'construction_calculator'
    )) {
        Assert-True (-not (Get-ChildItem -LiteralPath $installRoot -Recurse -Force |
            Where-Object Name -eq $forbidden)) "Forbidden installed payload found: $forbidden"
    }

    $runtime = Join-Path $installRoot 'runtime\ProcureXDesktopHost.exe'
    $launcher = Join-Path $installRoot 'launcher\ProcureXLauncher.exe'
    $environment = @{
        PATH = "$env:WINDIR\System32"
        PROCUREX_NO_BROWSER = '1'
        PROCUREX_DATA_ROOT = $dataRoot
        # Legacy flags must not reactivate the removed product surface.
        CONSTRUCTION_API_ENABLED = 'true'
        CONSTRUCTION_AUTO_INSTALL = 'true'
    }
    Invoke-Checked $runtime @('--self-test', '--result-file', $runtimeResult, '--data-root', $dataRoot) $environment
    $selfTest = Get-Content -LiteralPath $runtimeResult -Raw | ConvertFrom-Json
    Assert-True ($selfTest.status -eq 'ok') 'Bundled runtime self-test failed.'

    $supervisor = Start-And-VerifyProcureX $launcher $environment
    Assert-HttpStatus 'http://127.0.0.1:8000/api/construction-calculator/categories' 404
    Assert-HttpStatus 'http://127.0.0.1:8000/api/construction-calculator/calculate' 404
    $entityName = 'INSTALLER-PRESERVE-001'
    $created = Invoke-RestMethod -Method Post -Uri 'http://127.0.0.1:8000/api/suppliers' `
        -ContentType 'application/json' -Body (@{ name = $entityName } | ConvertTo-Json)
    Assert-True ($created.name -eq $entityName) 'Could not persist installer test data.'
    Invoke-Checked $launcher @('--stop', '--no-dialog') $environment
    $supervisor.WaitForExit(30000) | Out-Null

    $installedDatabase = Join-Path $dataRoot 'data\procurement.db'
    $constructionAudit = @'
import sqlite3
import sys
from pathlib import Path
database = Path(sys.argv[1]).resolve().as_posix()
connection = sqlite3.connect('file:' + database + '?mode=ro', uri=True)
construction_tables = connection.execute(
    'SELECT name FROM sqlite_master WHERE type=? AND name LIKE ?',
    ('table', 'construction_%'),
).fetchall()
assert construction_tables == []
assert connection.execute('PRAGMA integrity_check').fetchone()[0] == 'ok'
assert connection.execute('PRAGMA foreign_key_check').fetchall() == []
'@
    & $projectPython -c $constructionAudit $installedDatabase
    if ($LASTEXITCODE -ne 0) {
        throw 'Installed database Construction seeding/integrity audit failed.'
    }

    New-Item -ItemType Directory -Path (Join-Path $dataRoot 'data\attachments\incoming_requests') -Force | Out-Null
    Set-Content -LiteralPath (Join-Path $dataRoot 'data\attachments\incoming_requests\preserve.txt') `
        -Value 'attachment-preserved' -Encoding ascii
    Invoke-Checked $runtime @('--backup', '--label', 'upgrade-test', '--result-file', $runtimeResult, '--data-root', $dataRoot) $environment
    $backup = Get-Content -LiteralPath $runtimeResult -Raw | ConvertFrom-Json
    Assert-True ($backup.status -eq 'ok') 'Verified backup test failed.'
    Assert-True (Test-Path -LiteralPath $backup.backup) 'Verified backup file is missing.'
    $backupCountBeforeUpgrade = @(
        Get-ChildItem -LiteralPath (Join-Path $dataRoot 'data\backups') -File
    ).Count

    # Reinstalling the same Setup exercises repair/upgrade file replacement.
    Invoke-Checked $SetupPath @('/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', '/CURRENTUSER', "/DIR=$installRoot", "/DATAROOT=$dataRoot")
    $backupCountAfterUpgrade = @(
        Get-ChildItem -LiteralPath (Join-Path $dataRoot 'data\backups') -File
    ).Count
    Assert-True ($backupCountAfterUpgrade -gt $backupCountBeforeUpgrade) `
        'Repair/upgrade did not create a verified pre-upgrade backup.'
    Assert-True (Test-Path -LiteralPath (Join-Path $dataRoot 'data\procurement.db')) `
        'Upgrade removed the business database.'
    Assert-True (Test-Path -LiteralPath (Join-Path $dataRoot 'data\attachments\incoming_requests\preserve.txt')) `
        'Upgrade removed an attachment.'

    $supervisor = Start-And-VerifyProcureX $launcher $environment
    $suppliers = Invoke-RestMethod -Uri 'http://127.0.0.1:8000/api/suppliers' -TimeoutSec 5
    Assert-True ($suppliers.name -contains $entityName) `
        'The preserved record was unavailable after application restart.'
    Invoke-Checked $launcher @('--stop', '--no-dialog') $environment
    $supervisor.WaitForExit(30000) | Out-Null

    $uninstaller = Join-Path $installRoot 'unins000.exe'
    Assert-True (Test-Path -LiteralPath $uninstaller) 'Uninstall entry is missing.'
    Invoke-Checked $uninstaller @('/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', "/DATAROOT=$dataRoot")
    foreach ($shortcut in @(
        (Join-Path $startMenuDirectory 'ProcureX.lnk'),
        (Join-Path $startMenuDirectory 'Stop ProcureX.lnk'),
        (Join-Path $startMenuDirectory 'Backup ProcureX Data.lnk'),
        (Join-Path $startMenuDirectory 'Restore ProcureX Data.lnk'),
        $desktopShortcut
    )) {
        Assert-True (-not (Test-Path -LiteralPath $shortcut)) `
            "Default uninstall left a ProcureX shortcut behind: $shortcut"
    }
    Assert-True (Test-Path -LiteralPath (Join-Path $dataRoot 'data\procurement.db')) `
        'Default uninstall deleted the business database.'
    Assert-True (Test-Path -LiteralPath (Join-Path $dataRoot 'data\attachments\incoming_requests\preserve.txt')) `
        'Default uninstall deleted attachments.'

    # Reinstall only to exercise explicit cleanup on the isolated test data.
    Invoke-Checked $SetupPath @('/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', '/CURRENTUSER', "/DIR=$installRoot", "/DATAROOT=$dataRoot")
    $uninstaller = Join-Path $installRoot 'unins000.exe'
    Invoke-Checked $uninstaller @(
        '/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', '/DELETEBUSINESSDATA=1', "/DATAROOT=$dataRoot"
    )
    Assert-True (-not (Test-Path -LiteralPath $dataRoot)) `
        'Explicit uninstall cleanup did not remove isolated test business data.'
}

Write-Host 'Installer verification passed:'
Write-Host '  production payload exclusions'
Write-Host '  path containing spaces'
Write-Host '  bundled runtime without system Python/Node on PATH'
Write-Host '  fresh launch and application restart'
Write-Host '  verified pre-upgrade backup'
Write-Host '  repair/upgrade data preservation'
Write-Host '  default uninstall data preservation'
Write-Host '  Construction API absence with legacy flags enabled'
Write-Host '  Construction auto-seeding absence and database integrity'
