param([ValidateSet('Start','Stop')][string]$Action = 'Start', [switch]$NoBrowser)
$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$runtime = Join-Path $root 'logs\public-launcher'
$null = New-Item -ItemType Directory -Force -Path $runtime
$stateFile = Join-Path $runtime 'state.json'
$desktop = [Environment]::GetFolderPath('Desktop')
$urlFile = Join-Path $desktop 'PROCUREX PUBLIC URL.txt'
$state = @{}
$created = @()
$lock = $null
function Save-State {
    $state | ConvertTo-Json -Depth 6 | Set-Content "$stateFile.tmp" -Encoding UTF8
    Move-Item -LiteralPath "$stateFile.tmp" -Destination $stateFile -Force
}
function Get-Owned($record) {
    if (!$record) { return $null }
    $p = Get-Process -Id $record.pid -ErrorAction SilentlyContinue
    if ($p -and $p.StartTime.ToUniversalTime().Ticks.ToString() -eq $record.started) { return $p }
    return $null
}
function Stop-Owned($record) {
    $p = Get-Owned $record
    if (!$p) { return }
    # Snapshot descendants only while their recorded parent is still alive.
    $children = @(Get-CimInstance Win32_Process -Filter "ParentProcessId = $($p.Id)" | Where-Object { $_.CreationDate -ge $p.StartTime })
    foreach ($child in $children) {
        $cp = Get-Process -Id $child.ProcessId -ErrorAction SilentlyContinue
        if ($cp) { Stop-Owned @{pid=$cp.Id;started=$cp.StartTime.ToUniversalTime().Ticks.ToString()} }
    }
    $p = Get-Owned $record
    if ($p) { Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue }
}
function Start-Owned($name, $exe, $arguments, $working) {
    if ($name -ne 'build') {
        $log = Join-Path $root "logs\procurex-$name.log"
        if (Test-Path $log) { Move-Item -LiteralPath $log -Destination "$log.previous" -Force }
        $request = @{executable=$exe;arguments=$arguments;working=$working;log=$log} | ConvertTo-Json -Compress
        $encoded = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($request))
        $childId = & $python "$PSScriptRoot\start-detached.py" $encoded
        if ($LASTEXITCODE -ne 0 -or "$childId" -notmatch '^\d+$') { throw "Could not detach $name. See $log" }
        $p = Get-Process -Id ([int]$childId) -ErrorAction Stop
        $state[$name] = @{pid=$p.Id;started=$p.StartTime.ToUniversalTime().Ticks.ToString();detached=$true;log=$log}
        $script:created += $name
        Save-State
        return
    }
    foreach ($suffix in @('log','error.log')) {
        $log = Join-Path $runtime "procurex-$name.$suffix"
        if (Test-Path $log) { Move-Item -LiteralPath $log -Destination "$log.previous" -Force }
    }
    $p = Start-Process -FilePath $exe -ArgumentList $arguments -WorkingDirectory $working -WindowStyle Hidden -PassThru -RedirectStandardOutput "$runtime\procurex-$name.log" -RedirectStandardError "$runtime\procurex-$name.error.log"
    # Retain a native handle before exit; Windows PowerShell otherwise loses ExitCode.
    $null = $p.Handle
    $script:lastStarted = $p
    $state[$name] = @{pid=$p.Id;started=$p.StartTime.ToUniversalTime().Ticks.ToString()}
    $script:created += $name
    Save-State
}
function Http($url) {
    try { return Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 8 } catch { return $null }
}
function Build-Fingerprint {
    $files = @(
        Get-ChildItem "$root\frontend\src", "$root\frontend\public" -File -Recurse
        Get-ChildItem "$root\frontend" -File | Where-Object { $_.Name -match '\.(js|json|lock)$|^\.env' }
    ) | Sort-Object FullName
    $manifest = ($files | ForEach-Object { $_.FullName + ':' + (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash }) -join "`n"
    $sha = [Security.Cryptography.SHA256]::Create()
    try { return [Convert]::ToBase64String($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes('launcher-v1' + $manifest))) } finally { $sha.Dispose() }
}
function Wait-Http($url, $pattern, $seconds = 90) {
    $until = (Get-Date).AddSeconds($seconds)
    do {
        $response = Http $url
        if ($response -and $response.StatusCode -eq 200 -and $response.Content -match $pattern) { return }
        Start-Sleep -Seconds 2
    } while ((Get-Date) -lt $until)
    throw "HTTP readiness failed: $url. See logs in $runtime"
}
function Wait-Public($url, $pattern) {
    $until = (Get-Date).AddSeconds(120)
    do {
        $response = Http $url
        if ($response -and $response.StatusCode -eq 200 -and $response.Content -match $pattern) { return }
        # A router can return NXDOMAIN for new Quick Tunnel names. Verify through
        # Cloudflare DNS without changing DNS settings or disabling HTTPS validation.
        $hostName = ([Uri]$url).DnsSafeHost
        try {
            $dnsFailed = $false
            try { $null = [Net.Dns]::GetHostAddresses($hostName) } catch { $dnsFailed = $true }
            if (!$dnsFailed) { Start-Sleep 2; continue }
            $addresses = @(Resolve-DnsName $hostName -Server 1.1.1.1 -Type A -ErrorAction Stop | Where-Object IPAddress)
            if ($addresses.Count -gt 0) {
                $target = '{0}:443:{1}' -f $hostName, $addresses[0].IPAddress
                $body = & curl.exe --silent --show-error --fail --noproxy '*' --max-time 12 --resolve $target $url 2> "$runtime\public-probe.error.log"
                if ($LASTEXITCODE -eq 0 -and ($body -join "`n") -match $pattern) {
                    $script:dnsWarning = $true
                    return
                }
            }
        } catch { }
        Start-Sleep 2
    } while ((Get-Date) -lt $until)
    throw "Public HTTPS readiness failed: $url. See $runtime"
}
function Check-Port($port, $name) {
    $listeners = @(Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue)
    if (!$listeners) { return $false }
    $owned = Get-Owned $state[$name]
    foreach ($listener in $listeners) {
        $process = Get-CimInstance Win32_Process -Filter "ProcessId = $($listener.OwningProcess)"
        $command = [string]$process.CommandLine
        $ours = $owned -and ($owned.Id -eq $process.ProcessId -or $owned.Id -eq $process.ParentProcessId)
        if (!$ours) {
            $ours = $name -eq 'backend' -and $command.Contains("$root\.venv\Scripts\python.exe") -and $command -match 'uvicorn\s+server:app'
        }
        if (!$ours) { throw "Port $port is occupied by $($process.Name) (PID $($process.ProcessId)); ownership of a compatible ProcureX $name could not be verified. Nothing was stopped. Close that service or use STOP PROCUREX first." }
    }
    Write-Host "Reusing verified ProcureX $name on port $port."
    return $true
}
try {
    try { $lock = [IO.File]::Open("$runtime\operation.lock", 'OpenOrCreate', 'ReadWrite', 'None') }
    catch { throw 'Another ProcureX START or STOP operation is in progress. Wait for it to finish.' }
    if (Test-Path $stateFile) {
        $saved = Get-Content $stateFile -Raw | ConvertFrom-Json
        foreach ($property in $saved.PSObject.Properties) { $state[$property.Name] = $property.Value }
    }
    if ($Action -eq 'Stop') {
        foreach ($name in @('tunnel','frontend','backend','build')) { Stop-Owned $state[$name]; $state.Remove($name) }
        $state.Remove('url'); Save-State
        if (Test-Path $urlFile) { Set-Content $urlFile 'ProcureX public tunnel is stopped.' }
        Write-Host 'ProcureX launcher processes stopped. Independently started services were preserved.'
        exit 0
    }
    $python = Join-Path $root '.venv\Scripts\python.exe'
    if (!(Test-Path $python)) { throw 'The existing .venv Python environment is missing. Restore the project environment; the launcher will not recreate it or change the database.' }
    $node = (Get-Command node.exe -ErrorAction Stop).Source
    $cloud = Get-Command cloudflared.exe -ErrorAction SilentlyContinue
    if (!$cloud) { throw 'cloudflared is missing. Install the official Cloudflare.cloudflared package using Windows Package Manager, then double-click START again. See launcher/public/README.md.' }
    $backendRunning = Check-Port 8000 'backend'
    $frontendRunning = Check-Port 3000 'frontend'
    Write-Host '[1/5] Checking existing database and starting backend...'
    if (!$backendRunning) {
        & $python "$PSScriptRoot\database-check.py" *> "$runtime\database-check.log"
        if ($LASTEXITCODE -ne 0) { throw "Existing database/environment check failed. See $runtime\database-check.log. No initialization was run." }
        $env:PROCUREX_SKIP_DATABASE_INIT = '1'
        Start-Owned 'backend' $python '-m uvicorn server:app --host 127.0.0.1 --port 8000 --no-access-log' "$root\backend"
    }
    Write-Host '[2/5] Waiting for API...'
    Wait-Http 'http://127.0.0.1:8000/api/' 'Procurement ERP API'
    Write-Host '[3/5] Building and starting frontend...'
    if (!$frontendRunning) {
        $craco = "$root\frontend\node_modules\@craco\craco\dist\bin\craco.js"
        if (!(Test-Path $craco)) { throw 'Frontend dependencies are missing. Restore the existing frontend node_modules before starting.' }
        # Keep the normal build and environment files intact. A slash becomes an empty origin after trailing-slash normalization.
        $env:REACT_APP_BACKEND_URL = '/'
        $env:REACT_APP_PUBLIC_API_URL = '/'
        $env:BUILD_PATH = 'build-launcher'
        $env:GENERATE_SOURCEMAP = 'false'
        $env:BROWSER = 'none'
        $fingerprint = Build-Fingerprint
        $stamp = "$runtime\build.sha256"
        if (!(Test-Path "$root\frontend\build-launcher\index.html") -or !(Test-Path $stamp) -or (Get-Content $stamp -Raw).Trim() -ne $fingerprint) {
        Start-Owned 'build' $node "`"$craco`" build" "$root\frontend"
        $build = $script:lastStarted
        if ($build -and !$build.WaitForExit(300000)) { throw 'Frontend build timed out. See procurex-build logs.' }
        if (!$build -or $build.ExitCode -ne 0 -or !(Test-Path "$root\frontend\build-launcher\index.html")) { throw "Frontend build failed (exit $($build.ExitCode)). See $runtime\procurex-build.error.log" }
        $state.Remove('build'); Save-State
        Set-Content $stamp $fingerprint
        } else { Write-Host 'Using current compiled frontend.' }
        Start-Owned 'frontend' $node "`"$PSScriptRoot\frontend.cjs`"" $root
    }
    Wait-Http 'http://127.0.0.1:3000/' '<div id="root">'
    Wait-Http 'http://127.0.0.1:3000/api/' 'Procurement ERP API'
    Write-Host '[4/5] Starting Cloudflare Quick Tunnel...'
    if (!(Get-Owned $state['tunnel'])) {
        # Explicit isolated config avoids interference with a user's named tunnel config.
        Set-Content "$runtime\quick-tunnel.yml" 'url: http://127.0.0.1:3000'
        Start-Owned 'tunnel' $cloud.Source "tunnel --config `"$runtime\quick-tunnel.yml`" --url http://127.0.0.1:3000 --no-autoupdate --protocol http2 --metrics 127.0.0.1:0" $root
        $state.Remove('url')
        $until = (Get-Date).AddSeconds(90)
        do {
            $output = Get-Content "$root\logs\procurex-tunnel.log" -Raw -ErrorAction SilentlyContinue
            if ($output -match 'https://[a-z0-9-]+\.trycloudflare\.com') { $state['url'] = $Matches[0]; break }
            if (!(Get-Owned $state['tunnel'])) { throw "Cloudflare exited. See $root\logs\procurex-tunnel.log" }
            Start-Sleep 2
        } while ((Get-Date) -lt $until)
    }
    if (!$state['url']) { throw 'Cloudflare did not produce a public URL within 90 seconds.' }
    Save-State
    Wait-Public $state['url'] '<div id="root">'
    Wait-Public "$($state['url'])/api/" 'Procurement ERP API'
    if (!(Get-Owned $state['tunnel'])) { throw 'Cloudflare exited during public readiness checks.' }
    $null = Check-Port 3000 'frontend'
    Wait-Http 'http://127.0.0.1:3000/api/' 'Procurement ERP API' 15
    $status = @($state['url'])
    if ($dnsWarning) { $status += 'Public HTTPS verified. This PC/router DNS cannot resolve this hostname. Try another connection or browser secure DNS; no system settings were changed.' }
    Set-Content -LiteralPath $urlFile -Value $status -Encoding UTF8
    $status | Set-Content "$runtime\startup-status.txt" -Encoding UTF8
    try { Set-Clipboard -Value $state['url'] } catch { }
    Write-Host "[5/5] PROCUREX IS ONLINE`nPublic URL: $($state['url'])" -ForegroundColor Green
    if ($dnsWarning) { Write-Warning 'Public HTTPS is verified, but this PC/router DNS cannot currently resolve the Quick Tunnel URL. If the browser reports DNS errors, try the URL on another connection or use secure DNS in your browser. No DNS settings were changed.' }
    Write-Host "Tunnel PID: $($state['tunnel'].pid). Startup is complete; this window can close safely."
    if (!$NoBrowser) {
        try { Start-Process $state['url'] } catch { Write-Warning "Browser could not be opened. The services remain running; open the URL saved at $urlFile" }
    }
} catch {
    foreach ($name in @('tunnel','frontend','backend','build')) { if ($created -contains $name) { Stop-Owned $state[$name]; $state.Remove($name) } }
    if ($lock) {
        if (!(Get-Owned $state['tunnel'])) {
            $state.Remove('url')
            if (Test-Path $urlFile) { Set-Content $urlFile 'ProcureX public tunnel is offline. Run START PROCUREX PUBLIC again.' }
        }
        Save-State
    }
    Write-Host "PROCUREX STARTUP ERROR: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
} finally { if ($lock) { $lock.Dispose() } }
