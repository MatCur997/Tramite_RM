"""Speech synthesis with sherpa-onnx on the CPU: one offline voice per language.

The kiosk reads an answer one sentence at a time, so each call gets a short text and returns a WAV.
The voices are downloaded once by `python -m app.voices`.
"""

import asyncio
import io
import logging
import re
import time
import wave
from collections import OrderedDict
from collections.abc import Callable
from pathlib import Path
from typing import Any, Protocol

import numpy as np

from .config import Settings
from .rag import CITATION

log = logging.getLogger("totem.tts")

_LIST_DASH = re.compile(r"^\s*-\s+")
_SPACES = re.compile(r"\s+")
_SPACE_BEFORE_PUNCTUATION = re.compile(r"\s+([.,;:!?。，；：！？،؛؟।])")
_ENDS_SENTENCE = re.compile(r"[.,;:!?。，；：！？،؛؟।]$")

# Sentences kept once synthesised: reading an answer again, or the greeting of the chat, is immediate.
CACHE_SIZE = 200


class TTSError(RuntimeError):
    pass


class TTS(Protocol):
    async def load(self) -> None: ...
    async def synthesize(self, text: str, language: str) -> bytes: ...

    @property
    def loaded(self) -> bool: ...

    @property
    def languages(self) -> list[str]: ...


def spoken_text(text: str) -> str:
    """What is read aloud: no citations such as [1][3], no list dashes, no Markdown stars.

    Each line ends with a full stop if it has no punctuation, so that the items of a list are read
    with a pause between them.
    """
    lines = []
    for line in CITATION.sub("", text).replace("*", "").splitlines():
        line = _SPACE_BEFORE_PUNCTUATION.sub(r"\1", _SPACES.sub(" ", _LIST_DASH.sub("", line)).strip())
        if line:
            lines.append(line if _ENDS_SENTENCE.search(line) else f"{line}.")
    return " ".join(lines)


def voice_files(directory: Path) -> dict[str, str]:
    """The files of a downloaded voice, as sherpa-onnx wants them."""
    model = next(directory.glob("*.onnx"), None)
    if model is None:
        raise FileNotFoundError(f"No voice in {directory}: run `uv run python -m app.voices`")
    espeak = directory / "espeak-ng-data"  # only Piper voices have it
    return {"model": str(model), "tokens": str(directory / "tokens.txt"), "data_dir": str(espeak) if espeak.exists() else ""}


class SherpaTTS:
    def __init__(self, settings: Settings, clock: Callable[[], float] = time.monotonic):
        self._settings = settings
        self._clock = clock
        self._voices: dict[str, Any] = {}
        self._load_lock = asyncio.Lock()
        # One synthesis at a time: they share the CPU with speech recognition.
        self._synth_lock = asyncio.Lock()
        # (language, text) -> (last use, WAV), least recently used first. Like the conversations, a
        # sentence is forgotten after TOTEM_SESSION_TTL_MINUTES without being read.
        self._cache: OrderedDict[tuple[str, str], tuple[float, bytes]] = OrderedDict()

    @property
    def loaded(self) -> bool:
        return all(language in self._voices for language in self._settings.tts_voices)

    @property
    def languages(self) -> list[str]:
        """The languages that have a voice in memory, in the order of the settings."""
        return [language for language in self._settings.tts_voices if language in self._voices]

    async def load(self) -> None:
        """Load the voices once; one that is missing or broken is skipped, the others still work."""
        async with self._load_lock:
            for language, name in self._settings.tts_voices.items():
                if language in self._voices:
                    continue
                started = time.perf_counter()
                try:
                    self._voices[language] = await asyncio.to_thread(self._create_voice, name)
                except Exception as exc:
                    log.warning("TTS voice %s not available: %s", name, exc)
                    continue
                log.info("TTS voice %s loaded in %.1fs", name, time.perf_counter() - started)

    async def synthesize(self, text: str, language: str) -> bytes:
        """A WAV of the text read in the language; the caller passes text already cleaned by spoken_text()."""
        if (cached := self._cached(language, text)) is not None:
            return cached
        await self.load()
        voice = self._voices.get(language)
        if voice is None:
            raise TTSError(f"No voice for language {language!r}")
        started = time.perf_counter()
        try:
            async with self._synth_lock:
                audio = await asyncio.to_thread(voice.generate, text, sid=0, speed=self._settings.tts_speed)
        except Exception as exc:
            raise TTSError(f"Could not synthesise the text: {exc!r}") from exc
        if not len(audio.samples):
            raise TTSError("The voice produced no audio")
        seconds = len(audio.samples) / audio.sample_rate
        # The text itself is not logged: answers can repeat what the citizen said about themselves.
        log.info("Synthesised %.1fs of audio in %.2fs (%s, %d characters)", seconds, time.perf_counter() - started, language, len(text))
        wav = _wav(audio.samples, audio.sample_rate)
        self._remember(language, text, wav)
        return wav

    def _cached(self, language: str, text: str) -> bytes | None:
        key, now = (language, text), self._clock()
        entry = self._cache.get(key)
        if entry is None or now - entry[0] > self._settings.session_ttl_minutes * 60:
            self._cache.pop(key, None)
            return None
        self._cache[key] = (now, entry[1])
        self._cache.move_to_end(key)
        return entry[1]

    def _remember(self, language: str, text: str, wav: bytes) -> None:
        now, ttl = self._clock(), self._settings.session_ttl_minutes * 60
        self._cache[(language, text)] = (now, wav)
        self._cache.move_to_end((language, text))
        # The least recently used first: beyond the size, or not read for too long.
        while self._cache and (len(self._cache) > CACHE_SIZE or now - next(iter(self._cache.values()))[0] > ttl):
            self._cache.popitem(last=False)

    def _create_voice(self, name: str) -> Any:
        import sherpa_onnx  # imported here: the tests do not need it

        files = voice_files(self._settings.tts_dir / name)
        config = sherpa_onnx.OfflineTtsConfig(
            model=sherpa_onnx.OfflineTtsModelConfig(
                vits=sherpa_onnx.OfflineTtsVitsModelConfig(**files),
                num_threads=self._settings.tts_threads,
                provider="cpu",
            ),
        )
        return sherpa_onnx.OfflineTts(config)


def _wav(samples: Any, sample_rate: int) -> bytes:
    pcm = (np.clip(np.asarray(samples, dtype=np.float32), -1.0, 1.0) * 32767).astype("<i2")
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as file:
        file.setnchannels(1)
        file.setsampwidth(2)
        file.setframerate(sample_rate)
        file.writeframes(pcm.tobytes())
    return buffer.getvalue()
