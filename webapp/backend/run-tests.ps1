param(
    [string]$Mode = "all"
)

$LogDir = "D:\tradeprg\webapp\backend\test-output"
if (-not (Test-Path $LogDir)) { New-Item -ItemType Directory -Path $LogDir -Force | Out-Null }

$LogFile = Join-Path $LogDir "test-run-$Mode-$(Get-Date -Format 'yyyyMMdd-HHmmss').log"

# Write header
"[$(Get-Date -Format 'yyyy-MM-ddTHH:mm:ssZ')] Starting test mode=$Mode" | Out-File -FilePath $LogFile -Encoding UTF8

# Run the node process
$pinfo = New-Object System.Diagnostics.ProcessStartInfo
$pinfo.FileName = "node.exe"
$pinfo.Arguments = "test-runner.js $Mode"
$pinfo.WorkingDirectory = "D:\tradeprg\webapp\backend"
$pinfo.UseShellExecute = $false
$pinfo.RedirectStandardOutput = $true
$pinfo.RedirectStandardError = $true
$pinfo.CreateNoWindow = $true

$p = [System.Diagnostics.Process]::Start($pinfo)

# Read output as it comes (non-blocking)
$outTask = $p.StandardOutput.ReadToEndAsync()
$errTask = $p.StandardError.ReadToEndAsync()

# Wait with timeout based on mode
$timeout = switch ($Mode) {
    "load" { 1100000 }   # 18 min
    "backup" { 120000 }  # 2 min
    "memory" { 3900000 } # 65 min
    default { 120000 }
}

$exited = $p.WaitForExit($timeout)
if (-not $exited) { $p.Kill(); "[$(Get-Date -Format 'yyyy-MM-ddTHH:mm:ssZ')] TIMEOUT - process killed" | Out-File -FilePath $LogFile -Append -Encoding UTF8 }

$stdout = $outTask.Result
$stderr = $errTask.Result

# Append to log
$stdout | Out-File -FilePath $LogFile -Append -Encoding UTF8
if ($stderr) { "[STDERR] $stderr" | Out-File -FilePath $LogFile -Append -Encoding UTF8 }

"[$(Get-Date -Format 'yyyy-MM-ddTHH:mm:ssZ')] Exit code: $($p.ExitCode)" | Out-File -FilePath $LogFile -Append -Encoding UTF8
Write-Host "Test complete. Log: $LogFile"
