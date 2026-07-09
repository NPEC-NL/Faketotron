"""
Convert Madrid EKO MS-700 spectral GTI Excel files to the average_day_by_month.csv
format used by the NPEC Faketron Cities pipeline.

Source data
-----------
Two Excel files recorded over 2016 and 2017 with an EKO MS-700 spectroradiometer.
Each row contains:
  Col 0  : Date          (yyyy/mm/dd string)
  Col 1  : Time          (HH:MM:SS string, local Madrid time / Europe/Madrid)
  Col 2-6: Polynomial coefficients c0-c4 that map sample index n=0..254 to wavelength
             lambda_n = c0 + c1*n + c2*n^2 + c3*n^3 + c4*n^4  (nm)
  Col 7+ : Spectral irradiance samples Glambda_0 - Glambda_254  (mW m^-2 nm^-1)

NOTE on units: despite the README saying "W/m^2/nm", the actual values are in
mW/m^2/nm. Integrating a clear-sky noon spectrum gives ~1175 W/m^2 total solar
irradiance, consistent with mW/m^2/nm -> W/m^2/nm conversion (divide by 1000).

Output
------
Three CSV files in D:\\Maarten\\Alan_Cities\\Per_City_Per_Month_Output:
  ES-MAD_Madrid_2016_average_day_by_month.csv   (2016 only)
  ES-MAD_Madrid_2017_average_day_by_month.csv   (2017 only)
  ES-MAD_Madrid_average_day_by_month.csv        (both years combined)

Columns match the Cities pipeline wide format:
  location_code, location_name, measurement_table, month, month_name,
  time_bin_minutes, time_of_day, measurement_setup, sun_included,
  patch, patch_almucantar, patch_azimuth, samples_averaged, <wavelength>...

Notes
-----
- The source measurement is global tilted irradiance (GTI), not horizontal, but is
  stored under measurement_table = "spectral_horizontal_irradiance" so that it works
  with the default calibrate.py settings.
- Timestamps are local civil time; no timezone conversion is applied.
- Spectra are interpolated to a 5 nm grid from 380 to 780 nm.
- Spectral irradiance values are multiplied by OUTPUT_SCALE_FACTOR before export.
- Only time bins with at least one positive measurement are written.
"""

from __future__ import annotations

import calendar
from pathlib import Path

import numpy as np
import pandas as pd
from scipy.interpolate import interp1d


# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

LOCATION_CODE = "ES-MAD"
LOCATION_NAME = "Madrid"
MEASUREMENT_TABLE = "spectral_horizontal_irradiance"
MEASUREMENT_SETUP = "1"
SUN_INCLUDED = "TRUE"

# Raw Excel values are in mW/m^2/nm; the pipeline expects W/m^2/nm.
MW_TO_W = 1 / 1000.0

# Uniform scaling applied to exported spectral irradiance values.
OUTPUT_SCALE_FACTOR = 1 

# Output wavelength grid (nm)
OUTPUT_WAVELENGTHS_NM: list[float] = np.arange(380, 785, 5, dtype=float).tolist()

BIN_MINUTES = 5

INPUT_FILES = {
    2016: Path(r"C:\Users\maart\Downloads\Data(1)\Spectral GTI Madrid 2016.xlsx"),
    2017: Path(r"C:\Users\maart\Downloads\Data(1)\Spectral GTI Madrid 2017.xlsx"),
}
OUTPUT_DIR = Path(r"D:\Maarten\Alan_Cities\Per_City_Per_Month_Output")


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _compute_wavelengths(
    c0: float, c1: float, c2: float, c3: float, c4: float, *, n_samples: int
) -> np.ndarray:
    n = np.arange(n_samples, dtype=float)
    return c0 + c1 * n + c2 * n**2 + c3 * n**3 + c4 * n**4


def _format_wavelength(value: float) -> str:
    if float(value).is_integer():
        return str(int(value))
    return format(float(value), "g")


def _format_time_of_day(total_minutes: int) -> str:
    return f"{total_minutes // 60:02d}:{total_minutes % 60:02d}"


def _coerce_datetime(date_col: pd.Series, time_col: pd.Series) -> pd.Series:
    """Robustly combine date and time columns into a naive datetime series.

    Handles date formats:
      - yyyy/mm/dd  (Madrid files: '2016/01/01')
      - dd/mm/yyyy
      - datetime/date objects (when Excel parsed them automatically)
    Handles time formats:
      - 'HH:MM:SS' strings
      - datetime.time objects
      - timedelta objects (Excel internal representation)
    """

    def _date_str(val) -> str:
        if pd.isna(val):
            return ""
        if hasattr(val, "strftime"):
            return val.strftime("%Y-%m-%d")
        s = str(val).strip()
        parts = s.split("/")
        if len(parts) == 3:
            if len(parts[0]) == 4:    # yyyy/mm/dd
                return f"{parts[0]}-{parts[1]}-{parts[2]}"
            if len(parts[2]) == 4:    # dd/mm/yyyy
                return f"{parts[2]}-{parts[1]}-{parts[0]}"
        return s

    def _time_str(val) -> str:
        if pd.isna(val):
            return "00:00:00"
        if hasattr(val, "hour"):              # datetime.time or datetime
            h, m, s = val.hour, val.minute, getattr(val, "second", 0)
            return f"{h:02d}:{m:02d}:{s:02d}"
        if hasattr(val, "total_seconds"):     # timedelta (Excel internal)
            secs = int(val.total_seconds())
            h, r = divmod(secs, 3600)
            m, s = divmod(r, 60)
            return f"{h:02d}:{m:02d}:{s:02d}"
        return str(val).strip()

    combined = date_col.map(_date_str) + " " + time_col.map(_time_str)
    return pd.to_datetime(combined, errors="coerce")


# ---------------------------------------------------------------------------
# Loading
# ---------------------------------------------------------------------------


def load_file(file_path: Path) -> pd.DataFrame:
    """
    Load one Madrid GTI Excel file.

    Returns a DataFrame with columns:
      'datetime'                       - naive local-time datetime
      380.0, 385.0, ... 780.0          - spectral irradiance in W/m^2/nm

    Conversion: raw mW/m^2/nm values are divided by 1000 to give W/m^2/nm.
    Nighttime rows (all-zero spectra after conversion) are dropped.
    """
    print(f"  Loading {file_path.name}...")
    raw = pd.read_excel(file_path, header=0)
    print(f"    {len(raw):,} rows, {len(raw.columns)} columns")

    if len(raw.columns) < 8:
        raise ValueError(
            f"{file_path.name}: too few columns ({len(raw.columns)})"
        )

    date_col = raw.columns[0]
    time_col = raw.columns[1]
    coeff_cols = raw.columns[2:7]    # c0 ... c4
    spectral_cols = raw.columns[7:]  # Glambda_0 ... Glambda_N

    datetimes = _coerce_datetime(raw[date_col], raw[time_col])
    spectral_values = raw[spectral_cols].to_numpy(dtype=float)
    n_samples = spectral_values.shape[1]
    coefficients = raw[coeff_cols].to_numpy(dtype=float)  # shape (N, 5)

    # Group rows by unique coefficient tuple for efficient batch interpolation
    coeff_groups: dict[tuple, list[int]] = {}
    for idx, row_c in enumerate(coefficients):
        key = tuple(row_c.round(12))
        coeff_groups.setdefault(key, []).append(idx)

    print(f"    {n_samples} spectral samples/row, {len(coeff_groups)} calibration set(s).")

    output_wl = np.asarray(OUTPUT_WAVELENGTHS_NM, dtype=float)
    output = np.zeros((len(raw), len(output_wl)), dtype=float)

    for coeff_key, indices in coeff_groups.items():
        source_wavelengths = _compute_wavelengths(*coeff_key, n_samples=n_samples)
        idx_arr = np.asarray(indices)
        # Convert mW/m^2/nm -> W/m^2/nm, clip negative instrument noise,
        # then apply the global export scaling factor.
        batch = (
            np.clip(spectral_values[idx_arr], 0.0, None)
            * MW_TO_W
            * OUTPUT_SCALE_FACTOR
        )
        interp_fn = interp1d(
            source_wavelengths,
            batch,
            axis=1,
            kind="linear",
            bounds_error=False,
            fill_value=0.0,
        )
        output[idx_arr] = interp_fn(output_wl)

    result = pd.DataFrame(output, columns=OUTPUT_WAVELENGTHS_NM)
    result.insert(0, "datetime", datetimes)

    result = result.dropna(subset=["datetime"])
    is_daytime = result[OUTPUT_WAVELENGTHS_NM].sum(axis=1) > 0
    result = result.loc[is_daytime].reset_index(drop=True)
    print(f"    Kept {len(result):,} daytime rows.")
    return result


# ---------------------------------------------------------------------------
# Averaging
# ---------------------------------------------------------------------------


def compute_average_day(frames: list[pd.DataFrame]) -> pd.DataFrame:
    """
    Concatenate all loaded frames, group by (month, 5-min bin), and return
    a DataFrame with the mean spectrum and the sample count per group.
    """
    combined = pd.concat(frames, ignore_index=True)
    combined["month"] = combined["datetime"].dt.month
    total_seconds = (
        combined["datetime"].dt.hour * 3600
        + combined["datetime"].dt.minute * 60
        + combined["datetime"].dt.second
    )
    combined["time_bin_minutes"] = (
        (total_seconds // (BIN_MINUTES * 60)) * BIN_MINUTES
    ).astype(int)

    grouped = combined.groupby(["month", "time_bin_minutes"])[OUTPUT_WAVELENGTHS_NM]
    avg = grouped.mean()
    count = grouped.count().iloc[:, 0].rename("samples_averaged")
    return avg.join(count).reset_index()


# ---------------------------------------------------------------------------
# Output formatting
# ---------------------------------------------------------------------------


def build_output_frame(avg_day: pd.DataFrame) -> pd.DataFrame:
    """Reformat the averaged data into the Cities pipeline wide CSV layout."""
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


def write_csv(output_frame: pd.DataFrame, output_path: Path) -> None:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_frame.to_csv(output_path, index=False)
    print(f"Wrote {len(output_frame):,} rows to {output_path}")


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------


def main() -> None:
    frames: dict[int, pd.DataFrame] = {}
    for year, file_path in INPUT_FILES.items():
        if not file_path.exists():
            raise FileNotFoundError(f"Input file not found: {file_path}")
        frames[year] = load_file(file_path)

    print("Computing average-day spectra by month...")

    for year, frame in frames.items():
        avg_day = compute_average_day([frame])
        output_frame = build_output_frame(avg_day)
        write_csv(
            output_frame,
            OUTPUT_DIR / f"{LOCATION_CODE}_{LOCATION_NAME}_{year}_average_day_by_month.csv",
        )

    avg_day_combined = compute_average_day(list(frames.values()))
    output_frame_combined = build_output_frame(avg_day_combined)
    write_csv(
        output_frame_combined,
        OUTPUT_DIR / f"{LOCATION_CODE}_{LOCATION_NAME}_average_day_by_month.csv",
    )


if __name__ == "__main__":
    main()
