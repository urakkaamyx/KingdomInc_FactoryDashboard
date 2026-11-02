$ErrorActionPreference = 'Stop'
$recordPath = Join-Path $PSScriptRoot 'Verification\server.json'
if (-not (Test-Path -LiteralPath $recordPath)) { Write-Output 'No recorded dashboard server.'; return }
$record = Get-Content -LiteralPath $recordPath -Raw | ConvertFrom-Json
$owned = Get-CimInstance Win32_Process -Filter ('ProcessId=' + [int]$record.pid)
if ($null -eq $owned) { Write-Output 'Dashboard server is already stopped.'; return }
$expectedScript = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot 'serve.py')).Path
if (-not $owned.CommandLine.Contains($expectedScript) -or $owned.Name -notmatch '^python(w)?\.exe$') { throw 'The recorded process does not match this dashboard. Nothing was stopped.' }
Stop-Process -Id $owned.ProcessId
Write-Output 'Factory Dashboard stopped.'
