param(
  [switch]$RemoveVolumes
)

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot '..\..')
$composeFile = Join-Path $repoRoot 'docker-compose.dev.yml'

Push-Location $repoRoot
try {
  $dockerArgs = @('compose', '-f', $composeFile, 'down', '--remove-orphans')
  if ($RemoveVolumes) {
    $dockerArgs += '--volumes'
  }

  & docker @dockerArgs
  if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
  }
}
finally {
  Pop-Location
}
