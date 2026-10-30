"""Masking of personal data in the citizens' questions before they are logged.

Regular expressions catch the identifiers that have a fixed shape: e-mail addresses, codice fiscale,
IBAN, identity document numbers, phone numbers, dates and other long numbers. They cannot recognise
names or addresses, so the logged questions are pseudonymised, not fully anonymous.
"""

import re

# Codice fiscale, also with the letters that replace digits when two people would share one.
_D = "[0-9LMNPQRSTUV]"
_MASKS = [
    (re.compile(r"[\w.+-]+@[\w-]+(?:\.[\w-]+)+"), "[email]"),
    (re.compile(rf"\b[A-Z]{{6}}{_D}{{2}}[A-Z]{_D}{{2}}[A-Z]{_D}{{3}}[A-Z]\b", re.IGNORECASE), "[codice fiscale]"),
    (re.compile(r"\b[A-Z]{2}\d{2}(?:\s?[A-Z0-9]{4}){3,7}(?:\s?[A-Z0-9]{1,4})?\b", re.IGNORECASE), "[iban]"),
    # CIE (CA12345AB), passports and residence permits: letters and at least five digits.
    (re.compile(r"\b[A-Z]{1,2}\d{5,9}[A-Z]{0,2}\b", re.IGNORECASE), "[documento]"),
    (re.compile(r"\b\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}\b"), "[data]"),
    (re.compile(r"(?:\+\d{1,3}[\s.-]?)?(?:\d[\s.-]?){8,13}\d\b"), "[telefono]"),
    (re.compile(r"\d{5,}"), "[numero]"),
]


def anonymize(text: str) -> str:
    """The text with e-mails, codici fiscali, IBANs, document numbers, dates and phone numbers masked."""
    for pattern, mask in _MASKS:
        text = pattern.sub(mask, text)
    return text
