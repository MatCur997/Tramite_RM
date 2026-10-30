# Spegne il totem: chiude Chrome in modalità kiosk, il frontend (porta 4200) e il backend (porta 8000).
# Ollama resta acceso: è condiviso con il resto di Windows e tiene i modelli pronti per la riaccensione.
#
# Uso:  powershell -ExecutionPolicy Bypass -File ferma-totem.ps1

# taskkill /T chiude anche i processi figli (cmd -> uv -> python, cmd -> npm -> node).
function Stop-Tree([int]$ProcessId) {
  & taskkill.exe /PID $ProcessId /T /F 2>&1 | Out-Null
}

# Chrome del totem: solo quello con il profilo del kiosk, non il Chrome di tutti i giorni.
Get-CimInstance Win32_Process -Filter "Name = 'chrome.exe'" |
  Where-Object { $_.CommandLine -like '*TotemKiosk*' } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }

# Le finestre "Totem - backend" e "Totem - frontend" aperte da avvia-totem, con ciò che contengono.
Get-CimInstance Win32_Process -Filter "Name = 'cmd.exe'" |
  Where-Object { $_.CommandLine -like '*title Totem - *' } |
  ForEach-Object { Stop-Tree $_.ProcessId }

# Backend o frontend avviati a mano: solo processi Python o Node sulle porte del totem. Senza filtro
# -State Listen, che su alcune installazioni di Windows non riconosce lo stato delle connessioni.
foreach ($port in 8000, 4200) {
  Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue |
    Select-Object -ExpandProperty OwningProcess -Unique |
    Where-Object { $_ -and (Get-Process -Id $_ -ErrorAction SilentlyContinue).Name -in 'python', 'node' } |
    ForEach-Object { Stop-Tree $_ }
}

Write-Host 'Totem spento.'
