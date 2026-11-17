<#
    Momentum Engine - start everything.

    Checks prerequisites, verifies Databricks connectivity, starts the UI dev
    server, and reports status. Every step is logged to logs\start-<date>.log.

    Why PowerShell and not a .bat: `timeout` does not block without a console,
    `start` re-spawns on failure, cmd cannot parse JSON, and MSYS_NO_PATHCONV
    does not exist outside Git Bash. All four caused real bugs in the .bat
    version, including a launch loop.

    Exit codes
      0  UI running, Databricks reachable
      1  missing prerequisite (node / python / databricks CLI)
      2  Databricks auth or connectivity failure
      3  UI failed to start
#>

[CmdletBinding()]
param(
    [int]$Port = 5180,
    [string]$WarehouseId = '557a444c183dfce2',
    [string]$HostUrl = 'https://dbc-0a49a6d2-f0ff.cloud.databricks.com',
    [switch]$NoBrowser,
    [switch]$RefreshSnapshot
)

$ErrorActionPreference = 'Continue'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root

$logDir = Join-Path $root 'logs'
if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir | Out-Null }
$logFile = Join-Path $logDir ("start-{0}.log" -f (Get-Date -Format 'yyyy-MM-dd'))
$uiLog   = Join-Path $logDir ("ui-{0}.log"    -f (Get-Date -Format 'yyyy-MM-dd'))
$tmpDir  = Join-Path $logDir 'tmp'
if (-not (Test-Path $tmpDir)) { New-Item -ItemType Directory -Path $tmpDir | Out-Null }

function Write-Log {
    param([string]$Message, [string]$Level = 'INFO')
    $line = "[{0}] {1,-5} {2}" -f (Get-Date -Format 'HH:mm:ss'), $Level, $Message
    if ($Level -eq 'ERROR') { Write-Host $line -ForegroundColor Red }
    elseif ($Level -eq 'WARN') { Write-Host $line -ForegroundColor Yellow }
    elseif ($Level -eq 'OK') { Write-Host $line -ForegroundColor Green }
    else { Write-Host $line }
    # Single writer, retried on transient locks. The UI logs elsewhere.
    for ($i = 0; $i -lt 5; $i++) {
        try { Add-Content -Path $logFile -Value $line -Encoding utf8; break }
        catch { Start-Sleep -Milliseconds 200 }
    }
}

function Fail {
    param([string]$Message, [int]$Code)
    Write-Host ''
    Write-Host ('=' * 62) -ForegroundColor Red
    Write-Host " FAILED: $Message" -ForegroundColor Red
    Write-Host ('=' * 62) -ForegroundColor Red
    Write-Host ''
    Write-Host " Log: $logFile"
    Write-Log "FAILED: $Message" 'ERROR'
    Read-Host 'Press Enter to close'
    exit $Code
}

# ---------------------------------------------------------------- main

Write-Host ''
Write-Host ('=' * 62) -ForegroundColor Cyan
Write-Host '  Momentum Engine' -ForegroundColor Cyan
Write-Host ('=' * 62) -ForegroundColor Cyan
Write-Host "  Log: $logFile"
Write-Host ''
Write-Log ("=" * 40 + " run " + (Get-Date -Format 'yyyy-MM-dd HH:mm:ss') + " " + ("=" * 40))

# ---- 1. prerequisites -----------------------------------------

Write-Log 'Checking prerequisites...'

$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) { Fail 'node not found on PATH. Install Node.js.' 1 }
Write-Log ("  node " + (& node -v 2>$null)) 'OK'

$py = Get-Command python -ErrorAction SilentlyContinue
if (-not $py) { Fail 'python not found on PATH.' 1 }
Write-Log ("  " + (& python --version 2>&1)) 'OK'

$dbx = Get-Command databricks -ErrorAction SilentlyContinue
if (-not $dbx) { Fail 'databricks CLI not found. Run: winget install Databricks.DatabricksCLI' 1 }
Write-Log '  databricks CLI found' 'OK'

$uiDir = Join-Path $root 'ui'
if (-not (Test-Path (Join-Path $uiDir 'node_modules'))) {
    Write-Log '  node_modules missing - running npm install (first run, be patient)'
    Push-Location $uiDir
    & npm install 2>&1 | Add-Content -Path $logFile
    $npmOk = ($LASTEXITCODE -eq 0)
    Pop-Location
    if (-not $npmOk) { Fail 'npm install failed. See the log.' 1 }
    Write-Log '  npm install done' 'OK'
} else {
    Write-Log '  ui\node_modules present' 'OK'
}

# ---- 2. Databricks ---------------------------------------------

Write-Log 'Checking Databricks auth...'
$tokFile = Join-Path $tmpDir 'tok.json'
& databricks auth token --output json > $tokFile 2> (Join-Path $tmpDir 'tok.err')
if ($LASTEXITCODE -ne 0) {
    Get-Content (Join-Path $tmpDir 'tok.err') -ErrorAction SilentlyContinue |
        ForEach-Object { Write-Log "    $_" 'ERROR' }
    Remove-Item $tokFile -ErrorAction SilentlyContinue
    Fail "Databricks not authenticated. Run: databricks auth login --host $HostUrl" 2
}
Remove-Item $tokFile -ErrorAction SilentlyContinue
Write-Log '  auth token OK' 'OK'

Write-Log "Checking warehouse $WarehouseId..."
$whState = 'UNKNOWN'
try {
    # The CLI accepts the raw API path here; no path-conversion flag needed.
    $whJson = & databricks api get "/api/2.0/sql/warehouses/$WarehouseId" --output json 2>&1
    if ($LASTEXITCODE -ne 0) { throw ($whJson -join ' ') }
    $whState = ($whJson | ConvertFrom-Json).state
} catch {
    Fail "Warehouse $WarehouseId unreachable. Check VPN / workspace access. ($_)" 2
}
Write-Log "  warehouse state: $whState" 'OK'

if ($whState -eq 'STOPPED') {
    Write-Log '  NOTE: warehouse STOPPED - auto-starts on first query (30-60s)' 'WARN'
}

Write-Log 'Running a live query against silver_nodes...'
# A serverless warehouse returns PENDING while it cold-starts, and the export
# helper treats any non-SUCCEEDED state as fatal. Poll until it is actually up
# so a cold start does not look like a failure.
$rows = $null
$attempts = 0
$maxAttempts = 24   # ~2 minutes at 5s
while ($attempts -lt $maxAttempts) {
    $attempts++
    try {
        $out = & python -c @"
import importlib.util
spec = importlib.util.spec_from_file_location('e', 'scripts/export_ui_data.py')
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
t = m.token()
print(m.query('SELECT count(*) AS n FROM momentum.momentum.silver_nodes', t)[0]['n'])
"@ 2>&1
        if ($LASTEXITCODE -eq 0) {
            $rows = ($out | Select-Object -Last 1).ToString().Trim()
            break
        }
        $err = ($out -join ' ')
        if ($err -match 'PENDING') {
            if ($attempts -eq 1) { Write-Log '  warehouse cold-starting, waiting...' 'WARN' }
        } elseif ($err -match 'RUNNING|QUEUED|STARTING') {
            if ($attempts -eq 1) { Write-Log '  warehouse starting, waiting...' 'WARN' }
        } else {
            Fail "Live query failed. Warehouse reachable but SQL errored. ($err)" 2
        }
    } catch {
        Fail "Live query failed: $_" 2
    }
    Start-Sleep -Seconds 5
}

if (-not $rows) {
    Fail "Warehouse did not become queryable within $($maxAttempts * 5)s. Try again, or start it in the Databricks UI." 2
}
Write-Log "  silver_nodes rows: $rows" 'OK'

if ($rows -eq '0') {
    Write-Log '  WARNING: silver_nodes is empty - run the Silver notebook' 'WARN'
}

# ---- 3. snapshot -----------------------------------------------

$snapshot = Join-Path $uiDir 'public\data\snapshot.json'
if ($RefreshSnapshot -or -not (Test-Path $snapshot)) {
    Write-Log 'Refreshing snapshot...'
    & python (Join-Path $root 'scripts\export_ui_data.py') 2>&1 | Add-Content -Path $logFile
    if ($LASTEXITCODE -ne 0) {
        Write-Log '  WARNING: snapshot export failed - UI starts with no data' 'WARN'
    } else {
        Write-Log '  snapshot exported' 'OK'
    }
} else {
    $age = [int]((Get-Date) - (Get-Item $snapshot).LastWriteTime).TotalHours
    Write-Log "  snapshot.json present (${age}h old; use -RefreshSnapshot to update)" 'OK'
}

# ---- 4. UI -----------------------------------------------------

Write-Log "Checking port $Port..."
$existing = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
$uiStatus = 'not started'

if ($existing) {
    $probe = try {
        (Invoke-WebRequest -Uri "http://localhost:$Port/" -UseBasicParsing -TimeoutSec 3).StatusCode
    } catch { $null }
    if (-not $probe) {
        Fail "port $Port is held by another process that is not responding. Close it and re-run." 3
    }
    Write-Log "  UI already running on http://localhost:$Port/" 'OK'
    $uiStatus = 'running (pre-existing)'
} else {
    Write-Log 'Starting UI dev server...'
    # Redirect the UI's output to its OWN file. Sharing $logFile with a live
    # child process causes file locks on every append.
    $proc = Start-Process -FilePath 'cmd.exe' `
        -ArgumentList '/c', "npm run dev > `"$uiLog`" 2>&1" `
        -WorkingDirectory $uiDir `
        -WindowStyle Hidden -PassThru

    $deadline = (Get-Date).AddSeconds(45)
    $up = $false
    while ((Get-Date) -lt $deadline) {
        Start-Sleep -Milliseconds 700
        if ($proc.HasExited) { break }
        try {
            $code = (Invoke-WebRequest -Uri "http://localhost:$Port/" -UseBasicParsing -TimeoutSec 2).StatusCode
            if ($code -eq 200) { $up = $true; break }
        } catch { }
    }

    if (-not $up) {
        $tail = ''
        if (Test-Path $uiLog) { $tail = (Get-Content $uiLog -Tail 15) -join "`n" }
        Write-Log "  UI log tail:`n$tail" 'ERROR'
        Fail "UI did not respond on port $Port within 45s. See $uiLog" 3
    }
    Write-Log "  UI responding on http://localhost:$Port/ (pid $($proc.Id))" 'OK'
    $uiStatus = "running (started, pid $($proc.Id))"
}

# ---- summary ---------------------------------------------------

Write-Host ''
Write-Host ('=' * 62) -ForegroundColor Green
Write-Host '  READY' -ForegroundColor Green
Write-Host ('=' * 62) -ForegroundColor Green
Write-Host ("  UI           http://localhost:$Port/")
Write-Host ("               $uiStatus")
Write-Host ("  Databricks   $HostUrl")
Write-Host ("  Warehouse    $WarehouseId  ($whState)")
Write-Host ("  silver_nodes $rows rows")
Write-Host ("  Log          $logFile")
Write-Host ("  UI log       $uiLog")
Write-Host ('=' * 62) -ForegroundColor Green
Write-Host ''
Write-Log "READY - UI $uiStatus | warehouse $whState | silver_nodes $rows" 'OK'

Remove-Item $tmpDir -Recurse -Force -ErrorAction SilentlyContinue

if (-not $NoBrowser) { Start-Process "http://localhost:$Port/" }
exit 0
