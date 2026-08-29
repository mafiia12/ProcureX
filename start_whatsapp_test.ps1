# Local WhatsApp live-test helper.
#
# Starts (or reuses) the existing ProcureX full-surface backend/frontend on
# the SAME local procurement.db, brings up a temporary Cloudflare "quick"
# tunnel to the backend, keeps backend/.env's TRUSTED_HOSTS in sync with the
# tunnel's (ephemeral) hostname, and prints the exact webhook URL to paste
# into Meta.
#
# Never touches Meta credentials: this script only ever edits the
# TRUSTED_HOSTS line in backend/.env (needed so the backend accepts requests
# arriving through the tunnel's hostname) - WHATSAPP_ENABLED/PHONE_NUMBER_ID/
# ACCESS_TOKEN/VERIFY_TOKEN/APP_SECRET are set by you, once, directly in
# backend/.env, and are never read, printed, or modified here.
#
# The tunnel URL is a free Cloudflare "quick tunnel" - it has no login/account
# and is NOT stable: every time this script (re)starts the tunnel you get a
# new random *.trycloudflare.com hostname, and you must re-paste the new
# webhook URL into Meta's dashboard.

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root

$backendDir = Join-Path $root "backend"
$envPath = Join-Path $backendDir ".env"
$logsDir = Join-Path $root "logs"
New-Item -ItemType Directory -Force -Path $logsDir | Out-Null
$tunnelOutLog = Join-Path $logsDir "whatsapp-tunnel.out.log"
$tunnelErrLog = Join-Path $logsDir "whatsapp-tunnel.err.log"

function Test-PortOpen([int]$port) {
    try { [bool](Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction Stop) } catch { $false }
}

function Find-Cloudflared {
    $cmd = Get-Command cloudflared -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
    $fallback = "C:\Program Files (x86)\cloudflared\cloudflared.exe"
    if (Test-Path $fallback) { return $fallback }
    $fallback2 = "C:\Program Files\cloudflared\cloudflared.exe"
    if (Test-Path $fallback2) { return $fallback2 }
    return $null
}

$cloudflared = Find-Cloudflared
if (-not $cloudflared) {
    Write-Host "cloudflared was not found. Install it first: winget install --id Cloudflare.cloudflared -e" -ForegroundColor Red
    exit 1
}

# A re-run must not pile up extra tunnels (each one would be a distinct,
# useless URL) - stop any tunnel this script started before, then start one
# fresh one and treat it as the current URL.
$existingTunnel = Get-Process cloudflared -ErrorAction SilentlyContinue
if ($existingTunnel) {
    Write-Host "Stopping the previous quick tunnel before starting a new one..."
    $existingTunnel | Stop-Process -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 1
}

Write-Host "Starting a temporary Cloudflare quick tunnel to http://127.0.0.1:8000 ..."
Remove-Item $tunnelOutLog, $tunnelErrLog -ErrorAction SilentlyContinue
Start-Process -FilePath $cloudflared -ArgumentList "tunnel", "--url", "http://127.0.0.1:8000" `
    -RedirectStandardOutput $tunnelOutLog -RedirectStandardError $tunnelErrLog -NoNewWindow | Out-Null

$tunnelUrl = $null
$deadline = (Get-Date).AddSeconds(30)
while ((Get-Date) -lt $deadline -and -not $tunnelUrl) {
    Start-Sleep -Seconds 1
    foreach ($logFile in @($tunnelErrLog, $tunnelOutLog)) {
        if (-not $tunnelUrl -and (Test-Path $logFile)) {
            $match = Select-String -Path $logFile -Pattern "https://[a-z0-9-]+\.trycloudflare\.com" -ErrorAction SilentlyContinue | Select-Object -First 1
            if ($match) { $tunnelUrl = $match.Matches[0].Value }
        }
    }
}
if (-not $tunnelUrl) {
    Write-Host "Could not read the tunnel URL after 30s. Check $tunnelErrLog directly." -ForegroundColor Red
    exit 1
}
$tunnelHostName = ([Uri]$tunnelUrl).Host
Write-Host "Tunnel is up: $tunnelUrl"

# Merge the tunnel hostname into backend/.env's TRUSTED_HOSTS (idempotent,
# and drops any previous *.trycloudflare.com entry from an earlier run so
# this doesn't accumulate stale hosts over time).
$envLines = if (Test-Path $envPath) { @(Get-Content $envPath) } else { @() }
$trustedLineIndex = -1
for ($i = 0; $i -lt $envLines.Count; $i++) {
    if ($envLines[$i] -match '^\s*TRUSTED_HOSTS\s*=') { $trustedLineIndex = $i; break }
}
$baseHosts = @("localhost", "127.0.0.1", "testserver")
if ($trustedLineIndex -ge 0) {
    $existingValue = ($envLines[$trustedLineIndex] -split '=', 2)[1]
    $existingHosts = @($existingValue -split ',' | Where-Object { $_ -ne "" -and $_ -notmatch '\.trycloudflare\.com$' })
} else {
    $existingHosts = $baseHosts
}
$newHosts = @($existingHosts + $tunnelHostName | Select-Object -Unique)
$newLine = "TRUSTED_HOSTS=" + ($newHosts -join ',')

$backendWasRunning = Test-PortOpen 8000
$trustedHostsChanged = ($trustedLineIndex -lt 0) -or ($envLines[$trustedLineIndex] -ne $newLine)
if ($trustedLineIndex -ge 0) { $envLines[$trustedLineIndex] = $newLine } else { $envLines += $newLine }
# Windows PowerShell 5.1's -Encoding utf8 writes a BOM; write plain UTF-8
# without one so python-dotenv/.env tooling never has to think about it.
[System.IO.File]::WriteAllLines($envPath, $envLines, (New-Object System.Text.UTF8Encoding $false))

if ($backendWasRunning -and $trustedHostsChanged) {
    Write-Host "Backend is already running but does not trust this tunnel's hostname yet - restarting it..." -ForegroundColor Yellow
    try {
        $conn = Get-NetTCPConnection -LocalPort 8000 -State Listen -ErrorAction Stop
        Stop-Process -Id $conn.OwningProcess -Force
        Start-Sleep -Seconds 1
    } catch {}
    $backendWasRunning = $false
}

if (-not (Test-PortOpen 8000)) {
    Write-Host "Starting ProcureX backend (full surface, your existing procurement.db) ..."
    Start-Process -FilePath "cmd.exe" -ArgumentList "/k", "call `"$root\start_backend.bat`"" | Out-Null
} else {
    Write-Host "Backend already running on port 8000 - reusing it."
}

if (-not (Test-PortOpen 3000)) {
    Write-Host "Starting ProcureX frontend so you can open Settings ..."
    Start-Process -FilePath "cmd.exe" -ArgumentList "/k", "call `"$root\start_frontend.bat`"" | Out-Null
} else {
    Write-Host "Frontend already running on port 3000 - reusing it."
}

Write-Host "Waiting for the backend to become ready..."
$deadline = (Get-Date).AddSeconds(60)
$backendReady = $false
while ((Get-Date) -lt $deadline -and -not $backendReady) {
    try {
        $resp = Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 "http://127.0.0.1:8000/api/public/purchase-requests/health"
        if ($resp.StatusCode -eq 200) { $backendReady = $true } else { Start-Sleep -Seconds 2 }
    } catch { Start-Sleep -Seconds 2 }
}

$webhookUrl = "$tunnelUrl/api/integrations/whatsapp/webhook"
$publiclyReachable = $false
if ($backendReady) {
    # A bad verify_token is expected to come back as 403. Invoke-WebRequest
    # throws on non-2xx in both Windows PowerShell 5.1 and PowerShell 7 (the
    # 7-only -SkipHttpErrorCheck switch isn't available here), so check the
    # status via the caught exception's response instead.
    $probeUrl = "$webhookUrl`?hub.mode=subscribe&hub.verify_token=__probe__&hub.challenge=x"
    try {
        $resp = Invoke-WebRequest -UseBasicParsing -TimeoutSec 8 -Uri $probeUrl
        if ($resp.StatusCode -eq 403) { $publiclyReachable = $true }
    } catch {
        if ($_.Exception.Response -and [int]$_.Exception.Response.StatusCode -eq 403) {
            $publiclyReachable = $true
        }
    }
}

Write-Host ""
Write-Host "=================================================="
Write-Host " ProcureX WhatsApp live-test tunnel"
Write-Host "=================================================="
Write-Host "Local backend:       http://127.0.0.1:8000"
Write-Host "Public tunnel URL:   $tunnelUrl"
Write-Host "Webhook URL:         $webhookUrl"
if ($publiclyReachable) {
    Write-Host "Publicly reachable:  YES (got 403 on a bad verify token, as expected)"
} else {
    Write-Host "Publicly reachable:  COULD NOT CONFIRM - check $tunnelErrLog and logs\whatsapp-live-test-backend.log" -ForegroundColor Yellow
}
Write-Host "Backend ready:       $backendReady"
Write-Host ""
Write-Host "This is a free Cloudflare 'quick tunnel' with no account - the URL"
Write-Host "above is NOT stable. If you stop and re-run this script, you'll get"
Write-Host "a different URL and must paste the new webhook URL into Meta again."
Write-Host "=================================================="
