# Backend

FastAPI service that answers citizens' questions about the services of the Roma Capitale registry office (Anagrafe), in Italian, Ukrainian, Chinese, Bengali, Filipino and Arabic. It runs entirely on the kiosk laptop: the language models are served locally by [Ollama](https://ollama.com).

The voice of the kiosk is here too, and offline: nothing goes to Google or other online services.

- The dictation key of the chat is recognised with [faster-whisper](https://github.com/SYSTRAN/faster-whisper): the browser only records the microphone and sends the audio to `/api/transcribe`.
- The answers are read aloud with [sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx) and one offline voice per language: the browser asks `/api/tts` for one sentence at a time and plays it. Windows and Chrome have no voice for Ukrainian, Bengali, Filipino and Arabic.

The kiosk prints on its Phomemo A282M over Bluetooth, without any print dialog (`/api/print`). When the conversation is not in Italian, the kiosk also prints a sheet for the counter: "Porta questo foglio allo sportello" in the citizen's language and in Italian, then the conversation in a table, the citizen's language on the left and the Italian translation (`/api/conversation/translate`) on the right.

The kiosk opens every link inside its own page: `/api/embeddable` tells it whether a site allows that, and `/api/pdf` downloads for it the PDFs of other sites, which the browser may not read directly.

## How an answer is built

1. **Search query.** The LLM rewrites the question as a self-contained Italian search query, using the conversation so far ("and for my son?"). A first question in Italian is used as it is.
2. **Retrieval.** The query, and the citizen's own words, are compared by meaning with the passages of the Italian documents, using `bge-m3` embeddings, which also match across languages. At most two passages per document are kept. If even the best passage is not similar enough (`TOTEM_MIN_SCORE`), the question counts as not covered by the documents.

   A keyword search (BM25) was tried alongside and dropped: on 31 labelled questions the embeddings alone found the right document among the first five for 30 of them, and every mix with BM25 did worse.
3. **Answer.** The LLM answers in the citizen's language, using only the retrieved passages, and cites them as `[1]`, `[2]`. The answer streams to the kiosk as it is written.
4. **Sources and forms.** The cited documents are returned with the answer, together with the forms (moduli) linked to them. The form files are served at `/files/...`. Each document has a topic (see [Documents](#documents)): the answer takes that of its first cited source, so the kiosk can group the conversation by subject.
5. **Things to bring.** When the answer cites documents, a short second call (`temperature` 0, a JSON schema, as for the translations) picks out of the answer what to bring or prepare for the counter: at most six short items, in the citizen's language, with the Italian names in parentheses. If that call fails, the answer is complete all the same, just without the list.

Each kiosk session keeps the last few exchanges in memory for 10 minutes. The frontend starts a new session when the language changes, when the chat is opened again and when a citizen's session ends (the end key of the chat, or 90 seconds without a touch).

## Setup

Requirements: [uv](https://docs.astral.sh/uv/) and [Ollama](https://ollama.com). The whole preparation of a kiosk computer is in [docs/INSTALL.md](../docs/INSTALL.md).

```bash
cd backend
uv sync
ollama pull bge-m3
ollama pull gemma4:12b    # the kiosk (12 GB VRAM), chosen after the comparison of October 2026
ollama pull qwen3.5:4b    # development laptop (4 GB VRAM)
uv run python -m app.stt     # downloads the speech recognition model once (needs internet)
uv run python -m app.voices  # downloads the six voices once, 490 MB in models/tts (needs internet)
copy .env.example .env       # then adjust the model names
uv run python -m app.ingest
```

After the two downloads, dictation and reading aloud work offline.

## Documents

The documents live in `data/`:

- `data/docs/`: the source files (HTML pages, PDF, Markdown or plain text);
- `data/sources.json`: one entry per document, with its title, original URL, kind (`pagina`, `modulo`, `norma` or `guida`) and topic. `forms` lists the forms to offer when the document is cited.

```json
[
  {"id": "cie", "title": "Carta d'identità elettronica", "kind": "pagina", "topic": "cie", "file": "cie.html",
   "url": "https://www.comune.roma.it/...", "forms": ["delega-cie"]},
  {"id": "delega-cie", "title": "Modulo di delega per il ritiro della CIE", "kind": "modulo", "topic": "cie", "file": "delega-cie.pdf"}
]
```

The topics, one per document: `cie` (identity card), `residenza` (residence and its changes), `stranieri` (registration of foreign citizens), `certificati`, `autocertificazione` (self-certification), `estero` (AIRE, the identity card of Italians abroad, foreign records) and `stato-civile` (civil marriage, citizenship). `tests/test_topics.py` checks that every document has one; `topic` is optional in the data models, so an index built before it still loads.

`app.fetch` downloads the files of the entries that have a `url`: web pages are saved as Markdown with only their main text, so they can be checked and corrected by hand, PDFs as they are. After any change to the documents, rebuild the index (`data/index/`, not committed):

```bash
uv run python -m app.fetch      # add --force to download everything again
uv run python -m app.ingest     # about two minutes, with the embeddings on the CPU
```

The current corpus (October 2026) has 63 documents, 361 passages: the Roma Capitale service pages on identity cards, change of residence, registration of EU and non-EU citizens, certificates, AIRE, self-certification, foreign civil status records and citizenship; the ANPR and Ministry of the Interior pages on the same topics; 13 official PDF forms and the user guide of the online change of residence. One form, `modulo-richiesta-certificati.pdf`, is a scanned PDF with no text: it is offered with the documents that link it, but its content is not searched.

## Voices

`app.voices` downloads the voices of `TOTEM_TTS_VOICES` into `models/tts/` (not committed): Piper voices from the sherpa-onnx releases, Meta MMS ones from a Hugging Face conversion to ONNX. Piper has no Tagalog voice, and its Bengali one is not packaged for sherpa-onnx.

| Language | Voice | License |
| --- | --- | --- |
| Italian | `vits-piper-it_IT-paola-medium` | that of its dataset (see `MODEL_CARD`) |
| Ukrainian | `vits-piper-uk_UA-lada-x_low` | Apache 2.0 |
| Chinese | `vits-piper-zh_CN-huayan-medium` | not stated |
| Bengali | `mms-ben` | CC-BY-NC 4.0, non-commercial use |
| Filipino | `mms-tgl` | CC-BY-NC 4.0, non-commercial use |
| Arabic | `vits-piper-ar_JO-kareem-medium` | that of its dataset (see `MODEL_CARD`) |

`uk_UA-ukrainian_tts`, the better Ukrainian voice, skips most phonemes in sherpa-onnx: hence `lada`. The voices are loaded at startup, in the background; a missing one only silences its language, and `GET /api/tts/languages` leaves it out, so the kiosk hides the reading keys. The last 200 sentences read stay in memory, so reading an answer again is immediate; like the conversations, a sentence is forgotten after 10 minutes without being read. On the kiosk a sentence takes about 0.1 s to synthesise with the Piper voices and 0.7 s with the MMS ones. A check of 30 October 2026, with Whisper transcribing what each voice said, heard back the same sentences, the Bengali one with a few sounds off.

## Run

```bash
uv run uvicorn app.main:app --port 8000
```

On the kiosk, [`kiosk/avvia-totem.bat`](../kiosk/avvia-totem.bat) starts it, in a minimized window. The models are loaded into memory in the background at startup, which can take a minute: the start script waits for the language model before opening the kiosk. Ollama keeps the models in memory for 24 hours after the last question (`TOTEM_KEEP_ALIVE`), so the first answer of the morning does not wait for them to load again. `GET /api/health` reports the models in use, the number of indexed passages and whether all the voices are loaded.

At startup the backend opts out of the Windows "efficiency mode" ([`app/power.py`](app/power.py)): Windows 11 runs the processes of minimized or hidden windows, such as this one behind the kiosk's browser, on the slower cores of hybrid processors, and dictation took 34 s instead of 5 s.

## API

| Method | Path | Body | Response |
| --- | --- | --- | --- |
| `POST` | `/api/chat/stream` | `{"message", "language", "session_id"}` | One JSON event per line (see below) |
| `POST` | `/api/chat` | same | `{"reply", "topic", "sources", "forms", "bring"}` in one piece |
| `GET` | `/api/health` | | Models, index size, voices |
| `GET` | `/files/{file}` | | A file of `data/docs/`, such as a form |
| `POST` | `/api/transcribe?language=uk` | The recording (WebM/Opus, WAV...) | `{"text"}`; 422 if empty or not understood, 413 if longer than 10 MB |
| `GET` | `/api/tts/languages` | | `{"languages": ["it", "uk", ...]}`: the languages with a voice; `[]` with `TOTEM_TTS_ENABLED=false` |
| `POST` | `/api/tts` | `{"text", "language"}`, one sentence, at most 1000 characters | The sentence read aloud, `audio/wav`; 204 if there is nothing to read (only citations), 422 if reading aloud is turned off, 502 if the voice fails |
| `POST` | `/api/conversation/translate` | `{"language", "texts": [...]}` | `{"texts": [...]}` in Italian, same order; 502 if the LLM fails |
| `POST` | `/api/print` | `{"pages": ["data:image/png;base64,..."]}` | `{"printed": true}`; 503 if the printer is unreachable |
| `POST` | `/api/print/stream` | same | One JSON event per sheet as it is printed (see below); 422 if a page is not valid |
| `GET` | `/api/embeddable?url=...` | | `{"embeddable": true}` if the site lets the kiosk show it in a frame |
| `GET` | `/api/pdf?url=...` | | The PDF at `url`, downloaded by the backend; 502 if it is not available |

`language` is one of `it`, `uk`, `zh`, `bn`, `tl`, `ar` (anything else falls back to Italian). Without `session_id` there is no conversation memory. [docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md) describes every endpoint in detail.

The chat stream sends these events, in this order:

```json
{"type": "token", "text": "Per la carta d'identità "}
{"type": "sources", "topic": "cie",
 "sources": [{"number": 1, "title": "...", "kind": "pagina", "url": "https://...", "copy": "http://localhost:8000/files/cie.md", "topic": "cie"}],
 "forms": [{"id": "delega-cie", "title": "...", "url": "http://localhost:8000/files/delega-cie.pdf", "topic": "cie"}]}
{"type": "summary", "bring": ["Fototessera recente", "Carta d'identità scaduta o denuncia di smarrimento"]}
{"type": "done"}
```

`copy` is the saved text of the page, which the kiosk shows when the site cannot be opened in a frame. `topic` is that of the first cited source, `null` when the answer cites none (greetings, other subjects). `summary` comes only when the answer cites documents and mentions something to bring or prepare, and `TOTEM_SUMMARY_ENABLED` is on. If something fails while answering, the last event is `{"type": "error", "message": "..."}`.

The print stream sends `prepared` as soon as the pages are accepted, then one `page` event once each sheet has gone to the printer:

```json
{"type": "prepared", "total": 3}
{"type": "page", "page": 1, "total": 3}
{"type": "page", "page": 2, "total": 3}
{"type": "page", "page": 3, "total": 3}
{"type": "done", "total": 3}
```

If the printer is off or out of reach, the last event is `{"type": "error", "message": "...", "page": 2}`, with the sheet where the print stopped. One print at a time; a print goes on even if the kiosk stops listening to its events.

## Privacy

- The conversations live only in memory ([`app/sessions.py`](app/sessions.py)): the last `TOTEM_HISTORY_TURNS` exchanges per session, forgotten after `TOTEM_SESSION_TTL_MINUTES` without questions.
- The search queries written in the log have e-mail addresses, codici fiscali, IBANs, document numbers, dates, phone numbers and other long numbers masked ([`app/privacy.py`](app/privacy.py)). Names and addresses cannot be recognised this way: the log is pseudonymised, not anonymous.
- The recordings of the dictation key are transcribed in memory and discarded; the sentences read aloud are synthesised in memory and not logged.

## Settings

Environment variables, or lines of `backend/.env` (the kiosk's: [`.env.example`](.env.example)):

| Variable | Default | Meaning |
| --- | --- | --- |
| `TOTEM_LLM_MODEL` | `qwen3.5:4b` | Ollama model that writes the answers (`gemma4:12b` on the kiosk) |
| `TOTEM_EMBED_MODEL` | `bge-m3` | Ollama embedding model (rebuild the index if it changes) |
| `TOTEM_EMBED_ON_CPU` | `false` | Run the embedding model on the CPU, leaving the VRAM to the LLM (`true` on the kiosk) |
| `TOTEM_LLM_NUM_CTX` | `8192` | Context size of the LLM |
| `TOTEM_LLM_TEMPERATURE` | `0.2` | Temperature of the answers (the query rewriting and the translations use 0) |
| `TOTEM_LLM_THINK` | `false` | Let thinking models think before answering: slower |
| `TOTEM_KEEP_ALIVE` | `24h` | How long Ollama keeps the models in memory after the last request |
| `TOTEM_SUMMARY_ENABLED` | `true` | List what to bring to the counter after each answer that cites documents (the `summary` event): about a second more per answer |
| `TOTEM_TOP_K` | `5` | Passages given to the LLM |
| `TOTEM_MIN_SCORE` | `0.45` | Minimum similarity of the best passage for a question to count as covered |
| `TOTEM_HISTORY_TURNS` | `4` | Exchanges remembered per session |
| `TOTEM_SESSION_TTL_MINUTES` | `10` | Inactivity after which a session is forgotten |
| `TOTEM_DATA_DIR` | `data` | Folder with `sources.json`, `docs/` and `index/` |
| `TOTEM_STT_MODEL` | `large-v3-turbo` | Whisper model for dictation (`small` is faster, less accurate) |
| `TOTEM_STT_DEVICE` | `cpu` | `cpu`, or `cuda` if the VRAM allows it next to the LLM |
| `TOTEM_STT_COMPUTE_TYPE` | `int8` | `int8` on the CPU, `float16` on the GPU |
| `TOTEM_STT_PRELOAD` | `true` | Load the speech model at startup rather than at the first dictation |
| `TOTEM_TTS_ENABLED` | `true` | Read the answers aloud; when off, `/api/tts/languages` is empty and the kiosk hides the reading keys |
| `TOTEM_TTS_DIR` | `models/tts` | Folder of the voices |
| `TOTEM_TTS_VOICES` | see [Voices](#voices) | Voice of each language, a JSON object such as `{"it": "vits-piper-it_IT-paola-medium", ...}` |
| `TOTEM_TTS_SPEED` | `0.9` | Speed of the voices: a little slower than natural, easier for non-native listeners |
| `TOTEM_TTS_THREADS` | `4` | CPU threads of each voice |
| `TOTEM_TTS_PRELOAD` | `true` | Load the voices at startup rather than at the first reading |
| `TOTEM_PRINTER_ADDRESS` | `B7F5E10BBCFE` | Bluetooth address of the printer |
| `TOTEM_OLLAMA_URL` | `http://127.0.0.1:11434` | Ollama server |
| `TOTEM_CORS_ORIGINS` | `["http://localhost:4200", "http://127.0.0.1:4200"]` | Origins allowed to call the API (a JSON list) |

## Choosing the model

`app.compare` asks the same questions to several models and writes their answers, sources and timings side by side in `reports/`:

```bash
uv run python -m app.compare gemma4:12b qwen3.5:9b --questions data/demo_questions.json
```

The questions file is a list of `{"language": "bn", "question": "...", "meaning": "...", "follow_up": [...]}`. Follow-up questions are asked in the same session; each is a string or a `{"question", "meaning"}` object. `meaning` is an optional Italian translation, shown in the report. [`data/demo_questions.json`](data/demo_questions.json) holds the questions prepared for the demo.

The comparison of 21 October 2026, on the kiosk: `gemma4:12b` 2.7 s to the first token and 7.3 s in all on average, `qwen3.5:9b` 1.5 s and 6.8 s; `gemma4:12b` was chosen. In a check on 30 October, with the embeddings on the CPU, it answered two questions (Italian and Ukrainian) in 1.5 and 1.9 s to the first token, 3.5 and 6.2 s in all.

## Tests

```bash
uv run pytest
```

The tests replace Ollama with a deterministic fake, Whisper with a canned transcriber, the voices with a fixed WAV and the printer's serial port with a recorder, and use the sample documents in `tests/fixtures/`, so they run without models, printer or microphone.
