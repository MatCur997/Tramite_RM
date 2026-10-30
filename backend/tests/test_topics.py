import json

import pytest
from fastapi.testclient import TestClient

from app.config import BACKEND_DIR
from app.index import SearchIndex
from app.main import create_app

TOPICS = {"cie", "residenza", "stranieri", "certificati", "autocertificazione", "estero", "stato-civile"}


@pytest.fixture
def client(settings, llm, index):
    with TestClient(create_app(settings, llm, index)) as client:
        yield client


def sources_event(client: TestClient, **body) -> dict:
    lines = client.post("/api/chat/stream", json=body).text.splitlines()
    return next(event for event in map(json.loads, lines) if event["type"] == "sources")


def test_every_document_of_the_kiosk_has_a_topic():
    documents = json.loads((BACKEND_DIR / "data" / "sources.json").read_text(encoding="utf-8"))

    missing = [document["id"] for document in documents if document.get("topic") not in TOPICS]

    assert missing == []


def test_the_topic_of_an_answer_is_that_of_its_first_source_and_a_follow_up_keeps_it(client):
    first = sources_event(client, message="Che documenti servono per la carta d'identità?", language="it", session_id="s1")
    follow_up = sources_event(client, message="E per la carta d'identità di mio figlio?", language="it", session_id="s1")

    assert first["topic"] == follow_up["topic"] == "cie"


def test_an_answer_without_sources_has_no_topic(client, llm):
    llm.answer = "Buongiorno! Come posso aiutarti?"

    assert sources_event(client, message="Buongiorno", language="it")["topic"] is None


def test_the_topic_goes_through_the_index_and_old_indexes_still_load(index, tmp_path):
    index.save(tmp_path)
    assert SearchIndex.load(tmp_path).documents["cie"].topic == "cie"

    # An index built before topics existed: its documents simply have none.
    documents = json.loads((tmp_path / "documents.json").read_text(encoding="utf-8"))
    for document in documents:
        del document["topic"]
    (tmp_path / "documents.json").write_text(json.dumps(documents), encoding="utf-8")
    assert SearchIndex.load(tmp_path).documents["cie"].topic is None
