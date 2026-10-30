"""Minimal async client for the Ollama HTTP API: chat, streaming chat and embeddings."""

import json
from collections.abc import AsyncIterator
from typing import Any

import httpx
import numpy as np

Messages = list[dict[str, str]]


class OllamaError(RuntimeError):
    def __init__(self, message: str, status: int | None = None):
        super().__init__(message)
        self.status = status


class Ollama:
    def __init__(self, base_url: str, keep_alive: str = "30m", timeout: float = 300.0):
        self._http = httpx.AsyncClient(base_url=base_url, timeout=httpx.Timeout(timeout, connect=5.0))
        self._keep_alive = keep_alive
        # Models that answered 400 to the "think" flag: it is not sent to them again.
        self._no_think: set[str] = set()

    async def aclose(self) -> None:
        await self._http.aclose()

    async def embed(self, model: str, texts: list[str], *, cpu: bool = False) -> np.ndarray:
        """Return one L2-normalised embedding per text."""
        body: dict[str, Any] = {"model": model, "input": texts, "keep_alive": self._keep_alive}
        if cpu:
            body["options"] = {"num_gpu": 0}
        data = await self._post("/api/embed", body)
        vectors = np.asarray(data["embeddings"], dtype=np.float32)
        return vectors / np.clip(np.linalg.norm(vectors, axis=1, keepdims=True), 1e-12, None)

    async def chat(
        self,
        model: str,
        messages: Messages,
        *,
        options: dict[str, Any] | None = None,
        think: bool | None = None,
        format: dict[str, Any] | None = None,
    ) -> str:
        body = self._chat_body(model, messages, options, think, stream=False)
        if format is not None:
            body["format"] = format
        try:
            data = await self._post("/api/chat", body)
        except OllamaError as exc:
            if not self._drop_think(model, body, exc):
                raise
            data = await self._post("/api/chat", body)
        return data["message"]["content"]

    async def chat_stream(
        self,
        model: str,
        messages: Messages,
        *,
        options: dict[str, Any] | None = None,
        think: bool | None = None,
    ) -> AsyncIterator[str]:
        body = self._chat_body(model, messages, options, think, stream=True)
        try:
            for attempt in range(2):
                async with self._http.stream("POST", "/api/chat", json=body) as response:
                    if response.status_code != 200:
                        error = OllamaError(_error_message(response.status_code, await response.aread()), response.status_code)
                        if attempt == 0 and self._drop_think(model, body, error):
                            continue
                        raise error
                    async for line in response.aiter_lines():
                        if not line:
                            continue
                        chunk = json.loads(line)
                        if "error" in chunk:
                            raise OllamaError(chunk["error"])
                        text = chunk.get("message", {}).get("content", "")
                        if text:
                            yield text
                    return
        except httpx.HTTPError as exc:
            raise OllamaError(f"Ollama unreachable at {self._http.base_url}: {exc!r}") from exc

    async def load(self, model: str, options: dict[str, Any] | None = None) -> None:
        """Load a chat model into memory, so that the first question is not slow."""
        body: dict[str, Any] = {"model": model, "keep_alive": self._keep_alive}
        if options:
            body["options"] = options
        await self._post("/api/generate", body)

    def _chat_body(
        self, model: str, messages: Messages, options: dict[str, Any] | None, think: bool | None, stream: bool
    ) -> dict[str, Any]:
        body: dict[str, Any] = {"model": model, "messages": messages, "stream": stream, "keep_alive": self._keep_alive}
        if options:
            body["options"] = options
        if think is not None and model not in self._no_think:
            body["think"] = think
        return body

    def _drop_think(self, model: str, body: dict[str, Any], error: OllamaError) -> bool:
        """If Ollama rejected the "think" flag, remove it so that the request can be retried."""
        if error.status == 400 and "think" in body and "think" in str(error).lower():
            self._no_think.add(model)
            del body["think"]
            return True
        return False

    async def _post(self, path: str, body: dict[str, Any]) -> dict[str, Any]:
        try:
            response = await self._http.post(path, json=body)
        except httpx.HTTPError as exc:
            raise OllamaError(f"Ollama unreachable at {self._http.base_url}: {exc!r}") from exc
        if response.status_code != 200:
            raise OllamaError(_error_message(response.status_code, response.content), response.status_code)
        return response.json()


def _error_message(status: int, raw: bytes) -> str:
    try:
        detail = json.loads(raw).get("error", "")
    except (ValueError, AttributeError):
        detail = raw.decode(errors="replace")
    return f"Ollama HTTP {status}: {detail[:300]}"
