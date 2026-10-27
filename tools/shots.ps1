# Capture the current game without changing its state.
param([string]$BaseUrl='http://127.0.0.1:4000',[string]$Token='')
$ErrorActionPreference='Stop'
$projectRoot=Split-Path $PSScriptRoot -Parent
$outputFolder=Join-Path $projectRoot 'tmp\screenshots'
New-Item -ItemType Directory -Force -Path $outputFolder | Out-Null
$browserPath='C:\Program Files\Google\Chrome\Application\chrome.exe'
if (-not (Test-Path -LiteralPath $browserPath)) { $browserPath='C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe' }
if (-not (Test-Path -LiteralPath $browserPath)) { throw 'Chrome ili Edge nije pronađen.' }
$profilePath=Join-Path $outputFolder 'browser-profile'
$screenFile=Join-Path $outputFolder 'projector.png'
& $browserPath --headless=new --disable-gpu --hide-scrollbars --no-first-run --no-default-browser-check "--user-data-dir=$profilePath" --window-size=1440,900 --virtual-time-budget=2000 "--screenshot=$screenFile" "$BaseUrl/screen?snap=1" 2>$null | Out-Null
$phoneFile=Join-Path $outputFolder 'phone.png'
$phoneUrl="$BaseUrl/?snap=1"
if ($Token) { $phoneUrl += '&token='+[uri]::EscapeDataString($Token) }
& $browserPath --headless=new --disable-gpu --hide-scrollbars --no-first-run --no-default-browser-check "--user-data-dir=$profilePath" --window-size=390,844 --virtual-time-budget=2000 "--screenshot=$phoneFile" $phoneUrl 2>$null | Out-Null
Write-Host "Snimci: $outputFolder"
