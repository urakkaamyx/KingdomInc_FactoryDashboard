param([int]$Port = 17841)
$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path -LiteralPath $PSScriptRoot).Path
$address = 'http://127.0.0.1:' + $Port
if (Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue) {
    $existing = Invoke-WebRequest -Uri $address -UseBasicParsing -TimeoutSec 3
    if (-not $existing.Content.Contains('Factory Planner')) { throw 'The dashboard port is used by another application.' }
    Write-Output ('Factory Dashboard is already running: ' + $address)
    return
}
$verification = Join-Path $projectRoot 'Verification'
New-Item -ItemType Directory -Path $verification -Force | Out-Null
$pythonPath = (Get-Command python -ErrorAction Stop).Source
$serverScript = Join-Path $projectRoot 'serve.py'
$process = Start-Process -FilePath $pythonPath -WorkingDirectory $projectRoot -WindowStyle Hidden -ArgumentList @(('"' + $serverScript + '"'),'--port',$Port) -RedirectStandardOutput (Join-Path $verification 'server.log') -RedirectStandardError (Join-Path $verification 'server-errors.log') -PassThru
@{pid=$process.Id;url=$address;startedAt=(Get-Date).ToString('o');script=$serverScript} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $verification 'server.json')
Write-Output ('Factory Dashboard: ' + $address)
