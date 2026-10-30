"""Runtime settings, read from TOTEM_* environment variables or from backend/.env."""

from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parent.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="TOTEM_", env_file=BACKEND_DIR / ".env", extra="ignore")

    # Ollama. 127.0.0.1 rather than localhost: on Windows localhost tries IPv6 first.
    ollama_url: str = "http://127.0.0.1:11434"
    llm_model: str = "qwen3.5:4b"
    embed_model: str = "bge-m3"
    # Every call uses the same context size: Ollama reloads the model when it changes.
    llm_num_ctx: int = 8192
    llm_temperature: float = 0.2
    # Thinking only slows the kiosk down; the flag is dropped for models that reject it.
    llm_think: bool = False
    embed_on_cpu: bool = False
    # How long Ollama keeps the models in memory after the last call. The warm-up happens only at
    # startup: with 30 minutes, a backend started early would reload the LLM (5-10 s) at the first question.
    keep_alive: str = "24h"

    # Retrieval
    data_dir: Path = BACKEND_DIR / "data"
    top_k: int = 5
    # Below this cosine similarity of the best passage the question is treated as not covered
    # by the documents. On the corpus of October 2026 questions about the registry office scored
    # 0.51-0.81 and unrelated ones (weather, recipes, parking, greetings) 0.31-0.41.
    min_score: float = 0.45

    # After an answer that cites documents, a short second call lists what to bring to the counter
    # (the "summary" event): about a second more before the answer is complete.
    summary_enabled: bool = True

    # Conversation memory
    history_turns: int = 4
    session_ttl_minutes: float = 10

    # Speech recognition (dictation key), with faster-whisper on this computer. large-v3-turbo
    # recognises all the kiosk languages well; on the CPU with int8 it leaves the VRAM to the LLM
    # and transcribes a short question in a few seconds. "small" is faster and less accurate.
    stt_model: str = "large-v3-turbo"
    stt_device: str = "cpu"
    stt_compute_type: str = "int8"
    # Load the speech model at startup, so the first dictation does not wait for it.
    stt_preload: bool = True

    # Speech synthesis (the key that reads an answer aloud), with sherpa-onnx on the CPU: one offline
    # voice per language, downloaded into tts_dir by `python -m app.voices`. Windows and Chrome have
    # no voice for Ukrainian, Bengali, Filipino and Arabic. "vits-piper-..." are Piper voices,
    # "mms-..." Meta MMS ones (CC-BY-NC): Piper has no Tagalog voice and its Bengali one is not
    # packaged for sherpa-onnx.
    tts_enabled: bool = True
    tts_dir: Path = BACKEND_DIR / "models" / "tts"
    tts_voices: dict[str, str] = {
        "it": "vits-piper-it_IT-paola-medium",
        # uk_UA-ukrainian_tts, the better voice, skips most phonemes in sherpa-onnx.
        "uk": "vits-piper-uk_UA-lada-x_low",
        "zh": "vits-piper-zh_CN-huayan-medium",
        "bn": "mms-ben",
        "tl": "mms-tgl",
        "ar": "vits-piper-ar_JO-kareem-medium",
    }
    tts_speed: float = 0.9  # a little slower than natural: easier for non-native listeners
    tts_threads: int = 4
    # Load the voices at startup, so the first reading does not wait for them.
    tts_preload: bool = True

    # The kiosk's printer, a Phomemo A282M, by its Bluetooth address: it prints only on this one.
    printer_address: str = "B7F5E10BBCFE"

    cors_origins: list[str] = ["http://localhost:4200", "http://127.0.0.1:4200"]

    @property
    def docs_dir(self) -> Path:
        return self.data_dir / "docs"

    @property
    def index_dir(self) -> Path:
        return self.data_dir / "index"

    @property
    def manifest_path(self) -> Path:
        return self.data_dir / "sources.json"
