"""Which pages the kiosk can show in an iframe, and the PDFs of other sites for its PDF viewer.

The kiosk opens every link inside its own page. Many sites forbid that with the
X-Frame-Options header or the frame-ancestors directive of Content-Security-Policy:
the browser would show an error, so the kiosk shows a QR code to open them on a phone.
"""

import logging
import time
from urllib.parse import urlsplit

import httpx

log = logging.getLogger("totem")

CACHE_SECONDS = 6 * 3600


def allows_framing(headers: httpx.Headers) -> bool:
    """False when the headers forbid showing the page in a frame of another site."""
    if headers.get("x-frame-options", "").strip():
        return False
    for policy in headers.get_list("content-security-policy"):
        for directive in policy.split(";"):
            name, _, sources = directive.strip().partition(" ")
            if name.lower() == "frame-ancestors" and "*" not in sources.split():
                return False
    return True


class EmbedChecker:
    def __init__(self, timeout: float = 6.0):
        self.timeout = timeout
        self.cache: dict[str, tuple[float, bool]] = {}

    async def embeddable(self, url: str) -> bool:
        if urlsplit(url).scheme not in ("http", "https"):
            return False
        cached = self.cache.get(url)
        if cached and time.monotonic() - cached[0] < CACHE_SECONDS:
            return cached[1]
        try:
            # GET, not HEAD: some sites (Google Maps) answer HEAD differently. Only the
            # headers of the last redirect matter, so the body is not read.
            async with httpx.AsyncClient(follow_redirects=True, timeout=self.timeout,
                                         headers={"User-Agent": "Mozilla/5.0 (Totem)"}) as client:
                async with client.stream("GET", url) as response:
                    result = response.status_code < 400 and allows_framing(response.headers)
        except httpx.HTTPError as exc:
            log.info("Embed check of %s failed: %s", url, exc)
            result = False
        self.cache[url] = (time.monotonic(), result)
        return result


MAX_PDF_BYTES = 30 * 1024 * 1024


class PdfError(Exception):
    pass


async def fetch_pdf(url: str, timeout: float = 20.0) -> bytes:
    """A PDF of another site, for the kiosk's own PDF viewer: the browser may not read it directly."""
    if urlsplit(url).scheme not in ("http", "https"):
        raise PdfError("Not a web address")
    try:
        async with httpx.AsyncClient(follow_redirects=True, timeout=timeout,
                                     headers={"User-Agent": "Mozilla/5.0 (Totem)"}) as client:
            async with client.stream("GET", url) as response:
                if response.status_code >= 400:
                    raise PdfError(f"HTTP {response.status_code}")
                data = bytearray()
                async for chunk in response.aiter_bytes():
                    data += chunk
                    if len(data) > MAX_PDF_BYTES:
                        raise PdfError("File too large")
    except httpx.HTTPError as exc:
        raise PdfError(str(exc)) from exc
    if not data.startswith(b"%PDF"):
        raise PdfError("Not a PDF")
    return bytes(data)
