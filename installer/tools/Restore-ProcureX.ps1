[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$appRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$launcher = Join-Path $appRoot 'launcher\ProcureXLauncher.exe'
$runtime = Join-Path $appRoot 'runtime\ProcureXDesktopHost.exe'
$resultFile = Join-Path ([IO.Path]::GetTempPath()) ("procurex-restore-{0}.json" -f [guid]::NewGuid())
$maintenanceLog = Join-Path $env:LOCALAPPDATA 'ProcureX\logs\maintenance.log'

Add-Type -AssemblyName System.Windows.Forms
try {
    $dialog = New-Object Windows.Forms.OpenFileDialog
    $dialog.Title = 'Select a verified ProcureX database backup'
    $dialog.Filter = 'SQLite databases (*.db)|*.db|All files (*.*)|*.*'
    $dialog.CheckFileExists = $true
    if ($dialog.ShowDialog() -ne [Windows.Forms.DialogResult]::OK) { exit 0 }

    $confirmation = [Windows.Forms.MessageBox]::Show(
        "Restore this database?`r`n`r`n$($dialog.FileName)`r`n`r`n" +
        'ProcureX will stop and create a safety backup first.',
        'Confirm ProcureX Restore', 'YesNo', 'Warning')
    if ($confirmation -ne [Windows.Forms.DialogResult]::Yes) { exit 0 }

    if (Test-Path -LiteralPath $launcher) {
        Start-Process -FilePath $launcher -ArgumentList '--stop' -WindowStyle Hidden -Wait
    }
    $process = Start-Process -FilePath $runtime -ArgumentList @(
        '--restore', ('"{0}"' -f $dialog.FileName),
        '--result-file', ('"{0}"' -f $resultFile)
    ) -WindowStyle Hidden -Wait -PassThru
    if ($process.ExitCode -ne 0 -or -not (Test-Path -LiteralPath $resultFile)) {
        $detail = if (Test-Path -LiteralPath $resultFile) {
            (Get-Content -LiteralPath $resultFile -Raw | ConvertFrom-Json).message
        } else { 'The restore process did not return a result.' }
        throw $detail
    }
    $result = Get-Content -LiteralPath $resultFile -Raw | ConvertFrom-Json
    [Windows.Forms.MessageBox]::Show(
        'Database and matching attachments were restored and verified. A safety backup was retained.',
        'ProcureX Restore Complete', 'OK', 'Information') | Out-Null
} catch {
    New-Item -ItemType Directory -Path (Split-Path -Parent $maintenanceLog) -Force | Out-Null
    Add-Content -LiteralPath $maintenanceLog -Encoding UTF8 -Value (
        "{0:o} [restore] {1}" -f [DateTime]::UtcNow, $_.Exception.Message)
    [Windows.Forms.MessageBox]::Show(
        'The restore could not be completed. The existing data was retained. Review the local ProcureX logs.',
        'ProcureX Restore Failed', 'OK', 'Error') | Out-Null
    exit 1
} finally {
    Remove-Item -LiteralPath $resultFile -Force -ErrorAction SilentlyContinue
}
