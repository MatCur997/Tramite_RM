import pytest
from fastapi.testclient import TestClient

from app.main import create_app
from app.stt import SpeechError


class FakeTranscriber:
    def __init__(self):
        self.calls: list[tuple[bytes, str | None]] = []
        self.fail = False

    def load(self):
        pass

    def transcribe(self, audio, language):
        self.calls.append((audio, language))
        if self.fail:
            raise SpeechError("Audio non riconosciuto")
        return "come rinnovo la carta d'identità"


@pytest.fixture
def transcriber():
    return FakeTranscriber()


@pytest.fixture
def client(settings, llm, index, transcriber, tts):
    with TestClient(create_app(settings, llm, index, transcriber, tts)) as client:
        yield client


def test_the_recording_is_transcribed_in_the_kiosk_language(client, transcriber):
    response = client.post("/api/transcribe?language=uk", content=b"webm-bytes", headers={"Content-Type": "audio/webm"})

    assert response.status_code == 200
    assert response.json() == {"text": "come rinnovo la carta d'identità"}
    assert transcriber.calls == [(b"webm-bytes", "uk")]


def test_an_empty_or_unreadable_recording_is_refused(client, transcriber):
    assert client.post("/api/transcribe?language=it", content=b"").status_code == 422
    transcriber.fail = True
    assert client.post("/api/transcribe?language=it", content=b"noise").status_code == 422


def test_a_foreign_conversation_is_translated_message_by_message(client, llm):
    response = client.post("/api/conversation/translate", json={"language": "ar", "texts": ["سؤال", "جواب [1]"]})

    assert response.status_code == 200
    assert response.json() == {"texts": ["IT: سؤال", "IT: جواب [1]"]}
    assert len(llm.translations) == 2
    assert "Arabic" in llm.translations[0][-1]["content"]


def test_an_italian_conversation_is_not_translated(client, llm):
    response = client.post("/api/conversation/translate", json={"language": "it", "texts": ["Domanda", "Risposta"]})

    assert response.json() == {"texts": ["Domanda", "Risposta"]}
    assert llm.translations == []


def test_a_failed_translation_is_reported(client, llm):
    async def broken(*args, **kwargs):
        return "not json"

    llm.chat = broken
    assert client.post("/api/conversation/translate", json={"language": "ar", "texts": ["سؤال"]}).status_code == 502


def test_a_recording_too_long_is_refused(client, transcriber):
    from app.stt import MAX_AUDIO_BYTES

    response = client.post("/api/transcribe?language=it", content=b"x" * (MAX_AUDIO_BYTES + 1))

    assert response.status_code == 413
    assert transcriber.calls == []


def test_a_sentence_is_read_aloud_without_its_citations(client, tts):
    response = client.post("/api/tts", json={"text": "Porta la foto [1][2].", "language": "ar"})

    assert response.status_code == 200
    assert response.headers["content-type"] == "audio/wav"
    assert response.content == b"RIFF fake wav"
    assert tts.calls == [("Porta la foto.", "ar")]
    assert client.get("/api/health").json()["voices_loaded"] is True


def test_speech_in_an_unknown_language_is_read_in_italian(client, tts):
    client.post("/api/tts", json={"text": "Ciao", "language": "xx"})

    assert tts.calls[-1][1] == "it"


def test_a_line_of_citations_only_has_nothing_to_read(client, tts):
    assert client.post("/api/tts", json={"text": "[1][4]", "language": "it"}).status_code == 204
    assert tts.calls == []


def test_too_long_or_empty_texts_are_not_read(client, tts):
    assert client.post("/api/tts", json={"text": "x" * 1001, "language": "it"}).status_code == 422
    assert client.post("/api/tts", json={"text": "", "language": "it"}).status_code == 422
    assert tts.calls == []


def test_a_failed_synthesis_is_reported_without_details(client, tts):
    tts.fail = True
    response = client.post("/api/tts", json={"text": "Ciao", "language": "it"})

    assert response.status_code == 502
    assert response.json() == {"detail": "Sintesi vocale non riuscita"}


def test_the_things_to_bring_are_translated_too_up_to_sixty_short_texts(client, llm):
    items = [f"- Документ номер {n}" for n in range(60)]

    response = client.post("/api/conversation/translate", json={"language": "uk", "texts": items})

    assert response.status_code == 200
    assert response.json() == {"texts": [f"IT: {item}" for item in items]}
    too_many = {"language": "uk", "texts": [*items, "uno di troppo"]}
    assert client.post("/api/conversation/translate", json=too_many).status_code == 422


def test_the_languages_the_backend_can_read_aloud_are_listed(client, tts):
    tts.languages = ["it", "ar"]

    assert client.get("/api/tts/languages").json() == {"languages": ["it", "ar"]}


def test_reading_aloud_can_be_turned_off(client, tts, settings):
    settings.tts_enabled = False

    assert client.get("/api/tts/languages").json() == {"languages": []}
    response = client.post("/api/tts", json={"text": "Ciao", "language": "it"})
    assert response.status_code == 422
    assert response.json() == {"detail": "Sintesi vocale non disponibile"}
    assert tts.calls == []
