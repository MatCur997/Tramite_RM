"""FastAPI app: chat endpoints (streaming and plain), health check, form downloads and the
check of which links the kiosk can show in a frame, the PDFs of other sites and their printing,
speech recognition for the dictation key, speech synthesis for the key that reads an answer aloud
and the Italian translation of a conversation.

    uv run uvicorn app.main:app --port 8000
"""

import asyncio
import base64
import binascii
import json
import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from .config import Settings
from .embed import EmbedChecker, PdfError, fetch_pdf
from .index import SearchIndex, load_index
from .languages import resolve_language
from .ollama import Ollama, OllamaError
from .power import disable_power_throttling
from .printer import PrinterError, print_pages
from .rag import LLM, RagPipeline
from .sessions import SessionStore
from .stt import MAX_AUDIO_BYTES, SpeechError, Transcriber, WhisperTranscriber
from .translate import translate_to_italian
from .tts import TTS, SherpaTTS, TTSError, spoken_text

log = logging.getLogger("totem")


class PrintRequest(BaseModel):
    # The pages as PNG data URLs ("data:image/png;base64,..."), one per sheet.
    pages: list[str] = Field(min_length=1, max_length=50)


class TranslateRequest(BaseModel):
    language: str | None = None
    # The messages of the conversation, citizen's and assistant's, in order.
    texts: list[str] = Field(min_length=1, max_length=60)


class ChatRequest(BaseModel):
    message: str = Field(min_length=1, max_length=2000)
    language: str | None = None
    session_id: str | None = Field(default=None, max_length=100)


class SpeechRequest(BaseModel):
    # One sentence of an answer: the kiosk asks for the next while the previous one plays.
    text: str = Field(min_length=1, max_length=1000)
    language: str | None = None


def create_app(
    settings: Settings | None = None,
    llm: LLM | None = None,
    index: SearchIndex | None = None,
    transcriber: Transcriber | None = None,
    tts: TTS | None = None,
) -> FastAPI:
    """Build the app; tests pass their own LLM, index, transcriber and voices instead of Ollama,
    the files on disk, Whisper and sherpa-onnx."""
    settings = settings or Settings()
    _configure_logging()
    speech: Transcriber = transcriber or WhisperTranscriber(settings)
    voices: TTS = tts or SherpaTTS(settings)

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        # Behind the kiosk's browser, or minimized, Windows would slow this process down.
        disable_power_throttling()
        client = llm or Ollama(settings.ollama_url, settings.keep_alive)
        sessions = SessionStore(settings.session_ttl_minutes * 60, settings.history_turns)
        search_index = index if index is not None else load_index(settings.index_dir)
        app.state.rag = RagPipeline(settings, client, search_index, sessions)
        app.state.llm = client
        warmup = asyncio.create_task(app.state.rag.warmup())
        # The speech models take a few seconds to load: in the background, so the chat starts at once.
        stt_warmup = asyncio.create_task(_load_speech(speech)) if settings.stt_preload and transcriber is None else None
        preload_voices = settings.tts_enabled and settings.tts_preload and tts is None
        tts_warmup = asyncio.create_task(_load_voices(voices)) if preload_voices else None
        yield
        warmup.cancel()
        for task in (stt_warmup, tts_warmup):
            if task:
                task.cancel()
        await client.aclose()

    app = FastAPI(title="Totem backend", lifespan=lifespan)
    app.add_middleware(CORSMiddleware, allow_origins=settings.cors_origins, allow_methods=["*"], allow_headers=["*"])
    settings.docs_dir.mkdir(parents=True, exist_ok=True)
    app.mount("/files", StaticFiles(directory=settings.docs_dir), name="files")

    def events(body: ChatRequest, request: Request) -> AsyncIterator[dict[str, Any]]:
        files_url = str(request.base_url).rstrip("/") + "/files"
        return request.app.state.rag.answer(body.message, body.language, body.session_id, files_url)

    @app.get("/api/health")
    async def health(request: Request) -> dict[str, Any]:
        rag: RagPipeline = request.app.state.rag
        return {
            "status": "ok",
            "llm_model": settings.llm_model,
            "embed_model": settings.embed_model,
            "passages": len(rag.index) if rag.index else 0,
            "voices_loaded": voices.loaded,
        }

    @app.post("/api/chat/stream")
    async def chat_stream(body: ChatRequest, request: Request) -> StreamingResponse:
        """Newline-delimited JSON events: {"type": "token" | "sources" | "done" | "error", ...}."""

        async def lines() -> AsyncIterator[str]:
            try:
                async for event in events(body, request):
                    yield json.dumps(event, ensure_ascii=False) + "\n"
            except Exception as exc:
                # The response has already started, so the failure travels as the last event.
                log.exception("Chat request failed")
                yield json.dumps({"type": "error", "message": str(exc)}, ensure_ascii=False) + "\n"

        return StreamingResponse(lines(), media_type="application/x-ndjson", headers={"Cache-Control": "no-cache"})

    checker = EmbedChecker()

    @app.get("/api/embeddable")
    async def embeddable(url: str = Query(max_length=2000)) -> dict[str, bool]:
        """Whether the page at url may be shown inside the kiosk (in an iframe)."""
        return {"embeddable": await checker.embeddable(url)}

    @app.get("/api/pdf")
    async def pdf(url: str = Query(max_length=2000)) -> Response:
        """The PDF at url, downloaded here because other sites do not let the browser read it."""
        try:
            data = await fetch_pdf(url)
        except PdfError as exc:
            log.info("PDF %s not available: %s", url, exc)
            raise HTTPException(status_code=502, detail=str(exc)) from exc
        return Response(data, media_type="application/pdf")

    @app.post("/api/print")
    async def print_pdf(body: PrintRequest) -> dict[str, bool]:
        """Prints the pages of a PDF straight on the kiosk's Bluetooth printer, without a dialog."""
        pages = _decode_pages(body)
        try:
            await asyncio.to_thread(print_pages, pages, settings.printer_address)
        except (PrinterError, OSError) as exc:
            log.warning("Print failed: %s", exc)
            raise HTTPException(status_code=503, detail=str(exc)) from exc
        return {"printed": True}

    # The prints in progress: kept here until they end, even when the kiosk stops listening.
    printing: set[asyncio.Task[None]] = set()

    @app.post("/api/print/stream")
    async def print_stream(body: PrintRequest) -> StreamingResponse:
        """The same print as /api/print, followed sheet by sheet: newline-delimited JSON events
        "prepared", one "page" per sheet sent to the printer, then "done", or "error" with the
        sheet where it stopped."""
        pages = _decode_pages(body)
        total = len(pages)
        events: asyncio.Queue[dict[str, Any]] = asyncio.Queue()
        loop = asyncio.get_running_loop()
        printed = 0

        def page_sent(page: int, total: int) -> None:  # on the event loop
            nonlocal printed
            printed = page
            events.put_nowait({"type": "page", "page": page, "total": total})

        def on_page(page: int, total: int) -> None:  # in the printing thread
            # Queued on the loop in order, and before the end of the thread: "printed" is up to date
            # when run() goes on.
            loop.call_soon_threadsafe(page_sent, page, total)

        async def run() -> None:
            try:
                await asyncio.to_thread(print_pages, pages, settings.printer_address, on_page=on_page)
            except Exception as exc:  # whatever stops the print, the stream must end saying where
                log.warning("Print failed at sheet %d of %d: %s", printed + 1, total, exc)
                events.put_nowait({"type": "error", "message": str(exc), "page": min(printed + 1, total)})
            else:
                events.put_nowait({"type": "done", "total": total})

        async def lines() -> AsyncIterator[str]:
            yield json.dumps({"type": "prepared", "total": total}) + "\n"
            while True:
                event = await events.get()
                yield json.dumps(event, ensure_ascii=False) + "\n"
                if event["type"] in ("done", "error"):
                    return

        task = asyncio.create_task(run())
        printing.add(task)
        task.add_done_callback(printing.discard)
        return StreamingResponse(lines(), media_type="application/x-ndjson", headers={"Cache-Control": "no-cache"})

    @app.post("/api/transcribe")
    async def transcribe(request: Request, language: str | None = Query(default=None, max_length=10)) -> dict[str, str]:
        """The words spoken in the recording sent as the body (WebM/Opus from the kiosk's browser),
        recognised here with Whisper: the audio never leaves this computer."""
        audio = await request.body()
        if not audio:
            raise HTTPException(status_code=422, detail="Registrazione vuota")
        if len(audio) > MAX_AUDIO_BYTES:
            raise HTTPException(status_code=413, detail="Registrazione troppo lunga")
        try:
            text = await asyncio.to_thread(speech.transcribe, audio, language)
        except SpeechError as exc:
            log.info("Transcription failed: %s", exc)
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        return {"text": text}

    @app.get("/api/tts/languages")
    async def speech_languages() -> dict[str, list[str]]:
        """The languages the backend can read aloud: the kiosk shows the reading keys only for them."""
        if not settings.tts_enabled:
            return {"languages": []}
        await voices.load()  # at once if they are loaded already; a missing voice is left out
        return {"languages": voices.languages}

    @app.post("/api/tts")
    async def speak(body: SpeechRequest) -> Response:
        """A sentence of an answer read aloud, as a WAV, with the offline voice of the language:
        nothing goes to online services. 204 when nothing is left to read, e.g. only "[1][3]"."""
        if not settings.tts_enabled:
            raise HTTPException(status_code=422, detail="Sintesi vocale non disponibile")
        text = spoken_text(body.text)
        if not text:
            return Response(status_code=204)
        try:
            audio = await voices.synthesize(text, resolve_language(body.language))
        except TTSError as exc:
            log.warning("Speech synthesis failed: %s", exc)
            raise HTTPException(status_code=502, detail="Sintesi vocale non riuscita") from exc
        return Response(content=audio, media_type="audio/wav")

    @app.post("/api/conversation/translate")
    async def translate_conversation(body: TranslateRequest, request: Request) -> dict[str, list[str]]:
        """The messages of a conversation in Italian, in the same order, for the sheet the citizen
        brings to the counter. Messages of an Italian conversation come back as they are."""
        try:
            texts = await translate_to_italian(request.app.state.llm, settings, body.language, body.texts)
        except OllamaError as exc:
            log.warning("Translation failed: %s", exc)
            raise HTTPException(status_code=502, detail=str(exc)) from exc
        return {"texts": texts}

    @app.post("/api/chat")
    async def chat(body: ChatRequest, request: Request) -> dict[str, Any]:
        """The same answer in one piece: {"reply", "topic", "sources", "forms", "bring"}."""
        reply: list[str] = []
        result: dict[str, Any] = {"topic": None, "sources": [], "forms": [], "bring": []}
        try:
            async for event in events(body, request):
                if event["type"] == "token":
                    reply.append(event["text"])
                elif event["type"] == "sources":
                    result.update(topic=event["topic"], sources=event["sources"], forms=event["forms"])
                elif event["type"] == "summary":
                    result["bring"] = event["bring"]
        except OllamaError as exc:
            log.exception("Chat request failed")
            raise HTTPException(status_code=502, detail=str(exc)) from exc
        return {"reply": "".join(reply).strip(), **result}

    return app


def _decode_pages(body: PrintRequest) -> list[bytes]:
    """The PNG images of the pages; 422 before anything is printed if one is not valid base64."""
    try:
        return [base64.b64decode(page.split(",", 1)[-1], validate=True) for page in body.pages]
    except (binascii.Error, ValueError) as exc:  # ValueError: text that is not even ASCII
        raise HTTPException(status_code=422, detail="Pagine non valide") from exc


async def _load_speech(speech: Transcriber) -> None:
    try:
        await asyncio.to_thread(speech.load)
    except Exception as exc:  # the dictation key reports it; the chat keeps working
        log.warning("Speech model not loaded: %s", exc)


async def _load_voices(voices: TTS) -> None:
    try:
        await voices.load()
    except Exception as exc:  # the reading key reports it; the chat keeps working
        log.warning("Speech synthesis voices not loaded: %s", exc)


def _configure_logging() -> None:
    if not log.handlers:
        handler = logging.StreamHandler()
        handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(name)s: %(message)s", "%H:%M:%S"))
        log.addHandler(handler)
        log.setLevel(logging.INFO)


app = create_app()
