$ErrorActionPreference = "Stop"

$root = "C:\Users\prati\OneDrive\Desktop\artfullhours"
$mongoExe = Join-Path $root "tools\mongodb\mongodb-win32-x86_64-windows-8.2.7\bin\mongod.exe"
$dbPath = Join-Path $root "tools\mongodb\data"
$serverScript = Join-Path $root "server\server.js"
$healthUrl = "http://localhost:5000/api/health"

if (-not (Test-Path $mongoExe)) {
  Write-Error "MongoDB executable not found at $mongoExe"
  exit 1
}

if (-not (Test-Path $dbPath)) {
  Write-Error "MongoDB data directory not found at $dbPath"
  exit 1
}

if (-not (Test-Path $serverScript)) {
  Write-Error "Server script not found at $serverScript"
  exit 1
}

$mongoProcess = Get-CimInstance Win32_Process | Where-Object {
  $_.Name -eq "mongod.exe" -and $_.CommandLine -like "*$dbPath*"
} | Select-Object -First 1

if (-not $mongoProcess) {
  Write-Output "Starting MongoDB..."
  Start-Process -FilePath $mongoExe -ArgumentList "--dbpath `"$dbPath`" --bind_ip 127.0.0.1 --port 27017" -WorkingDirectory $root -WindowStyle Minimized | Out-Null
  Write-Output "Waiting for MongoDB to initialize (5 seconds)..."
  Start-Sleep -Seconds 5
} else {
  Write-Output "MongoDB process already running (PID: $($mongoProcess.ProcessId))"
}

$nodeProcess = Get-CimInstance Win32_Process | Where-Object {
  $_.Name -eq "node.exe" -and $_.CommandLine -like "*$serverScript*"
} | Select-Object -First 1

if (-not $nodeProcess) {
  Write-Output "Starting Node.js server..."
  Start-Process -FilePath "node" -ArgumentList "`"$serverScript`"" -WorkingDirectory $root -WindowStyle Minimized | Out-Null
} else {
  Write-Output "Node.js process already running (PID: $($nodeProcess.ProcessId))"
}

$maxChecks = 30
$checkInterval = 500
$started = $false

Write-Output "Checking server health at $healthUrl (max 15 seconds)..."

for ($i = 0; $i -lt $maxChecks; $i++) {
  try {
    $health = Invoke-RestMethod -Uri $healthUrl -TimeoutSec 2
    if ($health.server -eq "online") {
      $started = $true
      Write-Output "✓ Server is online"
      Write-Output "✓ Database: $($health.database)"
      break
    }
  } catch {
    # Silently continue
  }
  Start-Sleep -Milliseconds $checkInterval
}

if (-not $started) {
  Write-Error "Backend did not become reachable at $healthUrl."
  Write-Output ""
  Write-Output "Troubleshooting steps:"
  Write-Output "1) Check that Node.js is installed: node --version"
  Write-Output "2) Verify MongoDB is running: Get-Process mongod"
  Write-Output "3) Check port 5000 is available: netstat -ano | findstr :5000"
  Write-Output "4) View server logs: Check for errors in server/server.js"
  Write-Output "5) Ensure npm dependencies are installed in server/ folder"
  exit 1
}

Write-Output "Backend is reachable at http://localhost:5000"
Write-Output "Health: $healthUrl"
