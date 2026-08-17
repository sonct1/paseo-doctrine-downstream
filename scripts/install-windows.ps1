#Requires -Version 5.1
[CmdletBinding()]
param(
  [string]$Tag = $env:PASEO_DOWNSTREAM_TAG,
  [string]$Prefix,
  [string]$BinDir,
  [string]$Listen = "127.0.0.1:6767",
  [switch]$NoStart,
  [switch]$SkipFoundation
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest
$Repository = "webplode/paseo-doctrine-downstream"
$ApiRoot = if ($env:PASEO_DOWNSTREAM_API_ROOT) { $env:PASEO_DOWNSTREAM_API_ROOT } else { "https://api.github.com/repos/$Repository" }
$DownloadRoot = if ($env:PASEO_DOWNSTREAM_DOWNLOAD_ROOT) { $env:PASEO_DOWNSTREAM_DOWNLOAD_ROOT } else { "https://github.com/$Repository/releases/download" }

if ($env:OS -ne "Windows_NT") {
  throw "This installer supports Windows only."
}
if ([Runtime.InteropServices.RuntimeInformation]::OSArchitecture -ne [Runtime.InteropServices.Architecture]::X64) {
  throw "The Windows downstream release currently supports x64 only."
}
if (-not $Tag) {
  $release = Invoke-RestMethod -Headers @{ Accept = "application/vnd.github+json"; "X-GitHub-Api-Version" = "2022-11-28" } -Uri "$ApiRoot/releases?per_page=1"
  $Tag = @($release)[0].tag_name
}
if (-not $Tag -or -not $Tag.StartsWith("paseo-v")) {
  throw "Expected a downstream tag shaped like paseo-v<version>; received $Tag"
}

$Version = $Tag.Substring("paseo-v".Length)
$BundleName = "paseo-web-cli-$Version-windows-x64"
$Archive = "$BundleName.zip"
$Checksum = "$Archive.sha256"
$TemporaryRoot = Join-Path ([IO.Path]::GetTempPath()) "paseo-downstream-install-$([Guid]::NewGuid().ToString('N'))"
New-Item -ItemType Directory -Path $TemporaryRoot | Out-Null
try {
  $ArchivePath = Join-Path $TemporaryRoot $Archive
  $ChecksumPath = Join-Path $TemporaryRoot $Checksum
  Write-Output "Installing Paseo Foundation Downstream $Version for Windows x64"
  Invoke-WebRequest -UseBasicParsing -Uri "$DownloadRoot/$Tag/$Archive" -OutFile $ArchivePath
  Invoke-WebRequest -UseBasicParsing -Uri "$DownloadRoot/$Tag/$Checksum" -OutFile $ChecksumPath
  $Expected = ((Get-Content -Raw $ChecksumPath).Trim() -split "\s+")[0]
  if ($Expected -notmatch "^[0-9a-f]{64}$") { throw "Downloaded checksum is not a lowercase SHA-256 digest." }
  $Actual = (Get-FileHash -Algorithm SHA256 $ArchivePath).Hash.ToLowerInvariant()
  if ($Actual -ne $Expected) { throw "SHA-256 verification failed for $Archive." }

  Expand-Archive -Path $ArchivePath -DestinationPath $TemporaryRoot -Force
  $Bundle = Join-Path $TemporaryRoot $BundleName
  $ManifestPath = Join-Path $Bundle "manifest.json"
  $ArtifactInstaller = Join-Path $Bundle "install.ps1"
  if (-not (Test-Path $ManifestPath) -or -not (Test-Path $ArtifactInstaller)) {
    throw "Downloaded release does not contain the expected downstream bundle."
  }
  $Manifest = Get-Content -Raw $ManifestPath | ConvertFrom-Json
  if ($Manifest.product -ne "Paseo WebUI + CLI" -or $Manifest.platform -ne "win32" -or $Manifest.arch -ne "x64") {
    throw "Downloaded release manifest does not match this Windows host."
  }

  $InstallArguments = @{ Listen = $Listen }
  if ($Prefix) { $InstallArguments.Prefix = $Prefix }
  if ($BinDir) { $InstallArguments.BinDir = $BinDir }
  if ($NoStart) { $InstallArguments.NoStart = $true }
  if ($SkipFoundation) { $InstallArguments.SkipFoundation = $true }
  & $ArtifactInstaller @InstallArguments
} finally {
  Remove-Item -Recurse -Force $TemporaryRoot -ErrorAction SilentlyContinue
}
