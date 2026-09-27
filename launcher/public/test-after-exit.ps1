# Run after STOP to exercise a fresh Desktop START through its actual cmd.exe host.
$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$runtime = "$root\logs\public-launcher"
$desktop = [Environment]::GetFolderPath('Desktop')
$batch = Join-Path $desktop 'START PROCUREX PUBLIC.bat'
$starter = Start-Process -FilePath $env:ComSpec -ArgumentList "/d /c `"`"$batch`"`"" -WindowStyle Hidden -PassThru -RedirectStandardOutput "$runtime\exit-test-start.log" -RedirectStandardError "$runtime\exit-test-start.error.log"
$null = $starter.Handle
if (!$starter.WaitForExit(300000)) { throw 'START did not exit automatically within five minutes.' }
if ($starter.ExitCode -ne 0) { throw "START exited with $($starter.ExitCode). Inspect exit-test-start logs." }
$exited = [DateTime]::UtcNow
Write-Host "START cmd.exe PID $($starter.Id) exited successfully at $($exited.ToString('o')). Waiting 60 seconds."
$state = Get-Content "$runtime\state.json" -Raw | ConvertFrom-Json
function Verify-Services {
    foreach ($name in @('frontend','tunnel')) {
        $p = Get-Process -Id $state.$name.pid -ErrorAction Stop
        if ($p.StartTime.ToUniversalTime().Ticks.ToString() -ne $state.$name.started) { throw "$name PID was reused" }
        if (!$state.$name.detached) { throw "$name was not started using explicit detachment" }
    }
    foreach ($port in @(8000,3000)) {
        if (!(Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue)) { throw "Port $port is not listening" }
    }
    $front = Invoke-WebRequest 'http://127.0.0.1:3000/' -UseBasicParsing -TimeoutSec 10
    $api = Invoke-WebRequest 'http://127.0.0.1:3000/api/' -UseBasicParsing -TimeoutSec 10
    if ($front.Content -notmatch '<div id="root">' -or $api.Content -notmatch 'Procurement ERP API') { throw 'Local readiness failed' }
}
Verify-Services
while (([DateTime]::UtcNow - $exited).TotalSeconds -lt 60) { Start-Sleep -Seconds 2 }
Verify-Services
$publicHost = ([Uri]$state.url).DnsSafeHost
$normalDns = $true
try { $null = [Net.Dns]::GetHostAddresses($publicHost) } catch { $normalDns = $false }
$address = (Resolve-DnsName $publicHost -Server 1.1.1.1 -Type A | Where-Object IPAddress | Select-Object -First 1).IPAddress
if (!$address) { throw 'Public DNS did not return an address' }
$resolve = '{0}:443:{1}' -f $publicHost, $address
foreach ($entry in @(@('/','<div id="root">'), @('/api/','Procurement ERP API'))) {
    $body = & curl.exe --silent --show-error --fail --noproxy '*' --resolve $resolve --max-time 20 ($state.url + $entry[0])
    if ($LASTEXITCODE -ne 0 -or ($body -join "`n") -notmatch $entry[1]) { throw "Public HTTPS check failed for $($entry[0])" }
}
$result = [ordered]@{
    launcherPid = $starter.Id; launcherExitedUtc = $exited.ToString('o')
    verifiedUtc = [DateTime]::UtcNow.ToString('o'); elapsedSeconds = ([DateTime]::UtcNow - $exited).TotalSeconds
    frontendPid = $state.frontend.pid; tunnelPid = $state.tunnel.pid
    processesSurvived = $true; backendListening = $true; frontendListening = $true
    publicHtml = 'PASS'; publicApi = 'PASS'; systemDnsResolves = $normalDns; url = $state.url
}
$result | ConvertTo-Json | Set-Content "$runtime\exit-test-result.json"
$result | ConvertTo-Json | Write-Host
