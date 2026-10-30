import base64
import io
import json

import pytest
import serial
from fastapi.testclient import TestClient
from PIL import Image

from app import printer
from app.main import create_app


class FakeSerial:
    """Stand-in for the printer's serial port: records what it is sent, and can break at a write."""

    log: list[str] = []
    fail_at_write: int | None = None

    def __init__(self, port, baudrate, write_timeout):
        self.writes = 0

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def write(self, data):
        self.writes += 1
        if self.writes == FakeSerial.fail_at_write:
            raise serial.SerialException("Bluetooth non raggiungibile")
        FakeSerial.log.append(f"write {self.writes}")

    def flush(self):
        FakeSerial.log.append(f"flush {self.writes}")


@pytest.fixture
def fake_printer(monkeypatch):
    FakeSerial.log = []
    FakeSerial.fail_at_write = None
    monkeypatch.setattr(printer, "find_port", lambda address: "COM9")
    monkeypatch.setattr(printer.serial, "Serial", FakeSerial)
    return FakeSerial


@pytest.fixture
def client(settings, llm, index):
    with TestClient(create_app(settings, llm, index)) as client:
        yield client


def png() -> bytes:
    out = io.BytesIO()
    Image.new("RGB", (20, 30), "white").save(out, "PNG")
    return out.getvalue()


def data_url() -> str:
    return "data:image/png;base64," + base64.b64encode(png()).decode()


def print_stream(client: TestClient, pages: list[str]) -> list[dict]:
    response = client.post("/api/print/stream", json={"pages": pages})
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("application/x-ndjson")
    return [json.loads(line) for line in response.text.splitlines() if line]


def test_each_page_is_reported_once_it_has_gone_to_the_printer(fake_printer):
    reported = []

    printer.print_pages([png(), png()], "B7F5E10BBCFE", on_page=lambda page, total: reported.append((page, total)))

    assert reported == [(1, 2), (2, 2)]
    assert fake_printer.log == ["write 1", "flush 1", "write 2", "flush 2"]


def test_the_print_stream_follows_every_sheet(client, fake_printer):
    events = print_stream(client, [data_url()] * 3)

    assert events == [
        {"type": "prepared", "total": 3},
        {"type": "page", "page": 1, "total": 3},
        {"type": "page", "page": 2, "total": 3},
        {"type": "page", "page": 3, "total": 3},
        {"type": "done", "total": 3},
    ]


def test_a_print_that_stops_says_at_which_sheet(client, fake_printer):
    fake_printer.fail_at_write = 2

    events = print_stream(client, [data_url()] * 3)

    assert [e["type"] for e in events] == ["prepared", "page", "error"]
    assert events[-1]["page"] == 2
    assert "Stampante non raggiungibile" in events[-1]["message"]


def test_a_printer_that_is_off_stops_the_print_at_the_first_sheet(client, fake_printer, monkeypatch):
    def not_found(address):
        raise printer.PrinterError("Stampante B7F5E10BBCFE non trovata")

    monkeypatch.setattr(printer, "find_port", not_found)

    events = print_stream(client, [data_url()] * 2)

    assert events[-1] == {"type": "error", "message": "Stampante B7F5E10BBCFE non trovata", "page": 1}


def test_pages_that_are_not_images_are_refused_before_printing(client, fake_printer):
    response = client.post("/api/print/stream", json={"pages": ["data:image/png;base64,non è base64!"]})

    assert response.status_code == 422
    assert fake_printer.log == []
