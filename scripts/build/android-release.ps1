[CmdletBinding()]
param(
  [ValidateSet('aab', 'arm64')][string]$Mode = 'arm64'
)

$ErrorActionPreference = 'Stop'
$repositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$defaultSdk = Join-Path $env:LOCALAPPDATA 'Android\Sdk'
if (-not $env:ANDROID_HOME -and (Test-Path -LiteralPath $defaultSdk -PathType Container)) {
  $env:ANDROID_HOME = $defaultSdk
}
if (-not $env:ANDROID_SDK_ROOT -and $env:ANDROID_HOME) {
  $env:ANDROID_SDK_ROOT = $env:ANDROID_HOME
}
$releaseName = if ($Mode -eq 'aab') { 'app-release.aab' } else { 'app-release-arm64.apk' }
$gradleOutput = if ($Mode -eq 'aab') {
  'android\app\build\outputs\bundle\release\app-release.aab'
} else {
  'android\app\build\outputs\apk\release\app-release.apk'
}

if ($repositoryRoot -match '[^\x00-\x7F]') {
  $stagingParent = 'C:\twb'
  New-Item -ItemType Directory -Force -Path $stagingParent | Out-Null
  $stagingRoot = Join-Path $stagingParent ([guid]::NewGuid().ToString('N').Substring(0, 8))
  try {
    & git.exe -C $repositoryRoot worktree add --detach $stagingRoot HEAD
    if ($LASTEXITCODE -ne 0) { throw 'Unable to create the ASCII-safe release worktree.' }
    # Signing credentials are gitignored; carry them into the staging tree so the
    # release signing gate (preReleaseBuild) can run against the real keystore.
    $sourceKeystoreProps = Join-Path $repositoryRoot 'android\keystore.properties'
    $sourceKeystoreFile = Join-Path $repositoryRoot 'android\app\pos-release.keystore'
    if (-not (Test-Path -LiteralPath $sourceKeystoreProps -PathType Leaf) -or
        -not (Test-Path -LiteralPath $sourceKeystoreFile -PathType Leaf)) {
      throw 'Release signing is not configured in the source tree (android/keystore.properties or android/app/pos-release.keystore missing).'
    }
    Copy-Item -LiteralPath $sourceKeystoreProps -Destination (Join-Path $stagingRoot 'android\keystore.properties') -Force
    Copy-Item -LiteralPath $sourceKeystoreFile -Destination (Join-Path $stagingRoot 'android\app\pos-release.keystore') -Force
    Push-Location $stagingRoot
    try {
      & npm.cmd ci --prefer-offline --no-audit --no-fund
      if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed in the release worktree.' }
      $scriptName = if ($Mode -eq 'aab') { 'android:release:aab' } else { 'android:release:arm64' }
      & npm.cmd run $scriptName
      if ($LASTEXITCODE -ne 0) { throw "Android $Mode release build failed in the release worktree." }
    } finally {
      Pop-Location
    }
    $artifact = Join-Path $stagingRoot $gradleOutput
    if (-not (Test-Path -LiteralPath $artifact -PathType Leaf)) {
      throw "Release build completed without expected artifact: $gradleOutput"
    }
    $releaseRoot = Join-Path $repositoryRoot '.release-artifacts'
    New-Item -ItemType Directory -Force -Path $releaseRoot | Out-Null
    $destination = Join-Path $releaseRoot $releaseName
    Copy-Item -LiteralPath $artifact -Destination $destination -Force
    Write-Output $destination
    Get-FileHash -LiteralPath $destination -Algorithm SHA256
  } finally {
    # Remove generated Android/CMake and node_modules trees while the staging
    # checkout is still a valid worktree. Git's long-path handling is more
    # reliable here than asking `worktree remove` to delete them implicitly.
    if (Test-Path -LiteralPath $stagingRoot -PathType Container) {
      & git.exe -c core.longpaths=true -C $stagingRoot clean -ffdx *> $null
    }
    & git.exe -c core.longpaths=true -C $repositoryRoot worktree remove --force $stagingRoot *> $null
    & git.exe -C $repositoryRoot worktree prune *> $null
    if ([System.IO.Directory]::Exists($stagingRoot)) {
      try {
        [System.IO.Directory]::Delete("\\?\$stagingRoot", $true)
      } catch {
        Write-Warning "Long-path cleanup failed for ${stagingRoot}: $($_.Exception.Message)"
      }
    }
    if (Test-Path -LiteralPath $stagingRoot) {
      Write-Warning "Release staging directory could not be fully removed: $stagingRoot"
    }
  }
  exit 0
}

if (-not (Test-Path -LiteralPath (Join-Path $repositoryRoot 'android\gradlew.bat'))) {
  Push-Location $repositoryRoot
  try {
    & npx.cmd expo prebuild --platform android --no-install
    if ($LASTEXITCODE -ne 0) { throw 'Expo Android prebuild failed.' }
  } finally {
    Pop-Location
  }
}

$env:NODE_ENV = 'production'
Push-Location (Join-Path $repositoryRoot 'android')
try {
  if ($Mode -eq 'aab') {
    & .\gradlew.bat bundleRelease --no-daemon
  } else {
    & .\gradlew.bat assembleRelease '-PreactNativeArchitectures=arm64-v8a' --no-daemon
  }
  if ($LASTEXITCODE -ne 0) { throw "Android $Mode release build failed." }
} finally {
  Pop-Location
}
