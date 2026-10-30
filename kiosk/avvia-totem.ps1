# Avvia il totem: Ollama, il backend (FastAPI, porta 8000), il frontend (Angular, porta 4200) e
# Chrome in modalità kiosk, a schermo intero senza la X per uscire (che compare con F11 tenendo
# premuto o trascinando dal bordo in alto), senza barre, schede né menu.
#
# Backend e frontend partono in due finestre ridotte a icona ("Totem - backend" e "Totem - frontend"),
# dove si leggono i loro log. Ciò che è già acceso non viene riavviato: lo script si può rilanciare.
# La stampa non passa da Chrome: il backend manda i fogli alla stampante Bluetooth del totem.
#
# Uso:  powershell -ExecutionPolicy Bypass -File avvia-totem.ps1 [-Url http://...] [-ServersOnly]
#       -ServersOnly avvia solo i servizi, senza aprire Chrome (per la manutenzione).
# Per uscire dal kiosk: Alt+F4. Per spegnere tutto: ferma-totem.bat.

param(
  [string]$Url = 'http://localhost:4200/',
  [switch]$ServersOnly
)

$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$backend = Join-Path $root 'backend'
$frontend = Join-Path $root 'frontend'
# 127.0.0.1 e non localhost: su Windows localhost prova prima IPv6.
$ollamaUrl = 'http://127.0.0.1:11434'
$backendUrl = 'http://127.0.0.1:8000'
# ng serve invece ascolta su localhost, che Node può legare al solo IPv6.
$frontendUrl = 'http://localhost:4200/'

function Test-Url([string]$Address) {
  try {
    Invoke-WebRequest -Uri $Address -UseBasicParsing -TimeoutSec 3 | Out-Null
    return $true
  } catch {
    return $false
  }
}

function Wait-Url([string]$Address, [string]$Name, [int]$Seconds) {
  $deadline = (Get-Date).AddSeconds($Seconds)
  while (-not (Test-Url $Address)) {
    if ((Get-Date) -gt $deadline) { throw "$Name non risponde su $Address dopo $Seconds secondi." }
    Start-Sleep -Seconds 2
  }
}

function Require([string]$Command, [string]$Hint) {
  $found = Get-Command $Command -ErrorAction SilentlyContinue
  if (-not $found) { throw "$Command non trovato: $Hint" }
}

# --- Ollama: di solito lo avvia già Windows (icona nell'area di notifica).
Write-Host 'Ollama...'
if (-not (Test-Url $ollamaUrl)) {
  Require 'ollama' 'installalo da https://ollama.com (vedi docs/INSTALL.md).'
  Start-Process ollama -ArgumentList 'serve' -WindowStyle Hidden
  Wait-Url $ollamaUrl 'Ollama' 60
}

# --- Backend: carica l'indice, poi il modello linguistico e quello della dettatura in background.
Write-Host 'Backend (porta 8000)...'
if (-not (Test-Url "$backendUrl/api/health")) {
  Require 'uv' 'installalo da https://docs.astral.sh/uv/ (vedi docs/INSTALL.md).'
  Start-Process cmd.exe -ArgumentList '/k title Totem - backend && uv run uvicorn app.main:app --port 8000' `
    -WorkingDirectory $backend -WindowStyle Minimized
  Wait-Url "$backendUrl/api/health" 'Il backend' 120
}

# --- Frontend: ng serve compila l'app in una ventina di secondi.
Write-Host 'Frontend (porta 4200)...'
if (-not (Test-Url $frontendUrl)) {
  Require 'npm' 'installa Node.js da https://nodejs.org (vedi docs/INSTALL.md).'
  if (-not (Test-Path (Join-Path $frontend 'node_modules'))) {
    throw 'Mancano le dipendenze del frontend: esegui "npm ci" nella cartella frontend.'
  }
  Start-Process cmd.exe -ArgumentList '/k title Totem - frontend && npm start' `
    -WorkingDirectory $frontend -WindowStyle Minimized
  Wait-Url $frontendUrl 'Il frontend' 180
}

# --- Il modello linguistico è caricato dal backend in background: finché non è in memoria la
# prima risposta è lenta, quindi si aspetta (al massimo tre minuti) prima di aprire il totem.
$model = (Invoke-RestMethod "$backendUrl/api/health").llm_model
Write-Host "Modello linguistico ($model)..."
$deadline = (Get-Date).AddSeconds(180)
while ($true) {
  $loaded = @((Invoke-RestMethod "$ollamaUrl/api/ps").models | ForEach-Object { $_.name })
  if ($loaded -contains $model) { break }
  if ((Get-Date) -gt $deadline) {
    Write-Warning "$model non ancora in memoria: la prima risposta sara' lenta."
    break
  }
  Start-Sleep -Seconds 3
}

if ($ServersOnly) {
  Write-Host "Totem pronto su $Url (Chrome non aperto: -ServersOnly)."
  return
}

# --- Chrome in modalità kiosk.
$chrome = @(
  "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
  "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
  "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
) | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $chrome) { throw 'Chrome non trovato.' }

# Un profilo solo per il totem: se Chrome è già aperto con il profilo normale, il flag
# --kiosk verrebbe ignorato e si aprirebbe una scheda nella finestra esistente.
$profilo = Join-Path $env:LOCALAPPDATA 'TotemKiosk'

Start-Process $chrome -ArgumentList @(
  '--kiosk',
  "--user-data-dir=`"$profilo`"",
  '--no-first-run',
  '--no-default-browser-check',
  '--noerrdialogs',
  '--disable-session-crashed-bubble',
  '--disable-features=Translate',
  '--overscroll-history-navigation=0',
  '--autoplay-policy=no-user-gesture-required',
  $Url
)
