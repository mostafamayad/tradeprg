param([string]$BaseUrl = "http://localhost:3000")

$outFile = "D:\tradeprg\webapp\backend\test-output\backup-test-results.txt"
"Backup/Restore Test $([DateTime]::UtcNow.ToString('o'))" | Out-File $outFile

# Login
try {
    $body = @{email='admin@3smcompany.com';password='admin123'} | ConvertTo-Json
    $r = Invoke-RestMethod -Uri "$BaseUrl/api/auth/login" -Method POST -Body $body -ContentType 'application/json' -ErrorAction Stop
    $token = $r.token
    "Login OK" | Out-File $outFile -Append
} catch {
    "Login FAILED: $_" | Out-File $outFile -Append
    exit 1
}

# Pre-reset health
$before = Invoke-RestMethod -Uri "$BaseUrl/api/health"
"Before reset: gen=$($before.pool.generation) size=$($before.pool.size) avail=$($before.pool.available)" | Out-File $outFile -Append

# Phase 1: Send sustained concurrent requests to company/info (public, DB-heavy)
Write-Host "Phase 1: Sustained load (30 concurrent)..."
$loadOk = 0
$loadFail = 0
$loadCrit = 0
$loadLock = New-Object System.Threading.Mutex($false)

$jobs = @()
for ($i = 0; $i -lt 30; $i++) {
    $jobs += Start-Job -ScriptBlock {
        param($url)
        $ok=0; $fail=0; $crit=0
        $endTime = [DateTime]::UtcNow.AddSeconds(40)
        while ([DateTime]::UtcNow -lt $endTime) {
            try {
                $r = Invoke-RestMethod -Uri "$url/api/company/info" -TimeoutSec 10 -ErrorAction Stop
                $ok++
                $bodyStr = "$($r | ConvertTo-Json -Depth 2)"
                if ($bodyStr -match "connection\.on|ConnectionClosed|EINVALIDSTATE|ENOCONN") { $crit++ }
            } catch { $fail++ }
        }
        return @{ok=$ok; fail=$fail; crit=$crit}
    } -ArgumentList $BaseUrl
}
"Started 30 concurrent workers" | Out-File $outFile -Append

Start-Sleep -Seconds 5

# Phase 2: Trigger pool reset while load is running
Write-Host "Phase 2: Triggering pool reset..."
try {
    $reset = Invoke-RestMethod -Uri "$BaseUrl/api/debug/reset-pool" -Method POST -ErrorAction Stop
    "Reset response OK. New gen=$($reset.health.pool.generation)" | Out-File $outFile -Append
} catch {
    "Reset FAILED: $_" | Out-File $outFile -Append
}

Start-Sleep -Seconds 30

# Phase 3: Verify health after reset
Write-Host "Phase 3: Verifying health after reset..."
$after = Invoke-RestMethod -Uri "$BaseUrl/api/health"
"After reset: gen=$($after.pool.generation) size=$($after.pool.size) avail=$($after.pool.available) reconnect=$($after.pool.totalReconnects)" | Out-File $outFile -Append

# Verify pool is functional
try {
    $r = Invoke-RestMethod -Uri "$BaseUrl/api/company/info" -TimeoutSec 10 -ErrorAction Stop
    "Pool functional after reset: OK" | Out-File $outFile -Append
} catch {
    "Pool NOT functional after reset: $_" | Out-File $outFile -Append
}

# Verify generation changed
if ($after.pool.generation -gt $before.pool.generation) {
    "Pool generation properly incremented: $($before.pool.generation) → $($after.pool.generation)" | Out-File $outFile -Append
} else {
    "WARNING: Pool generation did not change!" | Out-File $outFile -Append
}

if ($after.pool.totalReconnects -gt $before.pool.totalReconnects) {
    "Reconnect count incremented: $($before.pool.totalReconnects) → $($after.pool.totalReconnects)" | Out-File $outFile -Append
}

# Collect results
Start-Sleep -Seconds 10
$totalOk=0; $totalFail=0; $totalCrit=0
foreach ($job in $jobs) {
    $result = $null
    try { $result = Receive-Job -Job $job -ErrorAction SilentlyContinue } catch {}
    if ($result) { $totalOk += $result.ok; $totalFail += $result.fail; $totalCrit += $result.crit }
    try { Remove-Job -Job $job -ErrorAction SilentlyContinue } catch {}
}
"`nWorker results: ok=$totalOk fail=$totalFail critical=$totalCrit" | Out-File $outFile -Append
if ($totalCrit -gt 0) { "*** CRITICAL ERRORS DURING BACKUP TEST! ***" | Out-File $outFile -Append }

# Verify reconnect log shows the reset
$health = Invoke-RestMethod -Uri "$BaseUrl/api/health"
$health.recentLog | Select-Object -Last 5 | Out-File $outFile -Append
"Last reconnect: $($health.pool.lastReconnectTime)" | Out-File $outFile -Append

Get-Content $outFile
