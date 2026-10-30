"""Italian translation of a kiosk conversation, for the printed summary that the citizen brings
to the counter: the citizen's words on one side, the Italian on the other."""

import json
import logging
from typing import Any

from .config import Settings
from .languages import DEFAULT_LANGUAGE, LANGUAGES, resolve_language
from .ollama import OllamaError

log = logging.getLogger("totem.translate")

TRANSLATION_SCHEMA = {
    "type": "object",
    "properties": {"translation": {"type": "string"}},
    "required": ["translation"],
}

TRANSLATION_SYSTEM = """You translate messages of a conversation between a citizen and the virtual assistant of the registry office (Anagrafe) of Roma Capitale into Italian. The translation is printed next to the original and shown to the clerk at the counter.
- Translate faithfully and completely: do not summarise, explain, answer or add anything.
- Keep the meaning, the lists ("- ") and the line breaks of the original.
- Keep official Italian names as they are (carta d'identità elettronica, codice fiscale, permesso di soggiorno, AIRE, ANPR, SPID...), without the translations in parentheses that the original may add.
- Keep the source numbers in square brackets, such as [1], where they are.
- If the message is already in Italian, return it unchanged.
Reply with JSON: {"translation": "..."}"""


async def translate_to_italian(llm: Any, settings: Settings, language: str | None, texts: list[str]) -> list[str]:
    """The texts in Italian, in the same order. Texts of an Italian conversation are returned as they are."""
    code = resolve_language(language)
    if code == DEFAULT_LANGUAGE:
        return list(texts)
    options = {"num_ctx": settings.llm_num_ctx, "temperature": 0}
    out: list[str] = []
    for text in texts:
        if not text.strip():
            out.append(text)
            continue
        messages = [
            {"role": "system", "content": TRANSLATION_SYSTEM},
            {"role": "user", "content": f"Message in {LANGUAGES[code]}:\n{text}"},
        ]
        try:
            raw = await llm.chat(settings.llm_model, messages, options=options, think=settings.llm_think, format=TRANSLATION_SCHEMA)
            translation = str(json.loads(raw).get("translation", "")).strip()
        except (ValueError, AttributeError) as exc:
            log.warning("Translation not in the expected format: %s", exc)
            translation = ""
        if not translation:
            raise OllamaError("Traduzione non disponibile")
        out.append(translation)
    return out
