import io

from PIL import Image

from app.printer import MARGIN, PAGE_HEIGHT, SHEET_WIDTH, START, WIDTH, raster

ROW = WIDTH // 8
# Where the sheet starts and ends under the print head, which is a little wider.
LEFT = (WIDTH - SHEET_WIDTH) // 2
RIGHT = LEFT + SHEET_WIDTH
GS_V_0 = b"\x1d\x76\x30\x00"


def png(image: Image.Image) -> bytes:
    out = io.BytesIO()
    image.save(out, "PNG")
    return out.getvalue()


def bitmap(job: bytes) -> tuple[int, bytes]:
    """The rows of a print job, joined from its raster bands."""
    assert job.startswith(START)
    data, rest, rows = bytearray(), job[len(START):], 0
    while rest.startswith(GS_V_0):
        assert int.from_bytes(rest[4:6], "little") == ROW
        n = int.from_bytes(rest[6:8], "little")
        data += rest[8 : 8 + n * ROW]
        rest, rows = rest[8 + n * ROW :], rows + n
    return rows, bytes(data)


def black(data: bytes, x: int, y: int) -> bool:
    return bool(data[y * ROW + x // 8] & (0x80 >> (x % 8)))


def test_an_a4_page_fills_the_sheet_within_the_margins():
    # Half the size of the area within the margins: scaled by exactly 2.
    width, height = (SHEET_WIDTH - 2 * MARGIN) // 2, (PAGE_HEIGHT - 2 * MARGIN) // 2
    page = Image.new("RGB", (width, height), "white")
    page.paste("black", (0, 0, 20, 20))
    page.paste("black", (width - 20, height - 20, width, height))

    rows, data = bitmap(raster(png(page)))

    assert rows == PAGE_HEIGHT  # a whole A4 sheet
    assert not any(data[: MARGIN * ROW])  # paper above the page
    assert black(data, LEFT + MARGIN + 5, MARGIN + 5)  # top-left corner, just inside the margin
    assert not black(data, LEFT + MARGIN - 1, MARGIN + 5)
    assert black(data, RIGHT - MARGIN - 5, rows - MARGIN - 5)  # bottom-right corner
    assert not black(data, RIGHT - MARGIN, rows - MARGIN - 5)
    assert not any(data[(rows - MARGIN + 1) * ROW :])  # paper below the page


def test_transparent_areas_print_as_paper():
    rows, data = bitmap(raster(png(Image.new("RGBA", (WIDTH, 100), (0, 0, 0, 0)))))

    assert rows > 0 and not any(data)
