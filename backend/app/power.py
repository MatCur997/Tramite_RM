"""Keeps the backend at full speed when its window is minimized or behind the kiosk's browser.

Windows 11 runs the processes of windows that are minimized or out of sight in "efficiency mode"
(EcoQoS): on hybrid processors, such as the Intel Core i9-13950HX of the kiosk, only on the slower
efficient cores. Speech recognition then took 28-34 s instead of 5 s for a short question, so the
backend opts out of it when it starts.
"""

import ctypes
import logging
import sys

log = logging.getLogger("totem")

# SetProcessInformation(ProcessPowerThrottling, PROCESS_POWER_THROTTLING_STATE version 1): the
# execution speed in the control mask but not in the state mask means "never throttle".
_PROCESS_POWER_THROTTLING = 4
_EXECUTION_SPEED = 0x1


class _ThrottlingState(ctypes.Structure):
    _fields_ = [("Version", ctypes.c_ulong), ("ControlMask", ctypes.c_ulong), ("StateMask", ctypes.c_ulong)]


def disable_power_throttling() -> bool:
    """Opts this process out of EcoQoS; True if it did. There is nothing to do outside Windows."""
    if sys.platform != "win32":
        return False
    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel32.GetCurrentProcess.restype = ctypes.c_void_p
    kernel32.SetProcessInformation.argtypes = [ctypes.c_void_p, ctypes.c_int, ctypes.c_void_p, ctypes.c_ulong]
    state = _ThrottlingState(1, _EXECUTION_SPEED, 0)
    process = kernel32.GetCurrentProcess()
    if kernel32.SetProcessInformation(process, _PROCESS_POWER_THROTTLING, ctypes.byref(state), ctypes.sizeof(state)):
        return True
    log.warning("Windows power throttling not turned off (error %d): dictation may be slow", ctypes.get_last_error())
    return False
