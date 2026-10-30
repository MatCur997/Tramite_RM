import numpy as np

from app.index import Chunk, Document, SearchIndex
from app.ingest import chunk_text, merge_small_sections, split_sections
from app.rag import AnswerCleaner, cited_numbers
from app.sessions import SessionStore


def small_index() -> SearchIndex:
    documents = {"a": Document("a", "A"), "b": Document("b", "B")}
    chunks = [Chunk("a", "", "uno"), Chunk("a", "", "due"), Chunk("a", "", "tre"), Chunk("b", "", "quattro")]
    vectors = np.array([[1.0, 0.0], [0.99, 0.14], [0.98, 0.2], [0.0, 1.0]], dtype=np.float32)
    return SearchIndex(documents, chunks, vectors)


def test_search_keeps_at_most_two_passages_per_document():
    hits = small_index().search(np.array([[1.0, 0.0]], dtype=np.float32), k=3)
    assert [hit.chunk.text for hit in hits] == ["uno", "due", "quattro"]
    assert hits[0].similarity == 1.0


def test_search_uses_the_best_of_several_query_embeddings():
    queries = np.array([[1.0, 0.0], [0.0, 1.0]], dtype=np.float32)
    hits = small_index().search(queries, k=2)
    assert {hit.chunk.text for hit in hits} == {"uno", "quattro"}


def test_split_sections_keeps_the_heading_path():
    text = "# CIE\nintro\n## Documenti\n- foto\n### Minori\nassenso\n## Costi\neuro"
    assert split_sections(text) == [
        ("CIE", "intro"),
        ("CIE > Documenti", "- foto"),
        ("CIE > Documenti > Minori", "assenso"),
        ("CIE > Costi", "euro"),
    ]


def test_small_sections_are_joined_with_their_neighbours():
    long_text = "testo " * 60
    sections = [("CIE", long_text), ("CIE > Costi", "Vedi la scheda dei costi."), ("CIE > Minori", long_text)]
    assert merge_small_sections(sections) == [
        ("CIE", f"{long_text}\n\nCosti\nVedi la scheda dei costi."),
        ("CIE > Minori", long_text),
    ]
    assert merge_small_sections([("A", long_text), ("B", long_text)]) == [("A", long_text), ("B", long_text)]


def test_chunks_respect_the_size_and_repeat_a_short_paragraph():
    paragraphs = [f"Paragrafo {i} " + "parola " * 30 for i in range(10)]
    chunks = chunk_text("\n\n".join(paragraphs), max_chars=600, overlap=250)
    assert len(chunks) > 1
    assert all(len(chunk) <= 600 for chunk in chunks)
    assert chunks[0].split("\n\n")[-1] == chunks[1].split("\n\n")[0]


def test_long_paragraphs_are_split_on_sentences():
    chunks = chunk_text(" ".join(f"Frase numero {i}." for i in range(200)), max_chars=300, overlap=0)
    assert all(len(chunk) <= 300 for chunk in chunks)
    assert sum(chunk.count("Frase") for chunk in chunks) == 200


def test_cited_numbers_reads_lists_full_width_brackets_and_native_digits():
    assert cited_numbers("A [2]. B [1, 3][2]. C 【4】 D [১] E [٢،٣] F [x]") == [2, 1, 3, 4]


def clean(*pieces: str) -> str:
    cleaner = AnswerCleaner()
    return "".join(cleaner.feed(piece) for piece in pieces) + cleaner.flush()


def test_cleaner_keeps_citations_and_drops_other_bracketed_notes_across_pieces():
    pieces = ["Vai allo sportello [", "1][2", "]. Grazie [nessun", " documento]. Fine 【3】", " e [১] [x"]
    assert clean(*pieces) == "Vai allo sportello [1][2]. Grazie . Fine 【3】 e [১] [x"


def test_cleaner_lets_long_or_multiline_brackets_through():
    long_note = "[" + "a" * 50 + "]"
    assert clean(long_note) == long_note
    assert clean("[riga\naltra]") == "[riga\naltra]"


def test_cleaner_drops_bold_markers_but_keeps_single_asterisks():
    assert clean("Porta il **codice", " fiscale*", "* [1]") == "Porta il codice fiscale [1]"
    assert clean("* voce di elenco\n2 * 3 = 6 *") == "* voce di elenco\n2 * 3 = 6 *"


def test_sessions_keep_the_last_turns_and_reset_on_expiry_or_language_change():
    now = [0.0]
    store = SessionStore(ttl_seconds=60, max_turns=2, clock=lambda: now[0])
    session = store.get("a", "it")
    for i in range(3):
        store.append(session, f"q{i}", f"a{i}")
    assert [m["content"] for m in store.get("a", "it").history] == ["q1", "a1", "q2", "a2"]

    assert store.get("a", "uk").history == []
    store.append(store.get("a", "uk"), "q", "a")
    now[0] = 61
    assert store.get("a", "uk").history == []


def test_index_survives_a_save_and_load(tmp_path, index):
    index.save(tmp_path)
    loaded = SearchIndex.load(tmp_path)
    assert loaded.chunks == index.chunks
    assert loaded.documents == index.documents
    assert (loaded.vectors == index.vectors).all()
    assert loaded.meta["embed_model"] == "bge-m3"


def test_ingestion_reads_every_document_with_its_sections(index):
    assert {chunk.doc_id for chunk in index.chunks} == {"cie", "residenza", "modulo-residenza", "delega"}
    cie = [chunk for chunk in index.chunks if chunk.doc_id == "cie"]
    assert cie[0].section == "Carta d'identità elettronica > Come richiederla"
    assert "Documenti da portare\n- una fototessera recente" in cie[0].text
