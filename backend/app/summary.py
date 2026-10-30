"""What the citizen must bring or prepare for the counter, picked out of an answer of the chat.

The kiosk lists it next to the conversation and prints it on the sheet for the counter.
"""

import json
from typing import Any

from .config import Settings

# Enough for a procedure, few enough to read at a glance.
MAX_ITEMS = 6

BRING_SCHEMA = {
    "type": "object",
    "properties": {"bring": {"type": "array", "items": {"type": "string"}}},
    "required": ["bring"],
}

BRING_SYSTEM = """You read an answer that the virtual assistant of the registry office (Anagrafe) of Roma Capitale gave to a citizen, and list what the citizen must bring or prepare for the counter (sportello): documents, forms, photos, payments, copies.
- Take them only from the answer: never add anything that it does not say.
- At most 6 items, each a short phrase of a few words.
- Write every item in {language}, even when the answer quotes Italian names. If the answer gives the official Italian name of a document or form, add it in parentheses after the item: the citizen will need it at the counter.
- If the answer lists nothing to bring or prepare, return an empty list.
Reply with JSON: {{"bring": ["...", "..."]}}"""


async def things_to_bring(llm: Any, settings: Settings, language: str, answer: str) -> list[str]:
    """The things to bring or prepare that the answer mentions, in language (its English name).

    Raises whatever the LLM raises, and ValueError when its reply is not the expected JSON: the
    caller decides that the chat goes on without the list.
    """
    messages = [
        {"role": "system", "content": BRING_SYSTEM.format(language=language)},
        {"role": "user", "content": f"ANSWER:\n{answer}"},
    ]
    options = {"num_ctx": settings.llm_num_ctx, "temperature": 0}
    raw = await llm.chat(settings.llm_model, messages, options=options, think=settings.llm_think, format=BRING_SCHEMA)
    items = json.loads(raw).get("bring")
    if not isinstance(items, list):
        raise ValueError(f"Not a list of things to bring: {raw[:200]!r}")
    bring: list[str] = []
    for item in items:
        text = " ".join(str(item).split())
        if text and text.casefold() not in (b.casefold() for b in bring):
            bring.append(text)
    return bring[:MAX_ITEMS]
