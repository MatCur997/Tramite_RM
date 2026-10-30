import asyncio
import json
import re
import zlib
from pathlib import Path

import numpy as np
import pytest

from app.config import Settings
from app.index import SearchIndex
from app.ingest import build_index
from app.ollama import OllamaError
from app.tts import TTSError

FIXTURES = Path(__file__).parent / "fixtures" / "data"
WORD = re.compile(r"\w{3,}")


class FakeLLM:
    """Deterministic stand-in for Ollama: bag-of-words embeddings and a canned answer."""

    def __init__(self, answer: str = "Porta una fototessera [1]."):
        self.answer = answer
        self.fail = False
        # What the "things to bring" call answers: None makes it fail as an unreachable Ollama.
        self.bring: list[str] | None = []
        self.queries: list[list[dict[str, str]]] = []  # messages of the query rewriting calls
        self.answers: list[list[dict[str, str]]] = []  # messages of the answer calls
        self.translations: list[list[dict[str, str]]] = []  # messages of the translation calls
        self.summaries: list[list[dict[str, str]]] = []  # messages of the "things to bring" calls

    async def embed(self, model, texts, *, cpu=False):
        vectors = np.zeros((len(texts), 512), dtype=np.float32)
        for row, text in enumerate(texts):
            for word in WORD.findall(text.lower()):
                vectors[row, zlib.crc32(word.encode()) % 512] += 1.0
        return vectors / np.clip(np.linalg.norm(vectors, axis=1, keepdims=True), 1e-12, None)

    async def chat(self, model, messages, **kwargs):
        properties = (kwargs.get("format") or {}).get("properties", {})
        if "translation" in properties:
            self.translations.append(messages)
            return json.dumps({"translation": "IT: " + messages[-1]["content"].split("\n", 1)[1]})
        if "bring" in properties:
            self.summaries.append(messages)
            if self.bring is None:
                raise OllamaError("Ollama unreachable")
            return json.dumps({"bring": self.bring})
        self.queries.append(messages)
        return json.dumps({"query": messages[-1]["content"].splitlines()[-1]})

    async def chat_stream(self, model, messages, **kwargs):
        self.answers.append(messages)
        if self.fail:
            raise OllamaError("Ollama unreachable")
        for word in self.answer.split(" "):
            yield word + " "

    async def load(self, model, options=None):
        pass

    async def aclose(self):
        pass


class FakeTTS:
    """Stand-in for the voices: returns a fixed WAV-like payload and records what it was given."""

    def __init__(self):
        self.fail = False
        self.calls: list[tuple[str, str]] = []
        self.loaded = True
        self.languages = ["it", "uk", "zh", "bn", "tl", "ar"]

    async def load(self):
        pass

    async def synthesize(self, text, language):
        self.calls.append((text, language))
        if self.fail:
            raise TTSError("Could not synthesise the text")
        return b"RIFF fake wav"


@pytest.fixture
def settings() -> Settings:
    return Settings(data_dir=FIXTURES, min_score=0.1, stt_preload=False, tts_preload=False, _env_file=None)


@pytest.fixture
def llm() -> FakeLLM:
    return FakeLLM()


@pytest.fixture
def tts() -> FakeTTS:
    return FakeTTS()


@pytest.fixture
def index(settings: Settings, llm: FakeLLM) -> SearchIndex:
    return asyncio.run(build_index(settings, llm))
