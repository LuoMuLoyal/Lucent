$ErrorActionPreference = 'Stop'

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot '..\..')
$logPath = Join-Path $repoRoot '.runtime-test.log'
$healthUrl = 'http://127.0.0.1:3000/api/v1/health'
$timeoutSeconds = 45

Push-Location $repoRoot
try {
  $existing = Get-CimInstance Win32_Process |
    Where-Object {
      $_.CommandLine -and
      $_.CommandLine -like "*$repoRoot*" -and
      (
        $_.CommandLine -like '*pnpm.cjs start:test:dev*' -or
        $_.CommandLine -like '*pnpm start:test:dev*' -or
        $_.CommandLine -like '*NODE_ENV=test nest start --watch*'
      )
    }

  foreach ($process in $existing) {
    try {
      Stop-Process -Id $process.ProcessId -Force -ErrorAction Stop
    } catch {
      Write-Warning "Failed to stop existing test runtime process $($process.ProcessId): $($_.Exception.Message)"
    }
  }
  Start-Sleep -Milliseconds 500

  $launcher = Start-Process `
    -FilePath 'powershell.exe' `
    -ArgumentList @(
      '-NoProfile',
      '-ExecutionPolicy', 'Bypass',
      '-Command',
      "Set-Location '$repoRoot'; pnpm start:test:dev *> '$logPath'"
    ) `
    -PassThru `
    -WindowStyle Hidden

  $deadline = (Get-Date).AddSeconds($timeoutSeconds)
  do {
    Start-Sleep -Milliseconds 500
    try {
      $response = Invoke-WebRequest -Uri $healthUrl -UseBasicParsing -TimeoutSec 3
      if ($response.StatusCode -eq 200) {
        Write-Output "Lucent test runtime is ready. launcherPid=$($launcher.Id)"
        exit 0
      }
    } catch {
      # Keep waiting until timeout.
    }
  } while ((Get-Date) -lt $deadline)

  Write-Error "Lucent test runtime did not become healthy within ${timeoutSeconds}s. See $logPath"
} finally {
  Pop-Location
}
