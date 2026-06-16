$ErrorActionPreference = 'Stop'

$processes = Get-CimInstance Win32_Process |
  Where-Object {
    $_.CommandLine -like '*pnpm.cjs start:test:dev*' -or
    $_.CommandLine -like '*NODE_ENV=test nest start --watch*'
  }

if (-not $processes) {
  Write-Output 'Lucent test runtime is not running.'
  exit 0
}

foreach ($process in $processes) {
  try {
    Stop-Process -Id $process.ProcessId -Force -ErrorAction Stop
    Write-Output "Stopped process $($process.ProcessId)."
  } catch {
    Write-Warning "Failed to stop process $($process.ProcessId): $($_.Exception.Message)"
  }
}
