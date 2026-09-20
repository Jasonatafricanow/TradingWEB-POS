[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)][string]$ArtifactPath,
  [string]$PackageName = 'com.tradingweb.pos',
  [string]$ActivityName = '.MainActivity',
  [ValidateRange(10,100)][int]$Iterations = 10,
  [string]$OutputRoot = '.perf-results',
  [string]$AdbPath = ''
)

$ErrorActionPreference = 'Stop'

function Resolve-AdbPath {
  param([string]$Requested)
  if ($Requested) {
    if (-not (Test-Path -LiteralPath $Requested -PathType Leaf)) {
      throw "ADB executable not found: $Requested"
    }
    return (Resolve-Path -LiteralPath $Requested).Path
  }
  $command = Get-Command adb -ErrorAction SilentlyContinue
  if ($command) { return $command.Source }
  $sdkCandidates = @(
    $env:ANDROID_SDK_ROOT,
    $env:ANDROID_HOME,
    (Join-Path $env:LOCALAPPDATA 'Android\Sdk')
  ) | Where-Object { $_ }
  foreach ($sdk in $sdkCandidates) {
    $candidate = Join-Path $sdk 'platform-tools\adb.exe'
    if (Test-Path -LiteralPath $candidate -PathType Leaf) { return $candidate }
  }
  throw 'ADB executable is unavailable. Install Android platform-tools or pass -AdbPath.'
}

function Invoke-Adb {
  param([Parameter(Mandatory=$true)][string[]]$AdbArguments)
  $output = & $script:ResolvedAdb @AdbArguments 2>&1
  if ($LASTEXITCODE -ne 0) { throw "adb $($AdbArguments -join ' ') failed: $output" }
  return $output
}

function Get-Percentile {
  param([double[]]$Values, [double]$Percentile)
  $sorted = @($Values | Sort-Object)
  if ($sorted.Count -eq 0) { throw 'Cannot aggregate an empty metric.' }
  $index = [Math]::Ceiling($Percentile * $sorted.Count) - 1
  return [double]$sorted[[Math]::Max(0, [Math]::Min($index, $sorted.Count - 1))]
}

function Get-MetricSummary {
  param([double[]]$Values)
  $sorted = @($Values | Sort-Object)
  return [ordered]@{
    count = $sorted.Count
    min = [double]$sorted[0]
    median = Get-Percentile -Values $sorted -Percentile 0.5
    p95 = Get-Percentile -Values $sorted -Percentile 0.95
    max = [double]$sorted[-1]
  }
}

if (-not (Test-Path -LiteralPath $ArtifactPath -PathType Leaf)) {
  throw "Release artifact not found: $ArtifactPath"
}
$resolvedArtifact = (Resolve-Path -LiteralPath $ArtifactPath).Path
$script:ResolvedAdb = Resolve-AdbPath -Requested $AdbPath
$deviceLines = @(& $script:ResolvedAdb devices | Select-String "`tdevice$")
if ($deviceLines.Count -ne 1) {
  throw "Expected exactly one authorized Android target; found $($deviceLines.Count)."
}

$timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$outputDirectory = Join-Path $OutputRoot $timestamp
New-Item -ItemType Directory -Path $outputDirectory -Force | Out-Null
$runsPath = Join-Path $outputDirectory 'runs.jsonl'
$rawLaunchPath = Join-Path $outputDirectory 'launch-output.txt'

Invoke-Adb -AdbArguments @('install', '-r', $resolvedArtifact) | Out-Null
$installedPackage = (Invoke-Adb -AdbArguments @('shell', 'pm', 'path', $PackageName) | Out-String).Trim()
if (-not $installedPackage.StartsWith('package:')) {
  throw "Installed package does not match $PackageName."
}

1..2 | ForEach-Object {
  Invoke-Adb -AdbArguments @('shell', 'am', 'force-stop', $PackageName) | Out-Null
  Invoke-Adb -AdbArguments @('shell', 'am', 'start', '-W', '-n', "$PackageName/$ActivityName") | Out-Null
}

$runs = @()
for ($iteration = 1; $iteration -le $Iterations; $iteration += 1) {
  Invoke-Adb -AdbArguments @('shell', 'am', 'force-stop', $PackageName) | Out-Null
  Invoke-Adb -AdbArguments @('logcat', '-c') | Out-Null
  $launchLines = @(Invoke-Adb -AdbArguments @('shell', 'am', 'start', '-W', '-n', "$PackageName/$ActivityName"))
  $launchLines | Add-Content -LiteralPath $rawLaunchPath -Encoding utf8
  $pairs = @{}
  foreach ($line in $launchLines) {
    if ($line -match '^\s*(Status|TotalTime|WaitTime):\s*(.+)\s*$') {
      $pairs[$Matches[1]] = $Matches[2]
    }
  }
  if ($pairs.Status -ne 'ok') { throw "Launch $iteration failed with status '$($pairs.Status)'." }
  $perfLines = @(Invoke-Adb -AdbArguments @('logcat', '-d', '-s', 'ReactNativeJS:I', '*:S') | Select-String 'TWPOS_PERF')
  $measure = $null
  foreach ($line in $perfLines) {
    if ($line -match '\[TWPOS_PERF\]\s+(\{.+\})') {
      $sample = $Matches[1] | ConvertFrom-Json
      if ($sample.kind -eq 'measure' -and $sample.name -eq 'cold_start') { $measure = $sample }
    }
  }
  if (-not $measure) { throw "Launch $iteration did not emit a cold_start performance measure." }
  $run = [ordered]@{
    iteration = $iteration
    totalTimeMs = [int]$pairs.TotalTime
    waitTimeMs = [int]$pairs.WaitTime
    appColdStartMs = [double]$measure.durationMs
    package = $PackageName
    device = ((Invoke-Adb -AdbArguments @('shell', 'getprop', 'ro.product.model')) | Out-String).Trim()
    sdk = [int](((Invoke-Adb -AdbArguments @('shell', 'getprop', 'ro.build.version.sdk')) | Out-String).Trim())
  }
  $runs += [pscustomobject]$run
  $run | ConvertTo-Json -Compress | Add-Content -LiteralPath $runsPath -Encoding utf8
}

Invoke-Adb -AdbArguments @('shell', 'dumpsys', 'gfxinfo', $PackageName) | Set-Content -LiteralPath (Join-Path $outputDirectory 'gfxinfo.txt') -Encoding utf8
Invoke-Adb -AdbArguments @('shell', 'dumpsys', 'meminfo', $PackageName) | Set-Content -LiteralPath (Join-Path $outputDirectory 'meminfo.txt') -Encoding utf8
$summary = [ordered]@{
  artifact = $resolvedArtifact
  artifactSha256 = (Get-FileHash -LiteralPath $resolvedArtifact -Algorithm SHA256).Hash
  package = $PackageName
  iterations = $Iterations
  totalTimeMs = Get-MetricSummary -Values @($runs.totalTimeMs)
  waitTimeMs = Get-MetricSummary -Values @($runs.waitTimeMs)
  appColdStartMs = Get-MetricSummary -Values @($runs.appColdStartMs)
}
$summary | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $outputDirectory 'summary.json') -Encoding utf8
Write-Output (Resolve-Path $outputDirectory).Path
