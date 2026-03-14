from __future__ import annotations

try:
    from .calibrate import create_target_spectrum, load_calibration_data
except ImportError:
    from calibrate import create_target_spectrum, load_calibration_data


__all__ = ["create_target_spectrum", "load_calibration_data"]
