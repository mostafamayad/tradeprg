$env:NODE_ENV = 'development'
$logFile = Join-Path $PSScriptRoot 'server-run.log'
$ErrorActionPreference = 'Continue'
Set-Location -LiteralPath $PSScriptRoot
node server.js 2>&1 | ForEach-Object { "$_" | Out-File -FilePath $logFile -Append -Encoding UTF8 }
