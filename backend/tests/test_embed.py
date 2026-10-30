import asyncio

import httpx
import pytest

from app.embed import PdfError, allows_framing, fetch_pdf


def test_pages_that_forbid_frames_are_not_embeddable():
    assert allows_framing(httpx.Headers({"content-type": "text/html"}))
    assert not allows_framing(httpx.Headers({"x-frame-options": "SAMEORIGIN"}))
    assert not allows_framing(httpx.Headers({"content-security-policy": "default-src 'self'; frame-ancestors 'self'"}))
    assert allows_framing(httpx.Headers({"content-security-policy": "frame-ancestors *"}))
    assert allows_framing(httpx.Headers({"content-security-policy": "default-src 'self'"}))


def test_only_web_pdfs_are_downloaded():
    with pytest.raises(PdfError):
        asyncio.run(fetch_pdf("file:///etc/passwd"))
