$ErrorActionPreference = "Stop"
$root = Join-Path $env:USERPROFILE "OneDrive\Desktop"
$src = Get-ChildItem -Path $root -Recurse -Filter "teknik-sinyal.js" -ErrorAction SilentlyContinue |
  Where-Object { $_.DirectoryName -notmatch "\\mobileapp(\\|$)" } |
  Select-Object -First 1
if (-not $src) { throw "teknik-sinyal.js Desktop altinda bulunamadi" }
$mobile = Get-ChildItem -Path $root -Recurse -Directory -Filter "mobileapp" -ErrorAction SilentlyContinue |
  Where-Object { Test-Path (Join-Path $_.FullName "package.json") } |
  Select-Object -First 1
if (-not $mobile) { throw "mobileapp (package.json) bulunamadi" }
$dstDir = Join-Path $mobile.FullName "src\lib"
New-Item -ItemType Directory -Force -Path $dstDir | Out-Null
$dst = Join-Path $dstDir "teknikSinyalEngine.js"
Copy-Item -LiteralPath $src.FullName -Destination $dst -Force
Write-Output "OK $($src.FullName) -> $dst"
