[CmdletBinding()]
param(
    [int]$StartupTimeoutSeconds = 240
)

$ErrorActionPreference = 'Stop'
$testDirectory = Split-Path -Parent $MyInvocation.MyCommand.Path
$launcherDirectory = Split-Path -Parent $testDirectory
$projectRoot = Split-Path -Parent $launcherDirectory
$launcher = Join-Path $launcherDirectory 'ProcureXLauncher.exe'
$python = Join-Path $projectRoot '.venv\Scripts\python.exe'
$node = 'C:\Program Files\nodejs\node.exe'
$craco = Join-Path $projectRoot 'frontend\node_modules\@craco\craco\dist\bin\craco.js'
$statePath = Join-Path $projectRoot 'logs\launcher.state'
$results = [System.Collections.Generic.List[string]]::new()
$manualProcesses = [System.Collections.Generic.List[System.Diagnostics.Process]]::new()

function Assert-True([bool]$condition, [string]$message) {
    if (-not $condition) { throw $message }
}

function Wait-Until([scriptblock]$condition, [int]$timeoutSeconds, [string]$failure) {
    $deadline = [DateTime]::UtcNow.AddSeconds($timeoutSeconds)
    do {
        if (& $condition) { return }
        Start-Sleep -Milliseconds 500
    } while ([DateTime]::UtcNow -lt $deadline)
    throw $failure
}

function Test-Http([string]$url, [string]$signature) {
    try {
        $response = Invoke-WebRequest -UseBasicParsing -Uri $url -TimeoutSec 2
        return $response.StatusCode -eq 200 -and $response.Content.Contains($signature)
    } catch { return $false }
}

function Test-Port([int]$port) {
    $client = [System.Net.Sockets.TcpClient]::new()
    try {
        $result = $client.BeginConnect('127.0.0.1', $port, $null, $null)
        if (-not $result.AsyncWaitHandle.WaitOne(400)) { return $false }
        $client.EndConnect($result)
        return $true
    } catch { return $false } finally { $client.Dispose() }
}

function Start-Launcher([string[]]$extra = @()) {
    $arguments = @('--no-browser', '--no-dialog', "--timeout-seconds=$StartupTimeoutSeconds") + $extra
    return Start-Process -FilePath $launcher -ArgumentList $arguments -WorkingDirectory $projectRoot -PassThru -WindowStyle Hidden
}

function Invoke-StopLauncher {
    $process = Start-Process -FilePath $launcher -ArgumentList @('--stop', '--no-browser', '--no-dialog') `
        -WorkingDirectory $projectRoot -PassThru -WindowStyle Hidden
    Assert-True ($process.WaitForExit(30000)) 'Stop ProcureX did not return within 30 seconds.'
    Assert-True ($process.ExitCode -eq 0) "Stop ProcureX returned exit code $($process.ExitCode)."
}

function Wait-Healthy([System.Diagnostics.Process]$supervisorProcess) {
    $deadline = [DateTime]::UtcNow.AddSeconds($StartupTimeoutSeconds)
    do {
        if ($supervisorProcess.HasExited) {
            throw "Launcher supervisor exited during startup with code $($supervisorProcess.ExitCode)."
        }
        if (
        (Test-Http 'http://127.0.0.1:8000/api/' 'Procurement ERP API') -and
        (Test-Http 'http://127.0.0.1:3000' 'RE DECOR & MORE')
        ) { return }
        Start-Sleep -Milliseconds 500
    } while ([DateTime]::UtcNow -lt $deadline)
    throw 'ProcureX services did not become healthy.'
}

function Wait-Stopped {
    Wait-Until { -not (Test-Port 8000) -and -not (Test-Port 3000) } 30 'ProcureX ports did not close.'
}

function Stop-ManualProcess([System.Diagnostics.Process]$process) {
    if ($null -eq $process) { return }
    try {
        if (-not $process.HasExited) {
            Stop-Process -Id $process.Id -Force
            $process.WaitForExit(10000) | Out-Null
        }
    } catch { }
}

function Read-State {
    $values = @{}
    if (Test-Path -LiteralPath $statePath) {
        foreach ($line in Get-Content -LiteralPath $statePath) {
            $parts = $line -split '=', 2
            if ($parts.Count -eq 2) { $values[$parts[0]] = $parts[1] }
        }
    }
    return $values
}

Assert-True (Test-Path -LiteralPath $launcher) 'ProcureXLauncher.exe has not been built.'
Assert-True (Test-Path -LiteralPath $python) 'Project Python virtual environment is missing.'
Assert-True (Test-Path -LiteralPath $node) 'Node.js is missing.'
Assert-True (Test-Path -LiteralPath $craco) 'CRACO is missing.'
Assert-True (-not (Test-Port 8000) -and -not (Test-Port 3000)) `
    'Ports 8000 or 3000 are already occupied. The integration suite will not stop unknown processes.'

try {
    $selfTest = Start-Process -FilePath $launcher -ArgumentList @('--self-test', '--no-dialog', '--no-browser') `
        -WorkingDirectory $projectRoot -PassThru -WindowStyle Hidden
    Assert-True ($selfTest.WaitForExit(15000)) 'Launcher self-test timed out.'
    Assert-True ($selfTest.ExitCode -eq 0) 'Launcher self-test failed.'
    $results.Add('PASS self-test')

    # Clean startup.
    $supervisor = Start-Launcher
    Wait-Healthy $supervisor
    Assert-True (Test-Path -LiteralPath $statePath) 'Launcher state file was not created.'
    foreach ($logName in @('backend.log', 'frontend.log', 'launcher.log')) {
        Assert-True (Test-Path -LiteralPath (Join-Path $projectRoot "logs\$logName")) "Missing $logName."
    }
    $results.Add('PASS clean startup')

    # Repeated startup must exit while the original supervisor remains.
    $stateBefore = Read-State
    $second = Start-Launcher
    Assert-True ($second.WaitForExit(30000)) 'Repeated launch did not exit.'
    Assert-True ($second.ExitCode -eq 0) 'Repeated launch failed.'
    Assert-True (-not $supervisor.HasExited) 'Repeated launch stopped the original supervisor.'
    $stateAfter = Read-State
    Assert-True ($stateBefore['launcher_pid'] -eq $stateAfter['launcher_pid']) 'Repeated launch created another supervisor.'
    $results.Add('PASS repeated startup')

    # Clean shutdown.
    Invoke-StopLauncher
    Assert-True ($supervisor.WaitForExit(30000)) 'Supervisor did not exit after Stop ProcureX.'
    Wait-Stopped
    $results.Add('PASS clean shutdown')

    # Existing backend is reused; only frontend is launcher-owned.
    $manualBackend = Start-Process -FilePath $python `
        -ArgumentList @('-m', 'uvicorn', 'server:app', '--host', '127.0.0.1', '--port', '8000') `
        -WorkingDirectory (Join-Path $projectRoot 'backend') -PassThru -WindowStyle Hidden
    $manualProcesses.Add($manualBackend)
    Wait-Until { Test-Http 'http://127.0.0.1:8000/api/' 'Procurement ERP API' } 60 'Manual backend did not start.'
    $supervisor = Start-Launcher
    Wait-Healthy $supervisor
    $state = Read-State
    Assert-True ($state['backend_pid'] -eq 'external') 'Existing backend was not marked external.'
    Invoke-StopLauncher
    Assert-True ($supervisor.WaitForExit(30000)) 'Backend-reuse supervisor did not exit.'
    Assert-True (Test-Http 'http://127.0.0.1:8000/api/' 'Procurement ERP API') 'Launcher stopped the external backend.'
    Wait-Until { -not (Test-Port 3000) } 20 'Launcher-owned frontend did not stop.'
    Stop-ManualProcess $manualBackend
    Wait-Until { -not (Test-Port 8000) } 20 'Manual backend port did not close.'
    $results.Add('PASS backend already running')

    # Existing frontend is reused; only backend is launcher-owned.
    $savedBrowser = $env:BROWSER; $savedHost = $env:HOST; $savedPort = $env:PORT; $savedColor = $env:FORCE_COLOR
    $env:BROWSER = 'none'; $env:HOST = '127.0.0.1'; $env:PORT = '3000'; $env:FORCE_COLOR = '0'
    try {
        $manualFrontend = Start-Process -FilePath $node -ArgumentList @("`"$craco`"", 'start') `
            -WorkingDirectory (Join-Path $projectRoot 'frontend') -PassThru -WindowStyle Hidden
    } finally {
        $env:BROWSER = $savedBrowser; $env:HOST = $savedHost; $env:PORT = $savedPort; $env:FORCE_COLOR = $savedColor
    }
    $manualProcesses.Add($manualFrontend)
    Wait-Until { Test-Http 'http://127.0.0.1:3000' 'RE DECOR & MORE' } $StartupTimeoutSeconds 'Manual frontend did not start.'
    $supervisor = Start-Launcher
    Wait-Healthy $supervisor
    $state = Read-State
    Assert-True ($state['frontend_pid'] -eq 'external') 'Existing frontend was not marked external.'
    Invoke-StopLauncher
    Assert-True ($supervisor.WaitForExit(30000)) 'Frontend-reuse supervisor did not exit.'
    Assert-True (Test-Http 'http://127.0.0.1:3000' 'RE DECOR & MORE') 'Launcher stopped the external frontend.'
    Wait-Until { -not (Test-Port 8000) } 20 'Launcher-owned backend did not stop.'
    Stop-ManualProcess $manualFrontend
    Wait-Until { -not (Test-Port 3000) } 20 'Manual frontend port did not close.'
    $results.Add('PASS frontend already running')

    # Wrong service on a ProcureX port must not be killed.
    $occupied = Start-Process -FilePath $python -ArgumentList @('-m', 'http.server', '8000', '--bind', '127.0.0.1') `
        -WorkingDirectory $projectRoot -PassThru -WindowStyle Hidden
    $manualProcesses.Add($occupied)
    Wait-Until { Test-Port 8000 } 15 'Occupied-port fixture did not start.'
    $failure = Start-Launcher
    Assert-True ($failure.WaitForExit(30000)) 'Occupied-port launch did not exit.'
    Assert-True ($failure.ExitCode -ne 0) 'Occupied-port launch unexpectedly succeeded.'
    Assert-True (-not $occupied.HasExited) 'Launcher killed an unknown port owner.'
    Stop-ManualProcess $occupied
    Wait-Until { -not (Test-Port 8000) } 20 'Occupied-port fixture did not stop.'
    $results.Add('PASS backend occupied port protection')

    # The frontend port receives the same wrong-service protection.
    $occupiedFrontend = Start-Process -FilePath $python `
        -ArgumentList @('-m', 'http.server', '3000', '--bind', '127.0.0.1') `
        -WorkingDirectory $projectRoot -PassThru -WindowStyle Hidden
    $manualProcesses.Add($occupiedFrontend)
    Wait-Until { Test-Port 3000 } 15 'Frontend occupied-port fixture did not start.'
    $frontendFailure = Start-Launcher
    Assert-True ($frontendFailure.WaitForExit(30000)) 'Frontend occupied-port launch did not exit.'
    Assert-True ($frontendFailure.ExitCode -ne 0) 'Frontend occupied-port launch unexpectedly succeeded.'
    Assert-True (-not $occupiedFrontend.HasExited) 'Launcher killed the unknown frontend port owner.'
    Stop-ManualProcess $occupiedFrontend
    Wait-Until { -not (Test-Port 3000) } 20 'Frontend occupied-port fixture did not stop.'
    $results.Add('PASS frontend occupied port protection')

    # Explicit invalid dependency override must fail clearly and leave no service.
    $savedPython = $env:PROCUREX_PYTHON
    $env:PROCUREX_PYTHON = Join-Path $projectRoot 'missing-python.exe'
    try {
        $missing = Start-Launcher
        Assert-True ($missing.WaitForExit(30000)) 'Missing-dependency launch did not exit.'
        Assert-True ($missing.ExitCode -ne 0) 'Missing-dependency launch unexpectedly succeeded.'
    } finally {
        $env:PROCUREX_PYTHON = $savedPython
    }
    Assert-True (-not (Test-Port 8000) -and -not (Test-Port 3000)) 'Missing-dependency test left a service running.'
    $results.Add('PASS missing dependency')

    # Restart after a complete stop proves stale state does not block persistence.
    $restart = Start-Launcher
    Wait-Healthy $restart
    $restartState = Read-State
    Assert-True ($restartState.ContainsKey('launcher_pid')) 'Restart state is missing the launcher PID.'
    Invoke-StopLauncher
    Assert-True ($restart.WaitForExit(30000)) 'Restart supervisor did not exit.'
    Wait-Stopped
    Assert-True (-not (Test-Path -LiteralPath $statePath)) 'State file remained after restart shutdown.'
    $results.Add('PASS restart persistence')
}
finally {
    try {
        $stop = Start-Process -FilePath $launcher -ArgumentList @('--stop', '--no-browser', '--no-dialog') `
            -WorkingDirectory $projectRoot -PassThru -WindowStyle Hidden
        $stop.WaitForExit(10000) | Out-Null
    } catch { }
    foreach ($process in $manualProcesses) { Stop-ManualProcess $process }
}

$results | ForEach-Object { Write-Host $_ }
Write-Host "Launcher integration tests passed: $($results.Count)"
