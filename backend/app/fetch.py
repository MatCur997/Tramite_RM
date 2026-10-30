"""Download the documents listed in data/sources.json into data/docs.

    uv run python -m app.fetch            # only the files not downloaded yet
    uv run python -m app.fetch --force    # download everything again

Web pages are saved as Markdown with only their main text (no menus or footers),
so that they can be read and corrected by hand; PDFs are saved as they are.
"""

import argparse
import logging
import time

import httpx

from .config import Settings
from .ingest import html_to_markdown, load_manifest

log = logging.getLogger("totem.fetch")

HEADERS = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) TotemAnagrafe/0.1"}


def fetch(settings: Settings, force: bool = False) -> None:
    settings.docs_dir.mkdir(parents=True, exist_ok=True)
    with httpx.Client(headers=HEADERS, follow_redirects=True, timeout=60) as client:
        for document in load_manifest(settings.manifest_path):
            if not document.url or not document.file:
                continue
            path = settings.docs_dir / document.file
            if path.exists() and not force:
                continue
            response = client.get(document.url)
            response.raise_for_status()
            if path.suffix.lower() == ".md":
                text = html_to_markdown(response.text)
                if not text:
                    log.warning("%-40s no text found at %s", document.id, document.url)
                    continue
                path.write_text(text + "\n", encoding="utf-8")
            else:
                path.write_bytes(response.content)
            log.info("%-40s %s", document.id, path.name)
            time.sleep(0.5)  # be gentle with the public sites


def main() -> None:
    parser = argparse.ArgumentParser(description="Download the documents listed in sources.json.")
    parser.add_argument("--force", action="store_true", help="download again the files already present")
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    logging.getLogger("httpx").setLevel(logging.WARNING)
    fetch(Settings(), args.force)


if __name__ == "__main__":
    main()
