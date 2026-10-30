"""Build the search index from data/sources.json and the files in data/docs.

    uv run python -m app.ingest

Each entry of sources.json describes one document:

    {"id": "cie", "title": "Carta d'identità elettronica (CIE)", "kind": "pagina",
     "file": "cie.html", "url": "https://www.comune.roma.it/...", "forms": ["delega-cie"]}

"kind" is "pagina", "modulo" (a form, offered to the citizen as a file) or "norma".
"forms" lists the ids of the forms shown when the document is cited.
Files can be HTML pages, PDFs, Markdown or plain text.
"""

import argparse
import asyncio
import json
import logging
import re
import time
from pathlib import Path

import numpy as np
import trafilatura
from pypdf import PdfReader

from .config import Settings
from .index import Chunk, Document, SearchIndex
from .ollama import Ollama
from .rag import LLM

log = logging.getLogger("totem.ingest")

MAX_CHARS = 1200
MIN_SECTION_CHARS = 300
OVERLAP_CHARS = 250
EMBED_BATCH = 16

_HEADING = re.compile(r"^(#{1,6})\s+(.*\S)\s*$")
_PARAGRAPH_BREAK = re.compile(r"\n\s*\n")
_SENTENCE_END = re.compile(r"(?<=[.;:!?])\s+")
_SPACES = re.compile(r"[ \t]+")


def html_to_markdown(html: str) -> str:
    """Main text of a web page as Markdown, without menus and footers."""
    text = trafilatura.extract(
        html, output_format="markdown", include_tables=True, include_comments=False, favor_recall=True
    )
    return text or ""


def read_text(path: Path) -> str:
    """Text of a source file: PDF, HTML page, Markdown or plain text."""
    suffix = path.suffix.lower()
    if suffix == ".pdf":
        return "\n\n".join(page.extract_text() or "" for page in PdfReader(path).pages)
    if suffix in (".html", ".htm"):
        return html_to_markdown(path.read_text(encoding="utf-8", errors="replace"))
    return path.read_text(encoding="utf-8")


def split_sections(text: str) -> list[tuple[str, str]]:
    """Split Markdown text into (heading path, body) pairs, e.g. ("Come fare > Documenti", "...")."""
    sections: list[tuple[str, str]] = []
    headings: list[str] = []
    body: list[str] = []

    def flush() -> None:
        content = "\n".join(body).strip()
        if content:
            sections.append((" > ".join(headings), content))
        body.clear()

    for line in text.splitlines():
        match = _HEADING.match(line)
        if match:
            flush()
            headings[len(match.group(1)) - 1 :] = [match.group(2).strip("*_ ")]
        else:
            body.append(line)
    flush()
    return sections


def merge_small_sections(sections: list[tuple[str, str]], min_chars: int = MIN_SECTION_CHARS) -> list[tuple[str, str]]:
    """Join sections too short to stand alone, such as "See the costs page.", with their neighbours.

    The heading of a joined section stays in the text as a line of its own.
    """
    merged: list[tuple[str, str]] = []
    for heading, body in sections:
        if merged and (len(merged[-1][1]) < min_chars or len(body) < min_chars):
            previous_heading, previous_body = merged[-1]
            title = heading.rsplit(" > ", 1)[-1]
            merged[-1] = (previous_heading, f"{previous_body}\n\n{title}\n{body}" if title else f"{previous_body}\n\n{body}")
        else:
            merged.append((heading, body))
    return merged


def chunk_text(text: str, max_chars: int = MAX_CHARS, overlap: int = OVERLAP_CHARS) -> list[str]:
    """Pack paragraphs into chunks of about max_chars; a short last paragraph is repeated as overlap."""
    pieces: list[str] = []
    for paragraph in _PARAGRAPH_BREAK.split(text):
        paragraph = _SPACES.sub(" ", paragraph).strip()
        if paragraph:
            pieces.extend([paragraph] if len(paragraph) <= max_chars else _split_long(paragraph, max_chars))

    chunks: list[str] = []
    current: list[str] = []
    for piece in pieces:
        if current and sum(len(p) + 2 for p in current) + len(piece) > max_chars:
            chunks.append("\n\n".join(current))
            current = [current[-1]] if len(current[-1]) <= overlap else []
        current.append(piece)
    if current:
        chunks.append("\n\n".join(current))
    return chunks


def _split_long(paragraph: str, max_chars: int) -> list[str]:
    parts: list[str] = []
    current = ""
    for sentence in _SENTENCE_END.split(paragraph):
        if current and len(current) + 1 + len(sentence) > max_chars:
            parts.append(current)
            current = ""
        while len(sentence) > max_chars:
            parts.append(sentence[:max_chars])
            sentence = sentence[max_chars:]
        current = f"{current} {sentence}".strip()
    if current:
        parts.append(current)
    return parts


def load_manifest(path: Path) -> list[Document]:
    entries = json.loads(path.read_text(encoding="utf-8"))
    documents = [
        Document(
            id=entry["id"],
            title=entry["title"],
            kind=entry.get("kind", "pagina"),
            topic=entry.get("topic"),
            url=entry.get("url"),
            file=entry.get("file"),
            forms=tuple(entry.get("forms", ())),
        )
        for entry in entries
    ]
    ids = [document.id for document in documents]
    duplicates = {i for i in ids if ids.count(i) > 1}
    if duplicates:
        raise ValueError(f"Duplicate ids in {path.name}: {sorted(duplicates)}")
    for document in documents:
        for form_id in document.forms:
            if form_id not in ids:
                log.warning("%s: unknown form %r", document.id, form_id)
    return documents


async def build_index(settings: Settings, llm: LLM) -> SearchIndex:
    documents = load_manifest(settings.manifest_path)
    chunks: list[Chunk] = []
    for document in documents:
        path = settings.docs_dir / document.file if document.file else None
        if path is None or not path.exists():
            log.warning("%-32s skipped: file %s not found", document.id, document.file)
            continue
        found = [
            Chunk(document.id, section, piece)
            for section, body in merge_small_sections(split_sections(read_text(path)))
            for piece in chunk_text(body)
        ]
        if not found:
            log.warning("%-32s no text extracted (scanned PDF?)", document.id)
        log.info("%-32s %3d passages", document.id, len(found))
        chunks.extend(found)

    by_id = {document.id: document for document in documents}
    # The title and section go into the embedding too: passages often do not repeat what they are about.
    texts = [f"{by_id[c.doc_id].title}\n{c.section}\n{c.text}" for c in chunks]
    batches = [
        await llm.embed(settings.embed_model, texts[i : i + EMBED_BATCH], cpu=settings.embed_on_cpu)
        for i in range(0, len(texts), EMBED_BATCH)
    ]
    vectors = np.vstack(batches) if batches else np.zeros((0, 0), dtype=np.float32)
    meta = {
        "embed_model": settings.embed_model,
        "built_at": time.strftime("%Y-%m-%d %H:%M:%S"),
        "documents": len(documents),
        "passages": len(chunks),
    }
    return SearchIndex(by_id, chunks, vectors, meta)


async def _run(settings: Settings) -> None:
    started = time.perf_counter()
    llm = Ollama(settings.ollama_url, settings.keep_alive)
    try:
        index = await build_index(settings, llm)
    finally:
        await llm.aclose()
    index.save(settings.index_dir)
    log.info(
        "Index of %d passages from %d documents saved in %s (%.0fs)",
        len(index), len(index.documents), settings.index_dir, time.perf_counter() - started,
    )


def main() -> None:
    parser = argparse.ArgumentParser(description="Build the search index from sources.json and docs/.")
    parser.add_argument("--data-dir", type=Path, help="folder with sources.json and docs/ (default: backend/data)")
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    logging.getLogger("httpx").setLevel(logging.WARNING)
    settings = Settings(data_dir=args.data_dir) if args.data_dir else Settings()
    asyncio.run(_run(settings))


if __name__ == "__main__":
    main()
