@echo off
rem Doppio clic per spegnere il totem: Chrome kiosk, frontend e backend (Ollama resta acceso).
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0ferma-totem.ps1"
if errorlevel 1 pause
