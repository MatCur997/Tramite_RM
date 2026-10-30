"""Speech recognition for the kiosk's dictation key, on this computer with faster-whisper.

The browser only records the microphone and sends the audio here: nothing is sent to Google or
to other online services. The model is downloaded once (from Hugging Face) the first time it is
used, then it works offline. To download it in advance:

    uv run python -m app.stt
"""

import io
import logging
import threading
import time
from typing import Any, Protocol

from .config import Settings
from .languages import LANGUAGES

log = logging.getLogger("totem.stt")

# Kiosk language -> Whisper language: every language of the kiosk is a Whisper language with the
# same code. Telling Whisper the language makes short questions more accurate than detecting it.
WHISPER_LANGUAGES = {code: code for code in LANGUAGES}

# Audio larger than this is refused: about 10 minutes of Opus, far more than a question.
MAX_AUDIO_BYTES = 10 * 1024 * 1024


# Whisper listens at 16 kHz, mono.
SAMPLE_RATE = 16000


class SpeechError(RuntimeError):
    pass


def decode_audio(audio: bytes, rate: int = SAMPLE_RATE) -> Any:
    """The recording (WebM/Opus from the browser, WAV, OGG...) as 16 kHz mono samples between -1
    and 1, the input Whisper expects.

    Decoded here rather than by faster-whisper, whose own decoder passes PyAV an option
    (metadata_errors) that recent PyAV versions no longer accept.
    """
    import av
    import numpy as np

    chunks = []
    try:
        with av.open(io.BytesIO(audio), mode="r") as container:
            if not container.streams.audio:
                raise SpeechError("La registrazione non contiene audio")
            stream = container.streams.audio[0]
            resampler = av.AudioResampler(format="s16", layout="mono", rate=rate)
            for frame in container.decode(stream):
                chunks += [out.to_ndarray() for out in resampler.resample(frame)]
            chunks += [out.to_ndarray() for out in resampler.resample(None)]  # what is left in the resampler
    except SpeechError:
        raise
    except Exception as exc:  # PyAV raises its own error types for unreadable files
        raise SpeechError(f"Audio non leggibile: {exc}") from exc
    if not chunks:
        raise SpeechError("Registrazione vuota")
    samples = np.concatenate([chunk.reshape(-1) for chunk in chunks])
    return samples.astype(np.float32) / 32768.0


class Transcriber(Protocol):
    def transcribe(self, audio: bytes, language: str | None) -> str: ...
    def load(self) -> None: ...


class WhisperTranscriber:
    """faster-whisper, loaded on first use (or by load()), one transcription at a time."""

    def __init__(self, settings: Settings):
        self._settings = settings
        self._model: Any = None
        self._lock = threading.Lock()

    def load(self) -> None:
        with self._lock:
            self._load()

    def _load(self) -> Any:
        if self._model is None:
            try:
                from faster_whisper import WhisperModel
            except ImportError as exc:  # pragma: no cover - dependency missing
                raise SpeechError("faster-whisper non è installato: esegui uv sync") from exc
            started = time.perf_counter()
            s = self._settings
            self._model = WhisperModel(s.stt_model, device=s.stt_device, compute_type=s.stt_compute_type)
            log.info("Speech model %s loaded in %.1fs (%s)", s.stt_model, time.perf_counter() - started, s.stt_device)
        return self._model

    def transcribe(self, audio: bytes, language: str | None) -> str:
        """The words spoken in the recording (any format FFmpeg reads: WebM/Opus, WAV, OGG...)."""
        samples = decode_audio(audio)
        with self._lock:
            model = self._load()
            started = time.perf_counter()
            try:
                segments, info = model.transcribe(
                    samples,
                    language=WHISPER_LANGUAGES.get(language or ""),
                    task="transcribe",
                    beam_size=5,
                    # Skips the silence before and after the question, and what is not speech.
                    vad_filter=True,
                    condition_on_previous_text=False,
                )
                text = " ".join(segment.text.strip() for segment in segments).strip()
            except Exception as exc:  # PyAV and CTranslate2 raise their own error types
                raise SpeechError(f"Audio non riconosciuto: {exc}") from exc
            log.info("Transcribed %.1fs of audio in %.1fs (%s)", info.duration, time.perf_counter() - started, info.language)
            return text


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    WhisperTranscriber(Settings()).load()
    print("Modello pronto: la dettatura funziona anche senza internet.")
