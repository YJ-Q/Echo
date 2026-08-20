$ErrorActionPreference = 'Stop'

$NodeVersion = '22.23.1'
$archiveName = "node-v$NodeVersion-win-x64.zip"
$distributionName = "node-v$NodeVersion-win-x64"
$repositoryRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$runtimeRoot = [System.IO.Path]::GetFullPath((Join-Path $repositoryRoot '.runtime'))
$targetDirectory = [System.IO.Path]::GetFullPath((Join-Path $runtimeRoot $distributionName))
$nodeExe = Join-Path $targetDirectory 'node.exe'

$runtimePrefix = $runtimeRoot.TrimEnd([System.IO.Path]::DirectorySeparatorChar) + [System.IO.Path]::DirectorySeparatorChar
if (-not $targetDirectory.StartsWith($runtimePrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
  throw "Unsafe runtime target: $targetDirectory"
}

if (Test-Path -LiteralPath $nodeExe) {
  $installedVersion = (& $nodeExe --version).Trim()
  if ($installedVersion -eq "v$NodeVersion") {
    Write-Output $installedVersion
    exit 0
  }
  throw "Existing runtime has unexpected version: $installedVersion"
}

$temporaryRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("margin-pi-runtime-" + [guid]::NewGuid().ToString('N'))
$archivePath = Join-Path $temporaryRoot $archiveName
$manifestPath = Join-Path $temporaryRoot 'SHASUMS256.txt'
$extractRoot = Join-Path $temporaryRoot 'extracted'
$baseUrl = "https://nodejs.org/dist/v$NodeVersion"

try {
  New-Item -ItemType Directory -Path $temporaryRoot | Out-Null
  Invoke-WebRequest -Uri "$baseUrl/$archiveName" -OutFile $archivePath
  Invoke-WebRequest -Uri "$baseUrl/SHASUMS256.txt" -OutFile $manifestPath

  $manifestLine = Get-Content -LiteralPath $manifestPath | Where-Object { $_ -match "\s+$([regex]::Escape($archiveName))$" } | Select-Object -First 1
  if (-not $manifestLine) {
    throw "Official hash for $archiveName was not found"
  }
  $expectedHash = ($manifestLine -split '\s+')[0].ToUpperInvariant()
  $actualHash = (Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash.ToUpperInvariant()
  if ($actualHash -ne $expectedHash) {
    throw "Hash mismatch for $archiveName"
  }

  New-Item -ItemType Directory -Path $runtimeRoot -Force | Out-Null
  New-Item -ItemType Directory -Path $extractRoot | Out-Null
  Expand-Archive -LiteralPath $archivePath -DestinationPath $extractRoot
  $extractedDirectory = Join-Path $extractRoot $distributionName
  if (-not (Test-Path -LiteralPath (Join-Path $extractedDirectory 'node.exe'))) {
    throw 'Downloaded Node archive did not contain node.exe'
  }
  Move-Item -LiteralPath $extractedDirectory -Destination $targetDirectory

  $installedVersion = (& $nodeExe --version).Trim()
  if ($installedVersion -ne "v$NodeVersion") {
    throw "Installed runtime has unexpected version: $installedVersion"
  }
  Write-Output $installedVersion
} finally {
  if (Test-Path -LiteralPath $temporaryRoot) {
    Remove-Item -LiteralPath $temporaryRoot -Recurse -Force
  }
}
