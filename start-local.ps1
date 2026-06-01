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
  Start-Process -FilePath $mongoExe -ArgumentList "--dbpath `"$dbPath`" --bind_ip 127.0.0.1 --port 27017" -WorkingDirectory $root -WindowStyle Minimized | Out-Null
  Start-Sleep -Seconds 2
}

$nodeProcess = Get-CimInstance Win32_Process | Where-Object {
  $_.Name -eq "node.exe" -and $_.CommandLine -like "*$serverScript*"
} | Select-Object -First 1

if (-not $nodeProcess) {
  Start-Process -FilePath "node" -ArgumentList "`"$serverScript`"" -WorkingDirectory $root -WindowStyle Minimized | Out-Null
}

$maxChecks = 20
$started = $false

for ($i = 0; $i -lt $maxChecks; $i++) {
  try {
    $health = Invoke-RestMethod -Uri $healthUrl -TimeoutSec 2
    if ($health.server -eq "online") {
      $started = $true
      break
    }
  } catch {
  }
  Start-Sleep -Milliseconds 500
}

if (-not $started) {
  Write-Error "Backend did not become reachable at $healthUrl."
  Write-Output "Checks to run:"
  Write-Output "1) Ensure Node.js is installed and available in PATH"
  Write-Output "2) Run npm install in server and project root"
  Write-Output "3) Check that port 5000 is not blocked by another process"
  exit 1
}

Write-Output "Backend is reachable at http://localhost:5000"
Write-Output "Health: $healthUrl"
