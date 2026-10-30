import json

import pytest
from fastapi.testclient import TestClient

from app.main import create_app


@pytest.fixture
def client(settings, llm, index):
    with TestClient(create_app(settings, llm, index)) as client:
        yield client


def stream(client: TestClient, **body) -> list[dict]:
    response = client.post("/api/chat/stream", json=body)
    assert response.status_code == 200
    return [json.loads(line) for line in response.text.splitlines() if line]


def test_the_things_to_bring_follow_the_sources_in_the_language_of_the_conversation(client, llm):
    llm.bring = ["Фотографія", "Старе посвідчення"]

    # The Italian name of the document, as citizens often say it: the fake search finds it.
    events = stream(client, message="Які документи потрібні для carta d'identità?", language="uk")

    assert [e["type"] for e in events][-3:] == ["sources", "summary", "done"]
    assert events[-2] == {"type": "summary", "bring": ["Фотографія", "Старе посвідчення"]}
    system, user = llm.summaries[-1]
    assert "Ukrainian" in system["content"]
    assert user["content"] == "ANSWER:\nPorta una fototessera ."  # without the source numbers


def test_an_answer_with_nothing_to_bring_has_no_summary(client, llm):
    events = stream(client, message="Che documenti servono per la carta d'identità?", language="it")

    assert [e["type"] for e in events][-2:] == ["sources", "done"]
    assert len(llm.summaries) == 1


def test_a_failed_summary_does_not_break_the_answer(client, llm):
    llm.bring = None

    events = stream(client, message="Che documenti servono per la carta d'identità?", language="it")

    assert [e["type"] for e in events][-2:] == ["sources", "done"]
    assert all(e["type"] != "error" for e in events)


def test_a_summary_that_is_not_json_is_left_out(client, llm):
    async def broken(*args, **kwargs):
        return "not json"

    llm.chat = broken

    events = stream(client, message="Che documenti servono per la carta d'identità?", language="it")

    assert [e["type"] for e in events][-2:] == ["sources", "done"]


def test_the_list_has_no_repetitions_and_at_most_six_items(client, llm):
    llm.bring = ["Foto", " foto ", "", "Passaporto", "Codice fiscale", "Ricevuta", "Marca da bollo", "Delega", "Copia"]

    events = stream(client, message="Che documenti servono per la carta d'identità?", language="it")

    assert events[-2]["bring"] == ["Foto", "Passaporto", "Codice fiscale", "Ricevuta", "Marca da bollo", "Delega"]


def test_greetings_and_other_subjects_are_not_summarised(client, llm):
    llm.answer = "Buongiorno! Come posso aiutarti?"
    llm.bring = ["Qualcosa"]

    events = stream(client, message="Buongiorno", language="it")

    assert [e["type"] for e in events][-2:] == ["sources", "done"]
    assert llm.summaries == []


def test_the_summary_can_be_turned_off(client, llm, settings):
    settings.summary_enabled = False
    llm.bring = ["Foto"]

    events = stream(client, message="Che documenti servono per la carta d'identità?", language="it")

    assert [e["type"] for e in events][-2:] == ["sources", "done"]
    assert llm.summaries == []


def test_the_plain_endpoint_returns_the_topic_and_the_things_to_bring(client, llm):
    llm.bring = ["Foto"]

    body = client.post("/api/chat", json={"message": "Che documenti servono per la carta d'identità?", "language": "it"}).json()

    assert body["topic"] == "cie"
    assert body["bring"] == ["Foto"]
    assert body["reply"] == "Porta una fototessera [1]."
