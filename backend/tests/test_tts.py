import asyncio
import io
import wave

import numpy as np

from app.config import Settings
from app.tts import SherpaTTS, spoken_text


def test_spoken_text_drops_citations_dashes_and_stars_and_pauses_between_list_items():
    text = "Porta i documenti [1][3].\n- passaporto [2]\n- **foto**"
    assert spoken_text(text) == "Porta i documenti. passaporto. foto."
    assert spoken_text("需要带护照【1】。") == "需要带护照。"
    assert spoken_text("[1][4]") == ""


class FakeAudio:
    def __init__(self, text):
        self.samples = np.full(len(text) * 10, 0.5, dtype=np.float32)
        self.sample_rate = 16000


class FakeVoice:
    def __init__(self, name):
        self.name = name
        self.calls = []

    def generate(self, text, sid, speed):
        self.calls.append((text, speed))
        return FakeAudio(text)


def test_each_language_has_its_voice_and_a_missing_voice_does_not_stop_the_others(monkeypatch):
    settings = Settings(tts_voices={"it": "voice-it", "bn": "voice-bn", "tl": "missing"}, tts_speed=0.9, _env_file=None)
    tts = SherpaTTS(settings)
    voices = {}

    def create(name):
        if name == "missing":
            raise FileNotFoundError(name)
        return voices.setdefault(name, FakeVoice(name))

    monkeypatch.setattr(tts, "_create_voice", create)

    async def run():
        return await tts.synthesize("Ciao.", "it"), await tts.synthesize("Hello.", "bn")

    italian, _ = asyncio.run(run())
    assert voices["voice-it"].calls == [("Ciao.", 0.9)]
    assert voices["voice-bn"].calls == [("Hello.", 0.9)]
    assert not tts.loaded
    with wave.open(io.BytesIO(italian)) as file:
        assert (file.getframerate(), file.getnchannels(), file.getnframes()) == (16000, 1, 50)


def fake_tts(monkeypatch, voices_by_name, clock=lambda: 0.0, **settings):
    tts = SherpaTTS(Settings(_env_file=None, **settings), clock=clock)

    def create(name):
        if name == "missing":
            raise FileNotFoundError(name)
        return voices_by_name.setdefault(name, FakeVoice(name))

    monkeypatch.setattr(tts, "_create_voice", create)
    return tts


def test_the_languages_are_those_whose_voice_could_be_loaded(monkeypatch):
    tts = fake_tts(monkeypatch, {}, tts_voices={"it": "voice-it", "uk": "missing", "bn": "voice-bn"})

    asyncio.run(tts.load())

    assert tts.languages == ["it", "bn"]


def test_a_sentence_read_again_comes_from_the_cache_until_it_is_forgotten(monkeypatch):
    voices = {}
    clock = [1000.0]
    tts = fake_tts(monkeypatch, voices, clock=lambda: clock[0], tts_voices={"it": "voice-it"}, session_ttl_minutes=10)

    first = asyncio.run(tts.synthesize("Ciao.", "it"))
    clock[0] += 9 * 60
    again = asyncio.run(tts.synthesize("Ciao.", "it"))
    assert again == first
    assert len(voices["voice-it"].calls) == 1

    clock[0] += 11 * 60  # not read for longer than a conversation lasts
    asyncio.run(tts.synthesize("Ciao.", "it"))
    assert len(voices["voice-it"].calls) == 2


def test_the_cache_keeps_only_the_most_recent_sentences(monkeypatch):
    voices = {}
    tts = fake_tts(monkeypatch, voices, tts_voices={"it": "voice-it"})
    monkeypatch.setattr("app.tts.CACHE_SIZE", 2)

    async def read(*texts):
        for text in texts:
            await tts.synthesize(text, "it")

    asyncio.run(read("Uno.", "Due.", "Tre.", "Tre.", "Due.", "Uno."))

    assert [text for text, _ in voices["voice-it"].calls] == ["Uno.", "Due.", "Tre.", "Uno."]
