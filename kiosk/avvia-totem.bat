@echo off
rem Doppio clic per avviare il totem: Ollama, backend, frontend e Chrome a schermo intero (modalita' kiosk).
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0avvia-totem.ps1" %*
if errorlevel 1 pause
