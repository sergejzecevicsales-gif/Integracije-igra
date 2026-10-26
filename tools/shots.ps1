# Snimci ekrana za vizuelnu provjeru.
# Pokretanje:  powershell -ExecutionPolicy Bypass -File tools\shots.ps1
$ErrorActionPreference = 'Continue'
$base = 'http://127.0.0.1:4000'
$chrome = 'C:\Program Files\Google\Chrome\Application\chrome.exe'
$outDir = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\shots'))
New-Item -ItemType Directory -Force -Path $outDir | Out-Null
Get-ChildItem $outDir -Filter *.png -ErrorAction SilentlyContinue | Remove-Item -Force
$profile = Join-Path $env:TEMP ('tzu-shot-' + (Get-Date -Format 'HHmmss'))

function Post($path, $body) {
  try {
    return Invoke-RestMethod -Uri ($base + $path) -Method Post -ContentType 'application/json' -Body ($body | ConvertTo-Json -Compress) -TimeoutSec 10
  } catch {
    Write-Host ("  ! POST {0} pao: {1}" -f $path, $_.Exception.Message)
    return $null
  }
}

function Shot($name, $url, $w, $h) {
  $file = Join-Path $outDir ($name + '.png')
  if (Test-Path $file) { Remove-Item $file -Force }
  & $chrome --headless=new --no-sandbox --disable-gpu --disable-breakpad --disable-crash-reporter `
    --hide-scrollbars --no-first-run --no-default-browser-check --force-device-scale-factor=1 `
    --user-data-dir="$profile" --window-size="$w,$h" --virtual-time-budget=1500 `
    --screenshot="$file" $url 2>$null | Out-Null
  Start-Sleep -Milliseconds 100
  if (Test-Path $file) { Write-Host ("  snimak: {0}.png" -f $name) }
  else { Write-Host ("  ! nema snimka: {0}" -f $name) }
}

Write-Host '=== priprema scene ==='
Post '/api/admin' @{ action = 'reset'; clear = $true } | Out-Null
Start-Sleep -Milliseconds 300
Shot '00-phone-join' ($base + '/?snap=1') 500 1000
Post '/api/admin' @{ action = 'bots'; count = 22 } | Out-Null
$p1 = Post '/api/join' @{ name = 'Alfa' }
$p2 = Post '/api/join' @{ name = 'Beta' }
Start-Sleep -Milliseconds 500
Shot '01-lobby' ($base + '/screen?snap=1') 1920 1080

Write-Host '=== runda 1 ==='
Post '/api/admin' @{ action = 'start' } | Out-Null
Start-Sleep -Milliseconds 2000
for ($i = 0; $i -lt 10; $i++) { Post '/api/act' @{ token = $p1.token; type = 'tap'; n = 3 } | Out-Null; Start-Sleep -Milliseconds 110 }
Start-Sleep -Milliseconds 400
Shot '02-round1' ($base + '/screen?snap=1') 1920 1080
Shot '03-phone-tap' ($base + '/?token=' + $p1.token + '&snap=1') 500 1000
Post '/api/admin' @{ action = 'next' } | Out-Null
Start-Sleep -Milliseconds 700
Shot '04-results1' ($base + '/screen?snap=1') 1920 1080

Write-Host '=== runda 2 ==='
Post '/api/admin' @{ action = 'next' } | Out-Null
Start-Sleep -Milliseconds 500
Post '/api/act' @{ token = $p1.token; type = 'price'; value = 'low' } | Out-Null
Post '/api/act' @{ token = $p2.token; type = 'price'; value = 'high' } | Out-Null
Start-Sleep -Milliseconds 400
Shot '05-round2' ($base + '/screen?snap=1') 1920 1080
Shot '06-phone-price' ($base + '/?token=' + $p1.token + '&snap=1') 500 1000
Post '/api/admin' @{ action = 'next' } | Out-Null
Start-Sleep -Milliseconds 700
Shot '07-results2' ($base + '/screen?snap=1') 1920 1080

Write-Host '=== runda 3 ==='
Post '/api/admin' @{ action = 'next' } | Out-Null
Start-Sleep -Milliseconds 500
Post '/api/act' @{ token = $p1.token; type = 'invest'; value = 'innov' } | Out-Null
Post '/api/act' @{ token = $p2.token; type = 'invest'; value = 'save' } | Out-Null
Start-Sleep -Milliseconds 400
Shot '08-round3' ($base + '/screen?snap=1') 1920 1080
Shot '09-phone-invest' ($base + '/?token=' + $p1.token + '&snap=1') 500 1000
Post '/api/admin' @{ action = 'next' } | Out-Null
Start-Sleep -Milliseconds 700
Shot '10-results3' ($base + '/screen?snap=1') 1920 1080

Write-Host '=== runda 4 (spajanja) ==='
Post '/api/admin' @{ action = 'next' } | Out-Null
Start-Sleep -Milliseconds 600
Post '/api/act' @{ token = $p1.token; type = 'offer'; value = '__open__' } | Out-Null
Start-Sleep -Milliseconds 16000
Shot '11-round4' ($base + '/screen?snap=1') 1920 1080
Shot '12-phone-merge' ($base + '/?token=' + $p2.token + '&snap=1') 500 1000
Post '/api/admin' @{ action = 'next' } | Out-Null
Start-Sleep -Milliseconds 700
Shot '13-results4' ($base + '/screen?snap=1') 1920 1080

Write-Host '=== runda 5 (komisija) ==='
Post '/api/admin' @{ action = 'next' } | Out-Null
Start-Sleep -Milliseconds 600
$p1st = Invoke-RestMethod -Uri ($base + '/api/state?token=' + $p1.token) -TimeoutSec 10
$vst = Invoke-RestMethod -Uri ($base + '/api/state') -TimeoutSec 10
$cand = $vst.voteCandidates | Where-Object { $_.groupId -ne $p1st.me.groupId } | Select-Object -First 1
if ($cand) { Post '/api/act' @{ token = $p1.token; type = 'vote'; value = $cand.groupId } | Out-Null }
Start-Sleep -Milliseconds 500
Shot '14-round5' ($base + '/screen?snap=1') 1920 1080
Shot '15-phone-vote' ($base + '/?token=' + $p2.token + '&snap=1') 500 1000
Start-Sleep -Milliseconds 6000
Post '/api/admin' @{ action = 'next' } | Out-Null
Start-Sleep -Milliseconds 700
Shot '16-results5' ($base + '/screen?snap=1') 1920 1080

Write-Host '=== finale ==='
Post '/api/admin' @{ action = 'next' } | Out-Null
Start-Sleep -Milliseconds 800
Shot '17-final' ($base + '/screen?snap=1') 1920 1080
Shot '18-phone-final' ($base + '/?token=' + $p1.token + '&snap=1') 500 1000

Write-Host ''
Write-Host 'Gotovo. Snimci su u shots'
Get-ChildItem $outDir -Filter *.png | Select-Object Name, Length | Format-Table -AutoSize
