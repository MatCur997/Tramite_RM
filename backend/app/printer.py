"""Prints the pages of a PDF on the kiosk's printer, a Phomemo A282M (A4 thermal).

Its Windows driver works only over USB, so over Bluetooth the pages are sent as raster images,
with the ESC/POS commands that the printer understands, to the serial port Windows creates for
it. The port is found by the printer's Bluetooth address, because its COM number can change.
"""

import io
import threading
from collections.abc import Callable

import serial
from PIL import Image, ImageOps
from serial.tools import list_ports

# Over Bluetooth the printer prints at 203 dpi (8 dots per mm), whatever its data sheet says: a
# test ruler 2400 dots wide came out cropped to about 1700 dots, centred.
# The print head: 1728 dots, 216 mm, a little wider than the sheet. Every row is this wide.
WIDTH = 1728
# An A4 sheet, 210 x 297 mm.
SHEET_WIDTH = 1680
PAGE_HEIGHT = 2450
# 0.5 cm of paper around the page: what is closer to the edge of the sheet does not print.
MARGIN = 40
# Darker than this (0-255) prints black: the forms are text and lines, sharper without dithering.
THRESHOLD = 170
# Rows per raster command, small enough for the printer's buffer.
BAND = 256

# ESC @ (reset), ESC a 1 (centre), then the Phomemo command that must precede the images.
START = b"\x1b\x40\x1b\x61\x01\x1f\x11\x02\x04"


class PrinterError(Exception):
    pass


_lock = threading.Lock()


def find_port(address: str) -> str:
    """The COM port of the printer with this Bluetooth address (12 hex digits, no separators)."""
    address = address.replace(":", "").replace("-", "").upper()
    for port in list_ports.comports():
        if address in (port.hwid or "").upper():
            return port.device
    raise PrinterError(f"Stampante {address} non trovata: è accesa e associata in Bluetooth?")


def raster(png: bytes) -> bytes:
    """One page as printer commands: scaled to fit an A4 sheet within the margins, black and white."""
    image = Image.open(io.BytesIO(png))
    # Transparent areas are paper, not black.
    if image.mode in ("RGBA", "LA", "P"):
        background = Image.new("RGB", image.size, "white")
        background.paste(image.convert("RGBA"), mask=image.convert("RGBA").getchannel("A"))
        image = background
    image = ImageOps.grayscale(image)
    box = (SHEET_WIDTH - 2 * MARGIN, PAGE_HEIGHT - 2 * MARGIN)
    scale = min(box[0] / image.width, box[1] / image.height)
    image = image.resize((round(image.width * scale), round(image.height * scale)), Image.Resampling.LANCZOS)
    # Always a whole A4 sheet, 29.7 cm long, with the page at the top within the margins.
    page = Image.new("L", (WIDTH, PAGE_HEIGHT), 255)
    page.paste(image, ((WIDTH - image.width) // 2, MARGIN))
    image, height = page, page.height
    # In mode "1" with these values 1 is a black dot, the order ESC/POS expects.
    bits = image.point(lambda v: 255 if v < THRESHOLD else 0, mode="1")
    data = bits.tobytes()
    row = WIDTH // 8
    out = bytearray(START)
    for top in range(0, height, BAND):
        rows = min(BAND, height - top)
        # GS v 0: a raster image row bytes wide and rows high.
        out += b"\x1d\x76\x30\x00" + row.to_bytes(2, "little") + rows.to_bytes(2, "little")
        out += data[top * row : (top + rows) * row]
    return bytes(out)


def print_pages(
    pages: list[bytes], address: str, baudrate: int = 115200, on_page: Callable[[int, int], None] | None = None
) -> None:
    """Prints the pages (PNG images) one per sheet. One job at a time.

    All the pages are turned into printer commands first; then each one is sent, and on_page(n, total)
    is called, from this thread, once page n has gone to the printer: the kiosk shows the progress.
    """
    jobs = [raster(page) for page in pages]
    with _lock:
        port = find_port(address)
        try:
            with serial.Serial(port, baudrate, write_timeout=60) as conn:
                for number, job in enumerate(jobs, start=1):
                    conn.write(job)
                    conn.flush()
                    if on_page:
                        on_page(number, len(jobs))
        except serial.SerialException as exc:
            raise PrinterError(f"Stampante non raggiungibile su {port}: {exc}") from exc
