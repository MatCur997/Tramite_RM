"""Download the speech synthesis voices listed in the settings (tts_voices) into tts_dir.

    uv run python -m app.voices            # only the voices not downloaded yet
    uv run python -m app.voices --force    # download everything again

Piper voices come from the sherpa-onnx releases (with the espeak-ng data they need), Meta MMS
voices from a Hugging Face conversion to ONNX.
"""

import argparse
import logging
import shutil
import tarfile
import tempfile
from pathlib import Path

import httpx

from .config import Settings

log = logging.getLogger("totem.voices")

PIPER_RELEASE = "https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models"
MMS_REPOSITORY = "https://huggingface.co/willwade/mms-tts-multilingual-models-onnx/resolve/main"


def download(client: httpx.Client, url: str, path: Path) -> None:
    with client.stream("GET", url) as response:
        response.raise_for_status()
        with path.open("wb") as file:
            for chunk in response.iter_bytes():
                file.write(chunk)


def fetch_voice(client: httpx.Client, name: str, directory: Path) -> None:
    target = directory / name
    with tempfile.TemporaryDirectory(dir=directory) as temporary:
        staging = Path(temporary)
        if name.startswith("vits-piper-"):
            archive = staging / f"{name}.tar.bz2"
            download(client, f"{PIPER_RELEASE}/{name}.tar.bz2", archive)
            with tarfile.open(archive) as tar:
                tar.extractall(staging, filter="data")
            ready = staging / name
        elif name.startswith("mms-"):
            ready = staging / name
            ready.mkdir()
            for file in ("model.onnx", "tokens.txt"):
                download(client, f"{MMS_REPOSITORY}/{name.removeprefix('mms-')}/{file}", ready / file)
        else:
            raise ValueError(f"Unknown kind of voice: {name} (expected vits-piper-... or mms-...)")
        # Moved into place only when complete, so that a failed download never looks installed.
        shutil.rmtree(target, ignore_errors=True)
        ready.rename(target)


def main() -> None:
    parser = argparse.ArgumentParser(description="Download the speech synthesis voices.")
    parser.add_argument("--force", action="store_true", help="download again the voices already present")
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    logging.getLogger("httpx").setLevel(logging.WARNING)
    settings = Settings()
    settings.tts_dir.mkdir(parents=True, exist_ok=True)
    with httpx.Client(follow_redirects=True, timeout=120) as client:
        for language, name in settings.tts_voices.items():
            if (settings.tts_dir / name).exists() and not args.force:
                log.info("%s %-40s already present", language, name)
                continue
            fetch_voice(client, name, settings.tts_dir)
            log.info("%s %-40s downloaded", language, name)


if __name__ == "__main__":
    main()
