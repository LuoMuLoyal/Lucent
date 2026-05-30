$repoRoot = Resolve-Path (Join-Path $PSScriptRoot '..\..')
$previousNodeEnv = $env:NODE_ENV

Push-Location $repoRoot
try {
  & pnpm exec prisma generate
  if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
  }

  $env:NODE_ENV = 'development'
  & pnpm exec prisma migrate deploy
  if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
  }

  $env:NODE_ENV = 'test'
  & pnpm exec prisma migrate deploy
  if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
  }
}
finally {
  if ($null -eq $previousNodeEnv) {
    Remove-Item Env:NODE_ENV -ErrorAction SilentlyContinue
  }
  else {
    $env:NODE_ENV = $previousNodeEnv
  }

  Pop-Location
}
