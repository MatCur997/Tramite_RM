from app.privacy import anonymize


def test_identifiers_with_a_fixed_shape_are_masked():
    text = (
        "Sono RSSMRA85T10A562S, scrivo da mario.rossi@example.com, tel. +39 333 123 4567, "
        "CIE CA12345AB, nato il 10/12/1985, IBAN IT60 X054 2811 1010 0000 0123 456, pratica 784512."
    )
    assert anonymize(text) == (
        "Sono [codice fiscale], scrivo da [email], tel. [telefono], "
        "CIE [documento], nato il [data], IBAN [iban], pratica [numero]."
    )


def test_ordinary_questions_are_left_as_they_are():
    for text in ("Quanto costa la CIE? 22,21 euro nel 2026?", "Що таке autocertificazione?", "我需要带护照吗？"):
        assert anonymize(text) == text
