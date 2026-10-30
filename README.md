# Totem

Digital kiosk ("Tramite") that helps foreign residents of Rome with the procedures and forms of the Roma Capitale registry office (Anagrafe). The citizen picks a language (Italian, Ukrainian, Chinese, Bengali, Filipino or Arabic), asks a question by voice or on the touch keyboard, and gets a written answer with its sources and forms, which the kiosk can read aloud. Beside the chat, a summary collects for each subject of the conversation what to bring to the counter, the forms and the sources; the kiosk prints it, in Italian next to the citizen's language, together with the forms. A second section of the kiosk finds registry offices and CAF on a map.

Everything that concerns the citizen runs on the kiosk laptop: the language models are served by [Ollama](https://ollama.com), speech recognition and the voices that read the answers run on the laptop's CPU, and neither the recordings nor the answers leave it. Only the map of the offices and the pages of other sites need the internet.

## Repository layout

| Folder | Content | Stack |
| --- | --- | --- |
| [`frontend/`](frontend/) | Kiosk user interface, and the office finder web app (`frontend/public/webapp/`) | Angular 21 |
| [`backend/`](backend/) | Answers from the registry office documents (RAG), dictation, reading aloud, translation, printing | FastAPI, Ollama, faster-whisper, sherpa-onnx |
| [`kiosk/`](kiosk/) | Start and stop scripts of the kiosk | PowerShell |
| [`docs/`](docs/) | [Installation of a kiosk](docs/INSTALL.md), [architecture and API](docs/ARCHITECTURE.md) | |

## Start the kiosk

Double-click [`kiosk/avvia-totem.bat`](kiosk/avvia-totem.bat). It checks that Ollama is running, starts the backend (port 8000) and the frontend (port 4200) in two minimized windows, "Totem - backend" and "Totem - frontend", waits until the language model is in memory, then opens Chrome in kiosk mode: full screen, with no exit button on the touch screen. What is already running is not started twice, so the script can be run again.

- `Alt+F4` leaves the kiosk.
- [`kiosk/ferma-totem.bat`](kiosk/ferma-totem.bat) stops Chrome, frontend and backend; Ollama stays on.
- `kiosk\avvia-totem.bat -ServersOnly` starts the services without opening Chrome, for maintenance.

The kiosk prints without any dialog, and only on its own printer: a Phomemo A282M paired over Bluetooth, found by its Bluetooth address (`TOTEM_PRINTER_ADDRESS`).

To prepare a new kiosk computer, follow [docs/INSTALL.md](docs/INSTALL.md).

## Development

Requirements: [uv](https://docs.astral.sh/uv/), [Node.js](https://nodejs.org) 24 and Ollama with the models of [docs/INSTALL.md](docs/INSTALL.md).

```bash
cd backend
uv sync
uv run uvicorn app.main:app --port 8000 --reload
```

```bash
cd frontend
npm ci
npm start          # http://localhost:4200
```

The frontend calls the backend at `http://localhost:8000` ([`frontend/src/app/api.config.ts`](frontend/src/app/api.config.ts)); the backend accepts requests from `http://localhost:4200` (CORS, `cors_origins` in [`backend/app/config.py`](backend/app/config.py)).

Tests run without models, printer or microphone:

```bash
cd backend && uv run pytest
cd frontend && npm test -- --watch=false
cd frontend && node scripts/check-layout.mjs   # with npm start running: no screen needs a scrollbar
```

See [`backend/README.md`](backend/README.md) and [`frontend/README.md`](frontend/README.md) for the details of each part.

## Privacy

The kiosk is used by one citizen after another, so a session leaves nothing behind:

- After 70 seconds without a touch the kiosk asks "Sei ancora lì?" and counts down 20 seconds; then, or as soon as the citizen touches the red X of the chat and confirms, it forgets the language, the conversation, the accessibility choices and any open document, and goes back to the welcome screen with a new session id.
- The backend keeps the last exchanges of a session in memory only, for the follow-up questions, and forgets them after 10 minutes of inactivity. Nothing is written to disk.
- The questions written in the backend's log have e-mail addresses, codici fiscali, IBANs, document numbers, dates and phone numbers masked.
- The dictation audio is transcribed on the laptop and discarded; the answers are read aloud by voices on the laptop too.

## Open points

- `modulo-richiesta-certificati.pdf` is a scanned PDF with no text: the form is offered to the citizen, but its content cannot be searched. To be solved later (text recognition, or a Markdown transcription of the form).
- The Bengali and Filipino voices (Meta MMS) are licensed CC-BY-NC 4.0, non-commercial use only; the Chinese one has no stated license. See [backend/README.md](backend/README.md#voices).
- The subject of an answer is that of its first cited document. `cie-aire`, the identity card of Italians living abroad, is filed under `estero`: when the model cites it first for an identity card question, as happened in Chinese and Bengali, the answer goes under "Italiani all'estero" instead of "Carta d'identità".
- `ng build` warns that the initial bundle (575 kB) and the styles of the chat, keyboard and accessibility components exceed the Angular budgets (4 kB per component, 8 kB fail the build; the largest is at 5 kB).
- The kiosk follows the Windows theme (`auto`): with Windows in dark mode, as on the reference kiosk, the panels are dark blue instead of the light blue of the approved design. Choosing "Chiaro" in the accessibility panel, or making it the default in `accessibility.service.ts`, shows the light ones.
- npm 12 blocks the install scripts of `esbuild`, `lmdb`, `msgpackr-extract` and `@parcel/watcher` (warning at `npm ci`). Their prebuilt binaries are enough: build, tests and dev server work.
