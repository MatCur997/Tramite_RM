import json

import pytest
from fastapi.testclient import TestClient

from app.main import create_app
from app.prompts import NO_DOCUMENTS


@pytest.fixture
def client(settings, llm, index):
    with TestClient(create_app(settings, llm, index)) as client:
        yield client


def stream(client: TestClient, **body) -> list[dict]:
    response = client.post("/api/chat/stream", json=body)
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("application/x-ndjson")
    return [json.loads(line) for line in response.text.splitlines() if line]


def test_answer_streams_tokens_then_cited_sources_and_their_forms(client):
    events = stream(client, message="Che documenti servono per la carta d'identità?", language="it")

    assert [e["type"] for e in events][-2:] == ["sources", "done"]
    assert "".join(e["text"] for e in events if e["type"] == "token").strip() == "Porta una fototessera [1]."
    sources = events[-2]
    assert sources["topic"] == "cie"
    assert sources["sources"] == [
        {
            "number": 1,
            "title": "Carta d'identità elettronica (documento di prova)",
            "kind": "pagina",
            "url": "https://example.org/cie",
            "copy": "http://testserver/files/cie.md",
            "topic": "cie",
        }
    ]
    assert sources["forms"] == [
        {"id": "delega", "title": "Modulo di delega (documento di prova)", "url": "http://testserver/files/delega.txt", "topic": "cie"}
    ]


def test_follow_up_questions_use_the_session_history(client, llm):
    stream(client, message="Come cambio residenza?", language="it", session_id="s1")
    assert llm.queries == []  # first Italian question: searched as it is

    stream(client, message="E che modulo serve?", language="it", session_id="s1")
    assert "Come cambio residenza?" in llm.queries[-1][-1]["content"]
    assert llm.answers[-1][1] == {"role": "user", "content": "Come cambio residenza?"}


def test_without_a_session_there_is_no_memory(client, llm):
    stream(client, message="Come cambio residenza?", language="it")
    stream(client, message="E che modulo serve?", language="it")
    assert len(llm.answers[-1]) == 2  # system prompt and question only


def test_other_languages_are_searched_in_italian_and_answered_in_their_language(client, llm):
    stream(client, message="Які документи потрібні для посвідки?", language="uk")
    assert len(llm.queries) == 1
    assert "Ukrainian" in llm.answers[-1][0]["content"]


def test_unknown_language_falls_back_to_italian(client, llm):
    stream(client, message="Ciao", language="xx")
    assert "Reply in Italian" in llm.answers[-1][-1]["content"]


def test_question_outside_the_documents_gets_no_sources(client, llm, settings):
    settings.min_score = 0.99
    events = stream(client, message="Che tempo fa domani?", language="it")
    assert NO_DOCUMENTS in llm.answers[-1][-1]["content"]
    assert events[-2] == {"type": "sources", "topic": None, "sources": [], "forms": []}


def test_llm_failure_is_reported_as_the_last_event(client, llm):
    llm.fail = True
    events = stream(client, message="Carta d'identità?", language="it")
    assert events[-1]["type"] == "error"
    assert client.post("/api/chat", json={"message": "Carta d'identità?"}).status_code == 502


def test_plain_endpoint_keeps_the_original_contract(client):
    response = client.post("/api/chat", json={"message": "Carta d'identità?", "language": "it"})
    assert response.status_code == 200
    body = response.json()
    assert body["reply"] == "Porta una fototessera [1]."
    assert body["sources"][0]["number"] == 1


def test_forms_are_served_and_health_reports_the_index(client, index):
    assert client.get("/files/delega.txt").status_code == 200
    assert client.get("/api/health").json()["passages"] == len(index)


def test_cors_allows_the_angular_dev_server(client):
    response = client.options(
        "/api/chat/stream",
        headers={"Origin": "http://localhost:4200", "Access-Control-Request-Method": "POST"},
    )
    assert response.headers["access-control-allow-origin"] == "http://localhost:4200"


def test_print_sends_the_decoded_pages_to_the_kiosk_printer(client, settings, monkeypatch):
    sent = []
    monkeypatch.setattr("app.main.print_pages", lambda pages, address: sent.append((pages, address)))

    response = client.post("/api/print", json={"pages": ["data:image/png;base64,UE5H"]})

    assert response.status_code == 200
    assert sent == [([b"PNG"], settings.printer_address)]


def test_print_reports_an_unreachable_printer(client, monkeypatch):
    from app.printer import PrinterError

    def fail(pages, address):
        raise PrinterError("spenta")

    monkeypatch.setattr("app.main.print_pages", fail)

    response = client.post("/api/print", json={"pages": ["data:image/png;base64,UE5H"]})

    assert response.status_code == 503
