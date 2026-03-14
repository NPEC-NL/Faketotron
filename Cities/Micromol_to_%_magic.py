from __future__ import annotations

try:
    from .calibrate import load_calibration_data
except ImportError:
    from calibrate import load_calibration_data


def main() -> int:
    for room in ("G4", "G5", "G6", "G7", "G8"):
        calibration_data = load_calibration_data(room)
        print(f"[{room}]")
        for channel_name, frame in calibration_data.items():
            par_mask = frame["wavelength"].between(400, 700)
            total_par = frame.loc[par_mask, "100%"].sum()
            print(f"  {channel_name}: total 100% PAR = {total_par:.2f}")
        print()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
