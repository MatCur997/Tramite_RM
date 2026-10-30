"""Languages offered by the kiosk, with the names used to instruct the LLM."""

DEFAULT_LANGUAGE = "it"

# English name plus native name: models follow the instruction more reliably.
LANGUAGES: dict[str, str] = {
    "it": "Italian (italiano)",
    "uk": "Ukrainian (українська)",
    "zh": "Simplified Chinese (简体中文)",
    "bn": "Bengali (বাংলা)",
    "tl": "Filipino (Tagalog)",
    "ar": "Arabic (العربية)",
}


def resolve_language(code: str | None) -> str:
    """Return a supported language code, falling back to Italian."""
    return code if code in LANGUAGES else DEFAULT_LANGUAGE
