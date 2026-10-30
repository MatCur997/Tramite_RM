import sys

from app.power import disable_power_throttling


def test_the_backend_opts_out_of_windows_power_throttling():
    assert disable_power_throttling() is (sys.platform == "win32")
