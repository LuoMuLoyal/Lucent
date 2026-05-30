param(
  [ValidateSet('all', 'cn-products', 'drugbank-drugs', 'drugbank-links', 'drugbank-targets-all', 'drugbank-targets-active')]
  [string]$Command = 'all',
  [ValidateSet('development', 'test', 'production')]
  [string]$NodeEnv = 'development',
  [int]$BatchSize = 100,
  [int]$Limit,
  [string]$SourcePath,
  [string]$SourceVersion,
  [switch]$WithHash
)

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot '..\..')
$previousNodeEnv = $env:NODE_ENV

if ($BatchSize -le 0) {
  throw 'BatchSize must be a positive integer.'
}

if ($PSBoundParameters.ContainsKey('Limit') -and $Limit -le 0) {
  throw 'Limit must be a positive integer when provided.'
}

if ($Command -eq 'all' -and $PSBoundParameters.ContainsKey('SourcePath')) {
  throw 'SourcePath can only be used when importing a single dataset command.'
}

$importOrder = switch ($Command) {
  'all' {
    @(
      'drugbank-drugs',
      'drugbank-links',
      'drugbank-targets-all',
      'drugbank-targets-active',
      'cn-products'
    )
    break
  }
  default {
    @($Command)
  }
}

Push-Location $repoRoot
try {
  foreach ($importCommand in $importOrder) {
    $nodeArgs = @(
      'scripts/medicine/import-medicine-knowledge.js',
      $importCommand,
      '--batch-size',
      $BatchSize
    )

    if ($PSBoundParameters.ContainsKey('Limit')) {
      $nodeArgs += @('--limit', $Limit)
    }

    if ($PSBoundParameters.ContainsKey('SourcePath')) {
      $nodeArgs += @('--source', $SourcePath)
    }

    if ($PSBoundParameters.ContainsKey('SourceVersion')) {
      $nodeArgs += @('--source-version', $SourceVersion)
    }

    if ($WithHash) {
      $nodeArgs += '--with-hash'
    }

    Write-Host "Importing $importCommand with NODE_ENV=$NodeEnv..."

    $env:NODE_ENV = $NodeEnv
    & node @nodeArgs
    if ($LASTEXITCODE -ne 0) {
      exit $LASTEXITCODE
    }
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
