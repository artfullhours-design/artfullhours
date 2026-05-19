Get-CimInstance Win32_Process | Where-Object {
  ($_.Name -eq "mongod.exe" -and $_.CommandLine -like "*artfullhours\tools\mongodb*") -or
  ($_.Name -eq "node.exe" -and $_.CommandLine -like "*artfullhours\server\server.js*")
} | ForEach-Object {
  Stop-Process -Id $_.ProcessId -Force
}

Write-Output "Stopped local MongoDB and Node server for ArtfullHours."
