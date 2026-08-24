[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$appRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$runtime = Join-Path $appRoot 'runtime\ProcureXDesktopHost.exe'
$resultFile = Join-Path ([IO.Path]::GetTempPath()) ("procurex-backup-{0}.json" -f [guid]::NewGuid())
$maintenanceLog = Join-Path $env:LOCALAPPDATA 'ProcureX\logs\maintenance.log'

Add-Type -AssemblyName System.Windows.Forms
try {
    if (-not (Test-Path -LiteralPath $runtime)) {
        throw "ProcureX runtime is missing: $runtime"
    }
    $process = Start-Process -FilePath $runtime -ArgumentList @(
        '--backup', '--label', 'manual', '--result-file', ('"{0}"' -f $resultFile)
    ) -WindowStyle Hidden -Wait -PassThru
    if ($process.ExitCode -ne 0 -or -not (Test-Path -LiteralPath $resultFile)) {
        throw 'The verified backup operation failed.'
    }
    $result = Get-Content -LiteralPath $resultFile -Raw | ConvertFrom-Json
    if ($result.status -eq 'no_database') {
        [Windows.Forms.MessageBox]::Show(
            'No ProcureX database exists yet.', 'ProcureX Backup', 'OK', 'Information') | Out-Null
    } else {
        [Windows.Forms.MessageBox]::Show(
            "Verified backup created:`r`n$($result.backup)",
            'ProcureX Backup Complete', 'OK', 'Information') | Out-Null
    }
} catch {
    New-Item -ItemType Directory -Path (Split-Path -Parent $maintenanceLog) -Force | Out-Null
    Add-Content -LiteralPath $maintenanceLog -Encoding UTF8 -Value (
        "{0:o} [backup] {1}" -f [DateTime]::UtcNow, $_.Exception.Message)
    [Windows.Forms.MessageBox]::Show(
        'The verified backup could not be created. Review the local ProcureX logs and try again.',
        'ProcureX Backup Failed', 'OK', 'Error') | Out-Null
    exit 1
} finally {
    Remove-Item -LiteralPath $resultFile -Force -ErrorAction SilentlyContinue
}
