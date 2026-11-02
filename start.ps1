param([int]$Port = 17841, [switch]$NoBrowser)
$ErrorActionPreference = 'Stop'
& (Join-Path $PSScriptRoot 'run.ps1') -Port $Port
$address = 'http://127.0.0.1:' + $Port
$ready = $false
for ($attempt = 0; $attempt -lt 40; $attempt++) {
    try {
        $page = Invoke-WebRequest -Uri $address -UseBasicParsing -TimeoutSec 1
        if ($page.Content.Contains('Factory Planner')) { $ready = $true; break }
    } catch { }
    Start-Sleep -Milliseconds 100
}
if (-not $ready) { throw 'The dashboard did not start. Check _Mods\FactoryDashboard\Verification\server-errors.log.' }
if (-not $NoBrowser) { Start-Process -FilePath $address }
