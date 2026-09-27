$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$statePath = "$root\logs\public-launcher\state.json"
function Run-Launcher($action, $expected = 0) {
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$PSScriptRoot\ProcureX.ps1" -Action $action -NoBrowser
    if ($LASTEXITCODE -ne $expected) { throw "Expected launcher exit $expected; received $LASTEXITCODE" }
}
$before = Get-Content $statePath -Raw | ConvertFrom-Json
if (!$before.frontend -or !$before.tunnel) { throw 'Run START successfully before this lifecycle test.' }
$backend = @(Get-NetTCPConnection -LocalPort 8000 -State Listen).OwningProcess
Run-Launcher 'Start'
$after = Get-Content $statePath -Raw | ConvertFrom-Json
if ($before.frontend.pid -ne $after.frontend.pid -or $before.tunnel.pid -ne $after.tunnel.pid) { throw 'Duplicate processes detected' }
Run-Launcher 'Stop'
if (Get-Process -Id $before.frontend.pid, $before.tunnel.pid -ErrorAction SilentlyContinue) { throw 'Owned processes survived STOP' }
foreach ($id in $backend) { if (!(Get-Process -Id $id -ErrorAction SilentlyContinue)) { throw 'Independent backend was stopped' } }
$fixture = Start-Process -FilePath (Get-Command node.exe).Source -ArgumentList "`"$PSScriptRoot\port-fixture.cjs`"" -WindowStyle Hidden -PassThru
try {
    $until = (Get-Date).AddSeconds(15)
    while (!(Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue)) {
        if ((Get-Date) -gt $until) { throw 'Fixture startup timeout' }
        Start-Sleep -Milliseconds 250
    }
    Run-Launcher 'Start' 1
    Run-Launcher 'Stop'
    if (!(Get-Process -Id $fixture.Id -ErrorAction SilentlyContinue)) { throw 'Unrelated process was stopped' }
} finally { $fixture.Kill(); $fixture.WaitForExit() }
Run-Launcher 'Start'
Write-Host 'PASS: duplicate start, safe STOP, external backend preservation, occupied-port rejection, unrelated process preservation, restart.'
