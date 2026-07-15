param(
  [Parameter(Mandatory = $true)]
  [string]$InstallerPath
)

$ErrorActionPreference = 'Stop'
$installer = (Resolve-Path -LiteralPath $InstallerPath).Path
$token = [guid]::NewGuid().ToString('N')
$installDir = Join-Path $env:TEMP "margin-installer-$token"
$userDataDir = Join-Path $env:TEMP "margin-user-data-$token"
$appProcess = $null

function Get-ProcessTreeIds([int]$RootId) {
  $ids = New-Object System.Collections.Generic.List[int]
  $pending = New-Object System.Collections.Generic.Queue[int]
  $pending.Enqueue($RootId)

  while ($pending.Count -gt 0) {
    $parentId = $pending.Dequeue()
    if ($ids.Contains($parentId)) { continue }
    $ids.Add($parentId)
    Get-CimInstance Win32_Process |
      Where-Object { $_.ParentProcessId -eq $parentId } |
      ForEach-Object { $pending.Enqueue([int]$_.ProcessId) }
  }

  return @($ids)
}

function Stop-ProcessTree([System.Diagnostics.Process]$Process) {
  if ($null -eq $Process) { return }
  $ids = Get-ProcessTreeIds $Process.Id
  $ids |
    Sort-Object -Descending -Unique |
    ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }
}

function Wait-MarginApi([System.Diagnostics.Process]$Process) {
  for ($attempt = 0; $attempt -lt 60; $attempt++) {
    if ($Process.HasExited) {
      throw "Margin exited before the backend became ready (exit $($Process.ExitCode))."
    }

    $ids = Get-ProcessTreeIds $Process.Id
    $ports = @(
      Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue |
        Where-Object { $_.OwningProcess -in $ids } |
        Select-Object -ExpandProperty LocalPort -Unique
    )

    foreach ($port in $ports) {
      try {
        $health = Invoke-RestMethod -Uri "http://127.0.0.1:$port/health" -TimeoutSec 1
        if ($health.ok -eq $true -and $health.data.name -eq 'Margin') {
          return "http://127.0.0.1:$port"
        }
      } catch {
        # The backend is still starting or this listener is an Electron helper.
      }
    }

    Start-Sleep -Milliseconds 500
  }

  throw 'Margin backend did not become ready within 30 seconds.'
}

function Start-Margin([string]$Executable, [string]$UserData) {
  return Start-Process `
    -FilePath $Executable `
    -ArgumentList "--user-data-dir=$UserData" `
    -WindowStyle Hidden `
    -PassThru
}

function Remove-SmokeDirectory([string]$Path) {
  if (-not (Test-Path -LiteralPath $Path)) { return }
  $resolved = (Resolve-Path -LiteralPath $Path).Path
  $tempRoot = (Resolve-Path -LiteralPath $env:TEMP).Path.TrimEnd('\') + '\'
  if (-not $resolved.StartsWith($tempRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to remove a smoke directory outside TEMP: $resolved"
  }
  Remove-Item -LiteralPath $resolved -Recurse -Force
}

try {
  $install = Start-Process `
    -FilePath $installer `
    -ArgumentList @('/S', "/D=$installDir") `
    -Wait `
    -PassThru
  if ($install.ExitCode -ne 0) {
    throw "Installer failed with exit code $($install.ExitCode)."
  }

  $executable = Join-Path $installDir 'Margin.exe'
  if (-not (Test-Path -LiteralPath $executable)) {
    throw "Installed executable was not found: $executable"
  }

  $appProcess = Start-Margin $executable $userDataDir
  $firstApi = Wait-MarginApi $appProcess
  $health = Invoke-RestMethod -Uri "$firstApi/health" -TimeoutSec 3
  if ($health.ok -ne $true -or $health.data.name -ne 'Margin') {
    throw 'Installed application returned an invalid health response.'
  }

  $payload = @{ message = 'Packaged persistence smoke check.' } | ConvertTo-Json
  $chat = Invoke-RestMethod `
    -Uri "$firstApi/chat" `
    -Method Post `
    -ContentType 'application/json' `
    -Body $payload `
    -TimeoutSec 10
  if ($chat.ok -ne $true) { throw 'Installed chat request failed.' }

  $databasePath = Join-Path $userDataDir 'data\echo.sqlite'
  if (-not (Test-Path -LiteralPath $databasePath)) {
    throw "Installed application did not create its user database: $databasePath"
  }

  Stop-ProcessTree $appProcess
  $appProcess = $null
  Start-Sleep -Milliseconds 500

  $appProcess = Start-Margin $executable $userDataDir
  $secondApi = Wait-MarginApi $appProcess
  $memory = Invoke-RestMethod -Uri "$secondApi/memory" -TimeoutSec 5
  if ($memory.ok -ne $true -or @($memory.data.memories).Count -lt 1) {
    throw 'Installed application data did not survive relaunch.'
  }

  Stop-ProcessTree $appProcess
  $appProcess = $null

  $uninstaller = Join-Path $installDir 'Uninstall Margin.exe'
  if (-not (Test-Path -LiteralPath $uninstaller)) {
    throw "Uninstaller was not found: $uninstaller"
  }
  $uninstall = Start-Process -FilePath $uninstaller -ArgumentList '/S' -Wait -PassThru
  if ($uninstall.ExitCode -ne 0) {
    throw "Uninstaller failed with exit code $($uninstall.ExitCode)."
  }

  for ($attempt = 0; $attempt -lt 20 -and (Test-Path -LiteralPath $installDir); $attempt++) {
    Start-Sleep -Milliseconds 250
  }
  if (Test-Path -LiteralPath $installDir) {
    throw 'Uninstall left the application installation directory behind.'
  }
  if (-not (Test-Path -LiteralPath $databasePath)) {
    throw 'Uninstall unexpectedly removed user data.'
  }

  Write-Output "PASS: Margin Windows installer smoke test ($firstApi -> $secondApi)"
} finally {
  Stop-ProcessTree $appProcess
  Remove-SmokeDirectory $installDir
  Remove-SmokeDirectory $userDataDir
}
