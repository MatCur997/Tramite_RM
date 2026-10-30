# Installing a kiosk

How to prepare a Windows 11 computer as the Totem kiosk, from scratch. The reference kiosk is a laptop with an Intel Core i9-13950HX, an NVIDIA RTX 3500 Ada with 12 GB of VRAM, a touch screen and a Phomemo A282M printer paired over Bluetooth. Plan on about 15 GB of disk for the models.

## 1. Software

| Software | Tested version | What for |
| --- | --- | --- |
| [Google Chrome](https://www.google.com/chrome/) | current | Shows the kiosk, in kiosk mode |
| [Ollama](https://ollama.com/download/windows) | 0.40.13 | Serves the language model and the embedding model |
| [uv](https://docs.astral.sh/uv/getting-started/installation/) | 0.12.13 | Installs Python 3.12 and the backend's packages |
| [Node.js](https://nodejs.org) LTS, with npm | 24.20.0 | Builds and serves the frontend |

With winget, from a terminal:

```powershell
winget install Google.Chrome Ollama.Ollama astral-sh.uv OpenJS.NodeJS.LTS
```

Ollama's installer adds it to the programs started with Windows: keep it that way, the kiosk expects it on `http://127.0.0.1:11434` (the start script starts it otherwise). An NVIDIA driver recent enough for CUDA is needed for the model to run on the GPU.

## 2. The code

Copy the repository to the kiosk, for example to `C:\Users\<user>\Desktop\Totem_def_rm`. The paths in the scripts are relative to it: it can live anywhere.

## 3. Models

```powershell
ollama pull bge-m3        # embeddings, 1.2 GB
ollama pull gemma4:12b    # answers and translations, 8 GB
```

`gemma4:12b` needs about 9 GB of VRAM with the context of the kiosk. On a computer with less VRAM use `qwen3.5:4b` (4 GB) and set `TOTEM_LLM_MODEL` in step 4.

## 4. Backend

```powershell
cd backend
uv sync                          # Python 3.12 and the packages, in backend\.venv
copy .env.example .env           # the kiosk's settings: gemma4:12b, embeddings on the CPU
uv run python -m app.stt         # downloads the Whisper model for dictation, 1.6 GB, once
uv run python -m app.voices      # downloads the six voices that read the answers, 490 MB, once
uv run python -m app.ingest      # builds the search index in data\index, about 2 minutes
uv run pytest                    # all green
```

`app.stt` and `app.voices` need the internet, `app.ingest` needs Ollama; after them the backend works offline. The Whisper model is saved in `%USERPROFILE%\.cache\huggingface`, the voices in `backend\models\tts`.

The settings are described in [backend/README.md](../backend/README.md#settings).

## 5. Frontend

```powershell
cd frontend
npm ci
npm test -- --watch=false        # all green
```

npm 12 warns that it did not run the install scripts of `esbuild`, `lmdb`, `msgpackr-extract` and `@parcel/watcher`: their prebuilt binaries are enough.

## 6. Printer

1. Turn on the Phomemo A282M and pair it in **Settings > Bluetooth & devices > Add device**. Windows creates some "Standard Serial over Bluetooth link" COM ports; the backend finds the right one by the printer's Bluetooth address, whatever its number.
2. `TOTEM_PRINTER_ADDRESS` (default `B7F5E10BBCFE`, the reference kiosk's printer) must be the address of the paired printer. For another printer, list the ports and their hardware ids:

   ```powershell
   cd backend
   uv run python -c "from serial.tools import list_ports; [print(p.device, p.hwid) for p in list_ports.comports()]"
   ```

   The address is the 12 hexadecimal digits before `_C00000000` in the line of the printer, for example `...&B7F5E10BBCFE_C00000000`. Write it in `backend\.env`: `TOTEM_PRINTER_ADDRESS=B7F5E10BBCFE`.
3. The printer uses A4 thermal paper. The page size and margins of [`backend/app/printer.py`](../backend/app/printer.py) were measured on this model.

## 7. Microphone and voices

- **Microphone.** The first time the dictation key is touched, Chrome asks for the microphone for `http://localhost:4200`. Allow it once: the kiosk's Chrome profile (`%LOCALAPPDATA%\TotemKiosk`) remembers it.
- **Voices.** The answers are read aloud by the backend's own offline voices, downloaded in step 4, in all six languages: nothing needs to be installed in Windows or Chrome. Only speakers or headphones are needed.

## 8. First start

1. Double-click `kiosk\avvia-totem.bat` (a shortcut on the desktop is handy). The first start of the frontend takes about half a minute.
2. On the kiosk, check:
   - an answer in Italian and one in another language, with their sources, and beside the chat "Il tuo riepilogo" with what to bring;
   - "Ascolta" under both answers, which reads them aloud;
   - the dictation key (the first time, allow the microphone);
   - a form opened from an answer, and its printing;
   - after questions on two subjects in another language, "Stampa il riepilogo per lo sportello": one summary per subject, Italian next to the citizen's language;
   - "Trova l'ufficio più vicino", which needs the internet;
   - the red X at the top of the chat, then "Chiudi e cancella", which brings back the welcome screen.
3. `Alt+F4` closes the kiosk, `kiosk\ferma-totem.bat` stops everything.

## Updating

After copying a new version of the code, stop the kiosk and, in `backend`, run `uv sync` and `uv run pytest`; in `frontend`, `npm ci` and `npm test -- --watch=false`. When `backend\data\docs` or `sources.json` changed, run `uv run python -m app.ingest` as well: the index holds the documents' subjects too, and an index built before them gives answers without a subject.

## Troubleshooting

| Problem | What to check |
| --- | --- |
| The start script stops with an error | The message names the missing piece; the window stays open. The logs of the backend and the frontend are in the minimized windows "Totem - backend" and "Totem - frontend". |
| "Errore di connessione" in the chat | The backend is not running, or Ollama is not: `http://127.0.0.1:8000/api/health` and `http://127.0.0.1:11434` must answer. |
| Slow answers | `ollama ps` must show the model 100% on the GPU. Other programs using the VRAM push it partly onto the CPU. |
| The first answer of the day is slow | Ollama keeps the model for 24 hours after the last question (`TOTEM_KEEP_ALIVE`): after a longer pause, or a restart of Windows, the first answer waits for it to load. |
| Slow dictation (more than 10 s) | The backend's log must not say "Windows power throttling not turned off". |
| "Ascolta" does not read, or is missing | `http://127.0.0.1:8000/api/health` must say `"voices_loaded": true`; otherwise run `uv run python -m app.voices` in `backend` and restart the backend. The backend's log names a missing voice ("TTS voice ... not available"). |
| "Stampa non riuscita", "Stampa interrotta al foglio..." | The printer is off, not paired, or `TOTEM_PRINTER_ADDRESS` is not its address (the backend's log has the error). Once it is fixed, "Riprova" prints again from the sheet where it stopped. |
| No subject dividers in the chat, and the summary beside it stays on "Come funziona" | The index was built before the documents had subjects: run `uv run python -m app.ingest` in `backend` and restart the backend. |
| The summary has no "what to bring" | `TOTEM_SUMMARY_ENABLED` must be on; the list comes only for answers that cite documents, and the backend's log says when it could not be made. |
| Chrome opens a normal window | The kiosk uses its own profile: close the Chrome windows opened with it and start again. |
| A port is already in use | `kiosk\ferma-totem.bat` stops what the kiosk started, also by hand. |
