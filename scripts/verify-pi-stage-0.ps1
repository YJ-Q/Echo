$ErrorActionPreference = 'Stop'

$repositoryRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$runtimeDirectory = Join-Path $repositoryRoot '.runtime\node-v22.23.1-win-x64'
$nodeExe = Join-Path $runtimeDirectory 'node.exe'

function Invoke-Checked {
  param(
    [Parameter(Mandatory = $true)][string]$Executable,
    [Parameter(ValueFromRemainingArguments = $true)][string[]]$Arguments
  )
  & $Executable @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "Verification command failed with exit code ${LASTEXITCODE}: $Executable $Arguments"
  }
}

if (-not (Test-Path -LiteralPath $nodeExe)) {
  throw 'Pinned Node runtime is missing. Run scripts/bootstrap-pi-runtime.ps1.'
}

$nodeVersion = (& $nodeExe --version).Trim()
if ($LASTEXITCODE -ne 0 -or $nodeVersion -ne 'v22.23.1') {
  throw "Pinned Node runtime must be v22.23.1; received $nodeVersion"
}
Write-Output $nodeVersion
Invoke-Checked $nodeExe scripts/audit-pi-baseline.js
Invoke-Checked $nodeExe --test `
  test/piBaseline.test.js `
  test/piAudit.test.js `
  test/piRuntimeBootstrap.test.js `
  test/piSpikeTool.test.js `
  test/piSdkSpike.test.js `
  test/piAuditDocs.test.js `
  test/piStage0Verification.test.js

$testFiles = Get-ChildItem -LiteralPath (Join-Path $repositoryRoot 'test') -Filter '*.test.js' | Select-Object -ExpandProperty FullName
Invoke-Checked -Executable $nodeExe -Arguments (@('--test') + $testFiles)

$reportPath = Join-Path $repositoryRoot 'data\pi-spike\report.json'
if (-not $env:MARGIN_PI_PROVIDER -or -not $env:MARGIN_PI_MODEL -or -not (Test-Path -LiteralPath $reportPath)) {
  Write-Output 'pi_credentials_required: configure Pi authentication, set MARGIN_PI_PROVIDER and MARGIN_PI_MODEL, then run npm run spike:pi.'
  exit 3
}

$report = Get-Content -Raw -LiteralPath $reportPath | ConvertFrom-Json
$createdAt = [DateTimeOffset]::Parse($report.createdAt)
$ageMinutes = ([DateTimeOffset]::UtcNow - $createdAt).TotalMinutes
$valid = $report.ok -eq $true `
  -and -not [string]::IsNullOrWhiteSpace($report.runId) `
  -and $report.baseline.packageVersion -eq '0.84.2' `
  -and $report.baseline.license -eq 'MIT' `
  -and $report.observed.nodeVersion -eq '22.23.1' `
  -and $report.observed.provider -eq $env:MARGIN_PI_PROVIDER `
  -and $report.observed.modelId -eq $env:MARGIN_PI_MODEL `
  -and $ageMinutes -ge 0 -and $ageMinutes -le 15 `
  -and $report.observed.enabledBuiltInTools.Count -eq 0 `
  -and $report.checks.sessionCreated -eq $true `
  -and $report.checks.inMemorySessionCreated -eq $true `
  -and $report.checks.sessionRestored -eq $true `
  -and $report.checks.sessionForked -eq $true `
  -and $report.checks.forkParentMatched -eq $true `
  -and $report.checks.compactionStarted -eq $true `
  -and $report.checks.compactionEnded -eq $true `
  -and $report.checks.toolCalled -eq $true `
  -and $report.checks.nonceMatched -eq $true

if (-not $valid) {
  throw 'Pi Stage 0 report exists but does not satisfy the evidence contract.'
}

Write-Output 'Pi Stage 0 verification passed.'
