"""In-memory conversation history per kiosk session, dropped after a period of inactivity."""

import time
from collections.abc import Callable
from dataclasses import dataclass, field


@dataclass
class Session:
    language: str
    history: list[dict[str, str]] = field(default_factory=list)
    last_seen: float = 0.0


class SessionStore:
    def __init__(self, ttl_seconds: float, max_turns: int, clock: Callable[[], float] = time.monotonic):
        self._ttl = ttl_seconds
        self._max_messages = 2 * max(1, max_turns)
        self._clock = clock
        self._sessions: dict[str, Session] = {}

    def get(self, session_id: str, language: str) -> Session:
        """Return the session, starting a new one if it expired or the language changed."""
        now = self._clock()
        self._sessions = {key: s for key, s in self._sessions.items() if now - s.last_seen < self._ttl}
        session = self._sessions.get(session_id)
        if session is None or session.language != language:
            session = self._sessions[session_id] = Session(language)
        session.last_seen = now
        return session

    def append(self, session: Session, question: str, answer: str) -> None:
        session.history += [{"role": "user", "content": question}, {"role": "assistant", "content": answer}]
        session.history = session.history[-self._max_messages :]
        session.last_seen = self._clock()
