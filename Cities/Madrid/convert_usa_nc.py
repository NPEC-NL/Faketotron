"""
Convert Albuquerque (NM, USA) spectral GHI netCDF data to the
average_day_by_month.csv format used by the NPEC Faketron Cities pipeline.

Source data
-----------
spectra.nc: global horizontal spectral irradiance measured in 2021.
  Variable 'ghi': (time, wavelength), W/m^2/nm
  Wavelengths:    350-1700 nm at 5 nm steps (271 values)
  Time:           2021-01-01 07:10 to 2021-12-15 17:00  (local MST, UTC-7)
  Location:       Albuquerque, New Mexico, USA (35 N, 106.5 W, 1660 m)

Output
------
US-ABQ_Albuquerque_average_day_by_month.csv in
D:\\Maarten\\Alan_Cities\\Per_City_Per_Month_Output

Columns match the Cities pipeline wide format:
  location_code, location_name, measurement_table, month, month_name,
  time_bin_minutes, time_of_day, measurement_setup, sun_included,
  patch, patch_almucantar, patch_azimuth, samples_averaged, <wavelength>...

Notes
-----
- Wavelengths are trimmed to 380-780 nm (5 nm grid) to match the other city files.
- Values are already in W/m^2/nm; no unit conversion is applied.
- Timestamps are treated as local MST time (UTC-7; New Mexico does not observe DST).
- Spectral irradiance values are multiplied by OUTPUT_SCALE_FACTOR before export.
- Only time bins with at least one positive measurement are written.
"""

from __future__ import annotations

import calendar
from pathlib import Path

import numpy as np
import pandas as pd
import xarray as xr


# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

LOCATION_CODE = "US-ABQ"
LOCATION_NAME = "Albuquerque"
MEASUREMENT_TABLE = "spectral_horizontal_irradiance"
MEASUREMENT_SETUP = "1"
SUN_INCLUDED = "TRUE"

# Output wavelength grid (nm) — trimmed from the full 350-1700 nm source
OUTPUT_WAVELENGTHS_NM: list[float] = np.arange(380, 785, 5, dtype=float).tolist()

# Uniform scaling applied to exported spectral irradiance values.
OUTPUT_SCALE_FACTOR = 1 

BIN_MINUTES = 5

INPUT_FILE = Path(r"C:\Users\maart\Downloads\USA\spectra.nc")
OUTPUT_DIR = Path(r"D:\Maarten\Alan_Cities\Per_City_Per_Month_Output")


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _format_wavelength(value: float) -> str:
    if float(value).is_integer():
        return str(int(value))
    return format(float(value), "g")


def _format_time_of_day(total_minutes: int) -> str:
    return f"{total_minutes // 60:02d}:{total_minutes % 60:02d}"


# ---------------------------------------------------------------------------
# Loading
# ---------------------------------------------------------------------------


def load_spectra(file_path: Path) -> pd.DataFrame:
    """
    Load spectra.nc and return a DataFrame (time x wavelength) in W/m^2/nm,
    restricted to OUTPUT_WAVELENGTHS_NM.  Nighttime rows (all-zero) are dropped.
    """
    print(f"Loading {file_path.name}...")
    with xr.open_dataset(file_path) as ds:
        ds.load()

        attrs = ds.attrs
        print(
            f"  {attrs.get('city')}, {attrs.get('state')}, {attrs.get('country')} "
            f"(tz: {attrs.get('timezone')})"
        )

        ghi = ds["ghi"]
        print(
            f"  Wavelengths: {float(ghi.wavelength.min()):.0f} - "
            f"{float(ghi.wavelength.max()):.0f} nm | "
            f"{len(ghi.time):,} time steps"
        )

        # Select only the output wavelength range
        output_wl = np.asarray(OUTPUT_WAVELENGTHS_NM, dtype=float)
        ghi_trimmed = ghi.sel(wavelength=output_wl)
        df = ghi_trimmed.to_pandas()   # index=time, columns=wavelength (float)

    # Ensure column names are plain Python floats
    df.columns = [float(c) for c in df.columns]
    df = df * OUTPUT_SCALE_FACTOR

    # Drop rows where the entire spectrum is zero or negative (nighttime)
    is_daytime = df.sum(axis=1) > 0
    df = df.loc[is_daytime].copy()
    print(f"  Kept {len(df):,} daytime rows.")
    return df


# ---------------------------------------------------------------------------
# Averaging
# ---------------------------------------------------------------------------


def compute_average_day(df: pd.DataFrame) -> pd.DataFrame:
    """
    Group by (month, 5-min bin) and return the mean spectrum with sample count.
    """
    idx = df.index
    df = df.copy()
    df["month"] = idx.month
    total_seconds = idx.hour * 3600 + idx.minute * 60 + idx.second
    df["time_bin_minutes"] = (
        (total_seconds // (BIN_MINUTES * 60)) * BIN_MINUTES
    ).astype(int)

    grouped = df.groupby(["month", "time_bin_minutes"])[OUTPUT_WAVELENGTHS_NM]
    avg = grouped.mean()
    count = grouped.count().iloc[:, 0].rename("samples_averaged")
    return avg.join(count).reset_index()


# ---------------------------------------------------------------------------
# Output formatting
# ---------------------------------------------------------------------------


def build_output_frame(avg_day: pd.DataFrame) -> pd.DataFrame:
    """Reformat into the Cities pipeline wide CSV layout."""
    wl_label = {wl: _format_wavelength(wl) for wl in OUTPUT_WAVELENGTHS_NM}

    rows: list[dict] = []
    for _, row in avg_day.iterrows():
        month = int(row["month"])
        time_bin = int(row["time_bin_minutes"])
        entry: dict = {
            "location_code": LOCATION_CODE,
            "location_name": LOCATION_NAME,
            "measurement_table": MEASUREMENT_TABLE,
            "month": month,
            "month_name": calendar.month_name[month],
            "time_bin_minutes": time_bin,
            "time_of_day": _format_time_of_day(time_bin),
            "measurement_setup": MEASUREMENT_SETUP,
            "sun_included": SUN_INCLUDED,
            "patch": "",
            "patch_almucantar": "",
            "patch_azimuth": "",
            "samples_averaged": int(row["samples_averaged"]),
        }
        for wl in OUTPUT_WAVELENGTHS_NM:
            entry[wl_label[wl]] = float(row[wl])
        rows.append(entry)

    return pd.DataFrame(rows)


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------


def main() -> None:
    if not INPUT_FILE.exists():
        raise FileNotFoundError(f"Input file not found: {INPUT_FILE}")

    df = load_spectra(INPUT_FILE)

    print("Computing average-day spectra by month...")
    avg_day = compute_average_day(df)

    print("Building output frame...")
    output_frame = build_output_frame(avg_day)

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    output_path = OUTPUT_DIR / f"{LOCATION_CODE}_{LOCATION_NAME}_average_day_by_month.csv"
    output_frame.to_csv(output_path, index=False)
    print(f"Wrote {len(output_frame):,} rows to {output_path}")


if __name__ == "__main__":
    main()
