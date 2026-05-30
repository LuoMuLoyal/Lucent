param(
  [switch]$Build,
  [string[]]$Services = @('postgres-dev', 'postgres-test', 'redis')
)

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot '..\..')
$composeFile = Join-Path $repoRoot 'docker-compose.dev.yml'

Push-Location $repoRoot
try {
  $dockerArgs = @('compose', '-f', $composeFile, 'up', '-d')
  if ($Build) {
    $dockerArgs += '--build'
  }
  $dockerArgs += $Services

  & docker @dockerArgs
  if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
  }
}
finally {
  Pop-Location
}
