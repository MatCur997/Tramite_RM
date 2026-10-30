"""Search index over the document passages: cosine similarity between bge-m3 embeddings.

bge-m3 also matches questions and passages written in different languages. A keyword search (BM25,
with an Italian stemmer) was tried alongside it and dropped: on 31 labelled questions, acronyms
such as TARI, AIRE and SPID included, the embeddings alone found the right document among the
first five for 30 of them, and every mix with BM25 did worse.

At most two passages per document are kept, so that an answer can draw on several documents.
"""

import json
import logging
from collections import Counter
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

import numpy as np

log = logging.getLogger("totem.index")

MAX_PER_DOCUMENT = 2


@dataclass(frozen=True)
class Document:
    id: str
    title: str
    kind: str = "pagina"  # "pagina", "modulo" or "norma"
    # What the document is about ("cie", "residenza"...): the kiosk groups the conversation by it.
    topic: str | None = None
    url: str | None = None  # original web page
    file: str | None = None  # file in data/docs, served at /files
    forms: tuple[str, ...] = ()  # ids of the forms (moduli) related to this document


@dataclass(frozen=True)
class Chunk:
    doc_id: str
    section: str
    text: str


@dataclass(frozen=True)
class Hit:
    chunk: Chunk
    similarity: float  # best cosine similarity with the query embeddings


class SearchIndex:
    def __init__(
        self,
        documents: dict[str, Document],
        chunks: list[Chunk],
        vectors: np.ndarray,
        meta: dict[str, Any] | None = None,
    ):
        if len(chunks) != len(vectors):
            raise ValueError(f"{len(chunks)} chunks but {len(vectors)} vectors")
        self.documents = documents
        self.chunks = chunks
        self.vectors = vectors
        self.meta = meta or {}

    def __len__(self) -> int:
        return len(self.chunks)

    def search(self, query_vectors: np.ndarray, k: int) -> list[Hit]:
        """The k passages most similar to any of the query embeddings (one per row)."""
        if not self.chunks:
            return []
        best = (self.vectors @ query_vectors.T).max(axis=1)
        hits: list[Hit] = []
        per_document: Counter[str] = Counter()
        for i in np.argsort(-best):
            doc_id = self.chunks[i].doc_id
            if per_document[doc_id] < MAX_PER_DOCUMENT:
                per_document[doc_id] += 1
                hits.append(Hit(self.chunks[i], float(best[i])))
                if len(hits) == k:
                    break
        return hits

    def save(self, directory: Path) -> None:
        directory.mkdir(parents=True, exist_ok=True)
        documents = [asdict(document) for document in self.documents.values()]
        _write_json(directory / "documents.json", documents)
        with (directory / "chunks.jsonl").open("w", encoding="utf-8") as file:
            for chunk in self.chunks:
                file.write(json.dumps(asdict(chunk), ensure_ascii=False) + "\n")
        np.save(directory / "vectors.npy", self.vectors)
        _write_json(directory / "meta.json", self.meta)

    @classmethod
    def load(cls, directory: Path) -> "SearchIndex":
        documents = {}
        for entry in json.loads((directory / "documents.json").read_text(encoding="utf-8")):
            documents[entry["id"]] = Document(**{**entry, "forms": tuple(entry.get("forms", ()))})
        lines = (directory / "chunks.jsonl").read_text(encoding="utf-8").splitlines()
        chunks = [Chunk(**json.loads(line)) for line in lines if line.strip()]
        vectors = np.load(directory / "vectors.npy")
        meta = json.loads((directory / "meta.json").read_text(encoding="utf-8"))
        return cls(documents, chunks, vectors, meta)


def load_index(directory: Path) -> SearchIndex | None:
    """The index saved by `python -m app.ingest`, or None if it was never built."""
    if not (directory / "chunks.jsonl").exists():
        log.warning("No index in %s: run `uv run python -m app.ingest` first", directory)
        return None
    index = SearchIndex.load(directory)
    log.info("Index loaded: %d passages from %d documents", len(index), len(index.documents))
    return index


def _write_json(path: Path, data: Any) -> None:
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
