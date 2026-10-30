"""RAG pipeline: Italian search query -> passages from the index -> streamed answer with citations."""

import json
import logging
import re
import time
from collections.abc import AsyncIterator
from dataclasses import dataclass
from typing import Any, Protocol
from urllib.parse import quote

import numpy as np

from .config import Settings
from .index import Chunk, Document, Hit, SearchIndex
from .languages import DEFAULT_LANGUAGE, LANGUAGES, resolve_language
from .ollama import Messages, OllamaError
from .privacy import anonymize
from .prompts import NO_DOCUMENTS, QUERY_SCHEMA, answer_messages, query_messages
from .sessions import SessionStore
from .summary import things_to_bring

log = logging.getLogger("totem.rag")

# [1], [1, 2], [1][3], 【1】 and native digits such as [১] or [٢]: \d matches them and int() parses them.
CITATION = re.compile(r"[\[【［]\s*(\d+(?:\s*[,،，、;]\s*\d+)*)\s*[\]】］]")
_CITATION_SEPARATOR = re.compile(r"[,،，、;]")


class LLM(Protocol):
    async def embed(self, model: str, texts: list[str], *, cpu: bool = False) -> np.ndarray: ...
    async def chat(self, model: str, messages: Messages, **kwargs: Any) -> str: ...
    def chat_stream(self, model: str, messages: Messages, **kwargs: Any) -> AsyncIterator[str]: ...
    async def load(self, model: str, options: dict[str, Any] | None = None) -> None: ...
    async def aclose(self) -> None: ...


@dataclass(frozen=True)
class Source:
    """A retrieved document, numbered as the LLM sees it and cites it."""

    number: int
    document: Document
    chunks: tuple[Chunk, ...]


def cited_numbers(answer: str) -> list[int]:
    """Source numbers cited in the answer, in order of first appearance."""
    numbers: list[int] = []
    for match in CITATION.finditer(answer):
        for part in _CITATION_SEPARATOR.split(match.group(1)):
            number = int(part.strip())
            if number not in numbers:
                numbers.append(number)
    return numbers


class AnswerCleaner:
    """Cleans the streamed answer of what the kiosk would show as raw text, whatever the model.

    - Bracketed notes that are not citations, such as "[no document]", are dropped: text after an
      opening bracket is held back until the bracket closes. Long or multi-line bracketed text
      is let through unchanged.
    - Markdown bold markers ("**") are dropped; a single "*" is kept.
    """

    _OPEN = "[【［"
    _CLOSE = "]】］"
    _MAX_HELD = 40

    def __init__(self) -> None:
        self._held = ""
        self._star = False

    def feed(self, text: str) -> str:
        out: list[str] = []
        for char in text:
            if self._star:
                self._star = False
                if char == "*":
                    continue
                out.append(self._note("*"))
            if char == "*":
                self._star = True
            else:
                out.append(self._note(char))
        return "".join(out)

    def flush(self) -> str:
        tail = self._note("*") if self._star else ""
        held, self._held, self._star = self._held, "", False
        return tail + held

    def _note(self, text: str) -> str:
        out: list[str] = []
        for char in text:
            if char in self._OPEN:
                out.append(self._held)
                self._held = char
            elif not self._held:
                out.append(char)
            else:
                self._held += char
                if char in self._CLOSE:
                    if CITATION.fullmatch(self._held):
                        out.append(self._held)
                    self._held = ""
                elif char == "\n" or len(self._held) > self._MAX_HELD:
                    out.append(self._held)
                    self._held = ""
        return "".join(out)


def group_by_document(hits: list[Hit], documents: dict[str, Document]) -> list[Source]:
    """Group the passages by document, numbering documents by their best passage."""
    grouped: dict[str, list[Chunk]] = {}
    for hit in hits:
        grouped.setdefault(hit.chunk.doc_id, []).append(hit.chunk)
    return [
        Source(number, documents[doc_id], tuple(chunks))
        for number, (doc_id, chunks) in enumerate(grouped.items(), start=1)
    ]


def format_sources(sources: list[Source]) -> str:
    if not sources:
        return NO_DOCUMENTS
    blocks = []
    for source in sources:
        passages = "\n\n".join(f"{c.section}\n{c.text}" if c.section else c.text for c in source.chunks)
        blocks.append(f"[{source.number}] {source.document.title}\n{passages}")
    return "\n\n---\n\n".join(blocks)


class RagPipeline:
    def __init__(self, settings: Settings, llm: LLM, index: SearchIndex | None, sessions: SessionStore):
        self.settings = settings
        self.llm = llm
        self.index = index
        self.sessions = sessions
        self._options = {"num_ctx": settings.llm_num_ctx, "temperature": settings.llm_temperature}
        built_with = index.meta.get("embed_model") if index else None
        if built_with and built_with != settings.embed_model:
            log.warning("Index built with %s but queries use %s: rebuild it", built_with, settings.embed_model)

    async def warmup(self) -> None:
        """Load both models into memory, so that the first question of the demo is not slow."""
        try:
            await self.llm.load(self.settings.llm_model, {"num_ctx": self.settings.llm_num_ctx})
            await self.llm.embed(self.settings.embed_model, ["warmup"], cpu=self.settings.embed_on_cpu)
            log.info("Models loaded: %s, %s", self.settings.llm_model, self.settings.embed_model)
        except OllamaError as exc:
            log.warning("Could not preload the models: %s", exc)

    async def answer(
        self, message: str, language: str | None, session_id: str | None, files_url: str
    ) -> AsyncIterator[dict[str, Any]]:
        """Stream the answer as events: "token" (text), then "sources", then "summary" (what to
        bring to the counter, only when the answer mentions something), then "done"."""
        started = time.perf_counter()
        code = resolve_language(language)
        session = self.sessions.get(session_id, code) if session_id else None
        history = list(session.history) if session else []

        query = await self._search_query(message, code, history)
        sources = await self._retrieve(message, query)
        messages = answer_messages(message, query, LANGUAGES[code], history, format_sources(sources))

        parts: list[str] = []
        cleaner = AnswerCleaner()
        async for piece in self.llm.chat_stream(
            self.settings.llm_model, messages, options=self._options, think=self.settings.llm_think
        ):
            text = cleaner.feed(piece)
            if text:
                parts.append(text)
                yield {"type": "token", "text": text}
        if tail := cleaner.flush():
            parts.append(tail)
            yield {"type": "token", "text": tail}
        answer = "".join(parts).strip()

        cited = self._cited(answer, sources, files_url)
        yield {"type": "sources", **cited}
        if session:
            self.sessions.append(session, message, answer)
        log.info("Answered in %.1fs (%s, %d characters)", time.perf_counter() - started, code, len(answer))
        # Greetings and other subjects cite no document: nothing to bring, no need to ask.
        if self.settings.summary_enabled and cited["sources"]:
            if bring := await self._things_to_bring(answer, code):
                yield {"type": "summary", "bring": bring}
        yield {"type": "done"}

    async def _things_to_bring(self, answer: str, language: str) -> list[str]:
        """What the answer says to bring or prepare; nothing when that fails: the answer is already complete."""
        try:
            return await things_to_bring(self.llm, self.settings, LANGUAGES[language], CITATION.sub("", answer))
        except Exception as exc:  # whatever it is, it must not reach the citizen's chat
            log.warning("No list of things to bring: %s", exc)
            return []

    async def _search_query(self, message: str, language: str, history: Messages) -> str:
        """Italian, self-contained version of the message; empty for greetings."""
        if language == DEFAULT_LANGUAGE and not history:
            return message
        try:
            raw = await self.llm.chat(
                self.settings.llm_model,
                query_messages(message, history),
                options={**self._options, "temperature": 0},
                think=self.settings.llm_think,
                format=QUERY_SCHEMA,
            )
            return str(json.loads(raw).get("query", "")).strip()
        except (OllamaError, ValueError, AttributeError) as exc:
            log.warning("Query rewriting failed, searching with the original message: %s", exc)
            return message

    async def _retrieve(self, message: str, query: str) -> list[Source]:
        if not self.index:
            return []
        texts = [query or message]
        if query and query != message:
            texts.append(message)  # the citizen's own words, matched across languages by bge-m3
        vectors = await self.llm.embed(self.settings.embed_model, texts, cpu=self.settings.embed_on_cpu)
        hits = self.index.search(vectors, self.settings.top_k)
        best = max((hit.similarity for hit in hits), default=0.0)
        if best < self.settings.min_score:
            log.info("Query %r: no relevant passage (best similarity %.2f)", anonymize(query), best)
            return []
        sources = group_by_document(hits, self.index.documents)
        log.info("Query %r: %s (best similarity %.2f)", anonymize(query), [s.document.id for s in sources], best)
        return sources

    def _cited(self, answer: str, sources: list[Source], files_url: str) -> dict[str, Any]:
        """The sources cited in the answer, the forms (moduli) linked to them, and the topic of the
        answer: that of the first source cited, None when it cites none (greetings, other subjects)."""
        by_number = {source.number: source for source in sources}
        documents = self.index.documents if self.index else {}
        cited: list[dict[str, Any]] = []
        forms: list[dict[str, Any]] = []
        for number in cited_numbers(answer):
            source = by_number.get(number)
            if source is None:
                continue
            document = source.document
            local = f"{files_url}/{quote(document.file)}" if document.file else None
            # "copy": the saved text of the page, shown on the kiosk when the site cannot be embedded.
            cited.append({
                "number": number, "title": document.title, "kind": document.kind,
                "url": document.url or local, "copy": local, "topic": document.topic,
            })
            form_ids = ((document.id,) if document.kind == "modulo" else ()) + document.forms
            for form_id in form_ids:
                form = documents.get(form_id)
                if form and form.file and all(f["id"] != form_id for f in forms):
                    forms.append({"id": form_id, "title": form.title, "url": f"{files_url}/{quote(form.file)}", "topic": form.topic})
        return {"topic": cited[0]["topic"] if cited else None, "sources": cited, "forms": forms}
