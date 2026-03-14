from __future__ import annotations

import argparse
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Sequence

import numpy as np
import pandas as pd
from scipy.optimize import least_squares, lsq_linear


LEVEL_COUNT = 20
LEVEL_STEP_PERCENT = 5
DEFAULT_CALIBRATION_DIR = Path(__file__).resolve().parents[1] / "Jeti_Spectrometer"
DEFAULT_CITY_OUTPUT_DIR = Path(
    os.environ.get(
        "ALAN_CITIES_AVERAGE_DAY_DIR",
        r"D:\Maarten\Alan_Cities\Per_City_Per_Month_Output",
    )
)
PHOTON_CONVERSION_FACTOR = 0.008359
DEFAULT_MEASUREMENT_TABLE = "spectral_horizontal_irradiance"


@dataclass(frozen=True)
class ChannelSpec:
    key: str
    label: str


@dataclass(frozen=True)
class RoomSpec:
    room: str
    channels: tuple[ChannelSpec, ...]


@dataclass(frozen=True)
class CalibrationSet:
    room: str
    channels: tuple[ChannelSpec, ...]
    wavelengths_nm: np.ndarray
    spectra_by_channel: dict[str, np.ndarray]
    unit: str


@dataclass(frozen=True)
class TargetDay:
    city_file: Path
    location_code: str
    location_name: str
    month: int
    month_name: str
    measurement_table: str
    metadata: pd.DataFrame
    wavelengths_nm: np.ndarray
    spectra: np.ndarray
    unit: str


ROOM_SPECS: dict[str, RoomSpec] = {
    "G4": RoomSpec(
        room="G4",
        channels=(
            ChannelSpec("coolWhite", "Cool White"),
            ChannelSpec("deepRed", "Deep Red"),
            ChannelSpec("farRed", "Far Red"),
        ),
    ),
    "G5": RoomSpec(
        room="G5",
        channels=(
            ChannelSpec("coolWhite", "Cool White"),
            ChannelSpec("deepRed", "Deep Red"),
            ChannelSpec("farRed", "Far Red"),
        ),
    ),
    "G6": RoomSpec(
        room="G6",
        channels=(
            ChannelSpec("coolWhite", "Cool White"),
            ChannelSpec("deepRed", "Red"),
            ChannelSpec("farRed", "Far Red"),
        ),
    ),
    "G7": RoomSpec(
        room="G7",
        channels=(
            ChannelSpec("coolWhite", "Cool White"),
            ChannelSpec("blue", "Blue"),
            ChannelSpec("cyan", "Cyan"),
            ChannelSpec("green", "Green"),
            ChannelSpec("amber", "Amber"),
            ChannelSpec("red", "Red"),
            ChannelSpec("deepRed", "Deep Red"),
            ChannelSpec("farRed", "Far Red"),
        ),
    ),
    "G8": RoomSpec(
        room="G8",
        channels=(
            ChannelSpec("coolWhite", "Cool White"),
            ChannelSpec("deepRed", "Deep Red"),
            ChannelSpec("farRed", "Far Red"),
        ),
    ),
}


def resolve_room_spec(room: str) -> RoomSpec:
    normalized = room.strip().upper()
    if normalized not in ROOM_SPECS:
        raise KeyError(f"Unknown room '{room}'. Available rooms: {', '.join(sorted(ROOM_SPECS))}")
    return ROOM_SPECS[normalized]


def _time_of_day_from_minutes(total_minutes: int) -> str:
    return f"{total_minutes // 60:02d}:{total_minutes % 60:02d}"


def _normalize_output_stem(value: str) -> str:
    sanitized = "".join(character if character.isalnum() or character in "._-" else "_" for character in value)
    return sanitized.strip("._") or "output"


def _normalise_truthy_text(value: str) -> str:
    return value.strip().lower()


def _parse_bool_choice(value: str | None) -> str | None:
    if value is None:
        return None
    normalized = value.strip().lower()
    if normalized not in {"true", "false", "any"}:
        raise ValueError("--sun-included must be one of: true, false, any")
    return None if normalized == "any" else normalized


def _convert_energy_to_photon(values: np.ndarray, wavelengths_nm: np.ndarray) -> np.ndarray:
    wavelength_scale = np.asarray(wavelengths_nm, dtype=float) * PHOTON_CONVERSION_FACTOR
    return np.asarray(values, dtype=float) * wavelength_scale


def _convert_values_to_unit(values: np.ndarray, wavelengths_nm: np.ndarray, unit: str) -> np.ndarray:
    if unit == "energy":
        return np.asarray(values, dtype=float)
    if unit == "photon":
        return _convert_energy_to_photon(values, wavelengths_nm)
    raise ValueError(f"Unsupported unit '{unit}'")


def calibration_file_path(
    room: str,
    *,
    base_path: str | Path = DEFAULT_CALIBRATION_DIR,
) -> Path:
    room_spec = resolve_room_spec(room)
    file_name = f"{room_spec.room}_Calibration_File.csv"
    if room_spec.room == "G4":
        file_name = f"{room_spec.room}_Calibration_file.csv"
    path = Path(base_path) / file_name
    if not path.exists():
        raise FileNotFoundError(f"Calibration file for {room_spec.room} not found: {path}")
    return path


def _jeti_header_row(file_path: Path) -> int:
    with file_path.open("r", encoding="latin-1") as handle:
        for index, line in enumerate(handle):
            if "Wavelength [nm]" in line:
                return index
    raise ValueError(f"'Wavelength [nm]' header not found in {file_path}")


def load_calibration_set(
    room: str,
    *,
    base_path: str | Path = DEFAULT_CALIBRATION_DIR,
    unit: str = "photon",
) -> CalibrationSet:
    room_spec = resolve_room_spec(room)
    file_path = calibration_file_path(room_spec.room, base_path=base_path)
    header_row = _jeti_header_row(file_path)

    frame = pd.read_csv(
        file_path,
        sep=";",
        skiprows=header_row,
        decimal=",",
        encoding="latin-1",
    ).dropna(axis=1, how="all")
    frame = frame.rename(columns={"Wavelength [nm]": "wavelength"})

    measurement_columns = [column for column in frame.columns if str(column).startswith("Ee")]
    expected_columns = len(room_spec.channels) * LEVEL_COUNT
    if len(measurement_columns) != expected_columns:
        raise ValueError(
            f"{file_path.name} contains {len(measurement_columns)} calibration columns, "
            f"expected {expected_columns} for room {room_spec.room}"
        )

    wavelengths_nm = pd.to_numeric(frame["wavelength"], errors="coerce").to_numpy(dtype=float)
    spectra_by_channel: dict[str, np.ndarray] = {}
    for channel_index, channel in enumerate(room_spec.channels):
        start = channel_index * LEVEL_COUNT
        end = start + LEVEL_COUNT
        spectral_block = (
            frame.loc[:, measurement_columns[start:end]]
            .apply(pd.to_numeric, errors="coerce")
            .to_numpy(dtype=float)
            .T
        )
        spectra_by_channel[channel.key] = _convert_values_to_unit(
            spectral_block,
            wavelengths_nm,
            unit,
        )

    return CalibrationSet(
        room=room_spec.room,
        channels=room_spec.channels,
        wavelengths_nm=wavelengths_nm,
        spectra_by_channel=spectra_by_channel,
        unit=unit,
    )


def load_calibration_data(
    room: str,
    base_path: str | Path = DEFAULT_CALIBRATION_DIR,
    *,
    unit: str = "photon",
) -> dict[str, pd.DataFrame]:
    calibration = load_calibration_set(room, base_path=base_path, unit=unit)
    percentage_columns = [f"{(index + 1) * LEVEL_STEP_PERCENT}%" for index in range(LEVEL_COUNT)]

    result: dict[str, pd.DataFrame] = {}
    for channel in calibration.channels:
        spectra = calibration.spectra_by_channel[channel.key]
        frame = pd.DataFrame(spectra.T, columns=percentage_columns)
        frame.insert(0, "wavelength", calibration.wavelengths_nm)
        result[channel.key] = frame
    return result


def create_target_spectrum(wavelengths: Sequence[float]) -> pd.DataFrame:
    timestamps = pd.date_range(start="2024-01-01", periods=288, freq="5min")
    wavelength_array = np.asarray(wavelengths, dtype=float)
    target_frame = pd.DataFrame(index=timestamps, columns=wavelength_array, dtype=float)

    for timestamp in timestamps:
        time_factor = np.sin(timestamp.hour * np.pi / 24)
        spectrum = 100 * time_factor * np.exp(-((wavelength_array - 550) ** 2) / (2 * 50**2))
        target_frame.loc[timestamp] = spectrum

    return target_frame


def _wavelength_columns(frame: pd.DataFrame) -> list[tuple[str, float]]:
    columns: list[tuple[str, float]] = []
    for column in frame.columns:
        try:
            columns.append((column, float(column)))
        except (TypeError, ValueError):
            continue
    if not columns:
        raise ValueError("No wavelength columns were found in the city average-day CSV")
    return sorted(columns, key=lambda item: item[1])


def _single_value_or_raise(frame: pd.DataFrame, column: str, description: str) -> str:
    if column not in frame.columns:
        raise KeyError(f"Missing required column '{column}' in the city average-day CSV")
    values = [
        str(value).strip()
        for value in frame[column].dropna().unique().tolist()
        if str(value).strip()
    ]
    unique_values = sorted(set(values))
    if len(unique_values) != 1:
        raise ValueError(f"Expected exactly one {description}, found: {unique_values or ['<blank>']}")
    return unique_values[0]


def _apply_string_filter(
    frame: pd.DataFrame,
    column: str,
    selected_value: str | None,
) -> pd.DataFrame:
    if column not in frame.columns:
        return frame

    series = frame[column].astype("string").fillna("").str.strip()
    available_values = sorted({value for value in series.tolist() if value})
    if selected_value is None:
        if len(available_values) > 1:
            raise ValueError(
                f"Multiple values remain for '{column}': {available_values}. "
                f"Pass --{column.replace('_', '-')} to disambiguate."
            )
        if len(available_values) == 1:
            return frame.loc[series == available_values[0]].copy()
        return frame

    comparison = selected_value.strip().lower()
    filtered = frame.loc[series.str.lower() == comparison].copy()
    if filtered.empty:
        raise ValueError(f"No rows matched {column}={selected_value!r}")
    return filtered


def _apply_sun_filter(frame: pd.DataFrame, selected_value: str | None) -> pd.DataFrame:
    if "sun_included" not in frame.columns:
        return frame

    series = frame["sun_included"].astype("string").fillna("").str.strip().str.lower()
    series = series.replace({"1": "true", "0": "false"})
    available_values = sorted({value for value in series.tolist() if value})
    if selected_value is None:
        if len(available_values) > 1:
            raise ValueError(
                f"Multiple values remain for 'sun_included': {available_values}. "
                "Pass --sun-included true or false to disambiguate."
            )
        if len(available_values) == 1:
            return frame.loc[series == available_values[0]].copy()
        return frame

    filtered = frame.loc[series == selected_value].copy()
    if filtered.empty:
        raise ValueError(f"No rows matched sun_included={selected_value!r}")
    return filtered


def _fill_spectral_grid(spectral_frame: pd.DataFrame, fill_method: str) -> pd.DataFrame:
    if fill_method == "none":
        return spectral_frame
    if fill_method == "interpolate":
        return spectral_frame.interpolate(method="linear", axis=0, limit_direction="both")
    if fill_method == "ffill":
        return spectral_frame.ffill().bfill()
    if fill_method == "zero":
        return spectral_frame.fillna(0.0)
    raise ValueError(f"Unsupported fill method '{fill_method}'")


def load_city_average_day(
    city_file: str | Path,
    *,
    month: int,
    measurement_table: str = DEFAULT_MEASUREMENT_TABLE,
    measurement_setup: str | None = None,
    sun_included: str | None = None,
    fill_method: str = "none",
    unit: str = "photon",
) -> TargetDay:
    path = Path(city_file)
    if not path.exists():
        raise FileNotFoundError(f"City average-day CSV not found: {path}")

    frame = pd.read_csv(path)
    filtered = frame.loc[frame["month"] == month].copy()
    if "measurement_table" in filtered.columns:
        filtered = filtered.loc[
            filtered["measurement_table"].astype("string").fillna("").str.strip()
            == measurement_table
        ].copy()

    filtered = _apply_string_filter(filtered, "measurement_setup", measurement_setup)
    filtered = _apply_sun_filter(filtered, sun_included)
    if filtered.empty:
        raise ValueError(
            f"No rows remain after filtering {path.name} for month={month} "
            f"and measurement_table={measurement_table}"
        )

    filtered = filtered.sort_values("time_bin_minutes").reset_index(drop=True)
    if filtered["time_bin_minutes"].duplicated().any():
        duplicate_bins = (
            filtered.loc[filtered["time_bin_minutes"].duplicated(keep=False), "time_bin_minutes"]
            .astype(int)
            .tolist()
        )
        raise ValueError(
            "Multiple spectra remain for one or more 5-minute bins. "
            f"Duplicate bins: {sorted(set(duplicate_bins))}. Apply more filters first."
        )

    wavelength_columns = _wavelength_columns(filtered)
    spectral_column_names = [column for column, _ in wavelength_columns]
    wavelengths_nm = np.asarray([wavelength for _, wavelength in wavelength_columns], dtype=float)

    base_metadata = {
        "location_code": _single_value_or_raise(filtered, "location_code", "location code"),
        "location_name": _single_value_or_raise(filtered, "location_name", "location name"),
        "month": int(filtered["month"].iloc[0]),
        "month_name": _single_value_or_raise(filtered, "month_name", "month name"),
        "measurement_table": measurement_table,
        "measurement_setup": _single_value_or_raise(
            filtered.assign(measurement_setup=filtered.get("measurement_setup", "")),
            "measurement_setup",
            "measurement setup",
        )
        if "measurement_setup" in filtered.columns
        else "",
        "sun_included": _single_value_or_raise(
            filtered.assign(sun_included=filtered.get("sun_included", "")),
            "sun_included",
            "sun_included flag",
        )
        if "sun_included" in filtered.columns
        else "",
    }

    spectral_frame = (
        filtered.loc[:, ["time_bin_minutes", *spectral_column_names]]
        .set_index("time_bin_minutes")
        .apply(pd.to_numeric, errors="coerce")
        .sort_index()
    )
    sample_series = (
        pd.to_numeric(filtered.get("samples_averaged"), errors="coerce")
        if "samples_averaged" in filtered.columns
        else pd.Series(np.nan, index=filtered.index)
    )
    sample_frame = pd.Series(sample_series.to_numpy(), index=filtered["time_bin_minutes"], dtype=float)

    if fill_method != "none":
        full_index = pd.Index(range(0, 24 * 60, LEVEL_STEP_PERCENT), name="time_bin_minutes")
        spectral_frame = spectral_frame.reindex(full_index)
        sample_frame = sample_frame.reindex(full_index)
        spectral_frame = _fill_spectral_grid(spectral_frame, fill_method)
    metadata = pd.DataFrame(
        {
            **base_metadata,
            "time_bin_minutes": spectral_frame.index.to_numpy(dtype=int),
            "time_of_day": [
                _time_of_day_from_minutes(int(minutes))
                for minutes in spectral_frame.index.to_numpy(dtype=int)
            ],
            "samples_averaged": sample_frame.to_numpy(dtype=float),
            "was_filled": sample_frame.isna().to_numpy(),
        }
    )

    spectra = _convert_values_to_unit(
        spectral_frame.to_numpy(dtype=float),
        wavelengths_nm,
        unit,
    )
    return TargetDay(
        city_file=path,
        location_code=base_metadata["location_code"],
        location_name=base_metadata["location_name"],
        month=base_metadata["month"],
        month_name=base_metadata["month_name"],
        measurement_table=measurement_table,
        metadata=metadata,
        wavelengths_nm=wavelengths_nm,
        spectra=spectra,
        unit=unit,
    )


def _spectrum_at_percent(level_spectra: np.ndarray, percent: float) -> np.ndarray:
    if percent <= 0:
        return np.zeros_like(level_spectra[0])
    if percent >= 100:
        return level_spectra[-1]

    scaled_index = percent / LEVEL_STEP_PERCENT - 1
    if scaled_index < 0:
        slope_per_percent = (level_spectra[1] - level_spectra[0]) / LEVEL_STEP_PERCENT
        return np.clip(level_spectra[0] - slope_per_percent * (LEVEL_STEP_PERCENT - percent), 0.0, None)

    lower_index = int(np.floor(scaled_index))
    upper_index = int(np.ceil(scaled_index))
    if lower_index == upper_index:
        return level_spectra[lower_index]

    blend = scaled_index - lower_index
    return level_spectra[lower_index] * (1 - blend) + level_spectra[upper_index] * blend


def reconstruct_spectrum(calibration: CalibrationSet, percentages: Sequence[float]) -> np.ndarray:
    reconstructed = np.zeros_like(calibration.wavelengths_nm, dtype=float)
    for percentage, channel in zip(percentages, calibration.channels, strict=True):
        reconstructed += _spectrum_at_percent(
            calibration.spectra_by_channel[channel.key],
            float(percentage),
        )
    return reconstructed


def _interpolate_target_spectrum(
    target_wavelengths_nm: np.ndarray,
    target_spectrum: np.ndarray,
    destination_wavelengths_nm: np.ndarray,
) -> np.ndarray:
    valid_mask = np.isfinite(target_wavelengths_nm) & np.isfinite(target_spectrum)
    if valid_mask.sum() < 2:
        return np.zeros_like(destination_wavelengths_nm, dtype=float)

    source_wavelengths = target_wavelengths_nm[valid_mask]
    source_values = target_spectrum[valid_mask]
    sort_index = np.argsort(source_wavelengths)
    return np.interp(
        destination_wavelengths_nm,
        source_wavelengths[sort_index],
        source_values[sort_index],
        left=0.0,
        right=0.0,
    )


def _initial_percent_guess(calibration: CalibrationSet, target_on_grid: np.ndarray) -> np.ndarray:
    if not np.any(np.abs(target_on_grid) > 0):
        return np.zeros(len(calibration.channels), dtype=float)

    basis_matrix = np.column_stack(
        [
            calibration.spectra_by_channel[channel.key][-1]
            for channel in calibration.channels
        ]
    )
    solution = lsq_linear(basis_matrix, target_on_grid, bounds=(0.0, 1.0))
    return np.clip(solution.x * 100.0, 0.0, 100.0)


def fit_lamp_percentages(
    calibration: CalibrationSet,
    target_on_grid: np.ndarray,
    *,
    initial_guess: np.ndarray | None = None,
) -> tuple[np.ndarray, dict[str, float | int | bool]]:
    target_vector = np.asarray(target_on_grid, dtype=float)
    if not np.any(np.abs(target_vector) > 0):
        zeros = np.zeros(len(calibration.channels), dtype=float)
        return zeros, {
            "fit_rmse": 0.0,
            "fit_mae": 0.0,
            "fit_success": True,
            "fit_nfev": 0,
            "target_integral": 0.0,
            "reconstructed_integral": 0.0,
        }

    start = (
        np.clip(np.asarray(initial_guess, dtype=float), 0.0, 100.0)
        if initial_guess is not None
        else _initial_percent_guess(calibration, target_vector)
    )
    if start.shape != (len(calibration.channels),):
        start = _initial_percent_guess(calibration, target_vector)

    result = least_squares(
        lambda percentages: reconstruct_spectrum(calibration, percentages) - target_vector,
        x0=start,
        bounds=(0.0, 100.0),
        method="trf",
        x_scale=100.0,
        max_nfev=400,
    )

    fitted_percentages = np.clip(result.x, 0.0, 100.0)
    reconstructed = reconstruct_spectrum(calibration, fitted_percentages)
    residual = reconstructed - target_vector
    return fitted_percentages, {
        "fit_rmse": float(np.sqrt(np.mean(residual**2))),
        "fit_mae": float(np.mean(np.abs(residual))),
        "fit_success": bool(result.success),
        "fit_nfev": int(result.nfev),
        "target_integral": float(np.trapezoid(target_vector, calibration.wavelengths_nm)),
        "reconstructed_integral": float(np.trapezoid(reconstructed, calibration.wavelengths_nm)),
    }


def calibrate_target_day(
    target_day: TargetDay,
    calibration: CalibrationSet,
    *,
    min_wavelength: float | None = None,
    max_wavelength: float | None = None,
) -> pd.DataFrame:
    wavelength_mask = np.ones_like(calibration.wavelengths_nm, dtype=bool)
    if min_wavelength is not None:
        wavelength_mask &= calibration.wavelengths_nm >= min_wavelength
    if max_wavelength is not None:
        wavelength_mask &= calibration.wavelengths_nm <= max_wavelength

    wavelength_mask &= calibration.wavelengths_nm >= float(np.nanmin(target_day.wavelengths_nm))
    wavelength_mask &= calibration.wavelengths_nm <= float(np.nanmax(target_day.wavelengths_nm))
    if wavelength_mask.sum() < 10:
        raise ValueError("Too few overlapping wavelengths between the city day and the room calibration")

    fit_wavelengths = calibration.wavelengths_nm[wavelength_mask]
    fit_calibration = CalibrationSet(
        room=calibration.room,
        channels=calibration.channels,
        wavelengths_nm=fit_wavelengths,
        spectra_by_channel={
            channel.key: calibration.spectra_by_channel[channel.key][:, wavelength_mask]
            for channel in calibration.channels
        },
        unit=calibration.unit,
    )

    result_rows: list[dict[str, object]] = []
    previous_percentages: np.ndarray | None = None
    for row_index, metadata_row in target_day.metadata.iterrows():
        aligned_target = _interpolate_target_spectrum(
            target_day.wavelengths_nm,
            target_day.spectra[row_index],
            fit_wavelengths,
        )
        percentages, diagnostics = fit_lamp_percentages(
            fit_calibration,
            aligned_target,
            initial_guess=previous_percentages,
        )
        previous_percentages = percentages

        result_row = metadata_row.to_dict()
        result_row["room"] = calibration.room
        result_row["fit_unit"] = target_day.unit
        result_row.update(diagnostics)
        for percentage, channel in zip(percentages, calibration.channels, strict=True):
            result_row[f"{channel.key}_pct"] = float(percentage)
        result_rows.append(result_row)

    return pd.DataFrame(result_rows)


def default_output_path(
    city_file: str | Path,
    *,
    month: int,
    room: str,
    fill_method: str = "none",
) -> Path:
    city_path = Path(city_file)
    stem = f"{_normalize_output_stem(city_path.stem)}_{room}_month{month:02d}_lamp_schedule"
    if fill_method != "none":
        stem = f"{stem}_{fill_method}"
    return city_path.with_name(f"{stem}.csv")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Match chamber lamp percentages to one month-specific average day from Cities output.",
    )
    parser.add_argument(
        "city_file",
        type=Path,
        help="Per-city average-day CSV created by Cities.py average-day.",
    )
    parser.add_argument(
        "--month",
        type=int,
        required=True,
        help="Month number to calibrate (1-12).",
    )
    parser.add_argument(
        "--room",
        required=True,
        choices=sorted(ROOM_SPECS),
        help="Chamber room calibration to use.",
    )
    parser.add_argument(
        "--measurement-table",
        default=DEFAULT_MEASUREMENT_TABLE,
        help=f"Measurement table to use from the city CSV (default: {DEFAULT_MEASUREMENT_TABLE}).",
    )
    parser.add_argument(
        "--measurement-setup",
        default=None,
        help="Optional measurement_setup filter if the city CSV contains multiple setups.",
    )
    parser.add_argument(
        "--sun-included",
        choices=("any", "true", "false"),
        default="any",
        help="Optional sun_included filter (default: any).",
    )
    parser.add_argument(
        "--fill-method",
        choices=("none", "interpolate", "ffill", "zero"),
        default="none",
        help="How to fill missing 5-minute bins before calibration.",
    )
    parser.add_argument(
        "--unit",
        choices=("photon", "energy"),
        default="photon",
        help="Unit used for fitting. 'photon' matches the LightTools conversion.",
    )
    parser.add_argument(
        "--calibration-dir",
        type=Path,
        default=DEFAULT_CALIBRATION_DIR,
        help=f"Directory containing the Jeti chamber calibration CSV files (default: {DEFAULT_CALIBRATION_DIR}).",
    )
    parser.add_argument(
        "--min-wavelength",
        type=float,
        default=None,
        help="Optional lower wavelength bound for the fit.",
    )
    parser.add_argument(
        "--max-wavelength",
        type=float,
        default=None,
        help="Optional upper wavelength bound for the fit.",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=None,
        help="Output CSV path. Defaults to a file beside the city CSV.",
    )
    return parser


def run(args: argparse.Namespace) -> int:
    if not 1 <= args.month <= 12:
        raise ValueError("--month must be between 1 and 12")

    calibration = load_calibration_set(
        args.room,
        base_path=args.calibration_dir,
        unit=args.unit,
    )
    target_day = load_city_average_day(
        args.city_file,
        month=args.month,
        measurement_table=args.measurement_table,
        measurement_setup=args.measurement_setup,
        sun_included=_parse_bool_choice(args.sun_included),
        fill_method=args.fill_method,
        unit=args.unit,
    )

    results = calibrate_target_day(
        target_day,
        calibration,
        min_wavelength=args.min_wavelength,
        max_wavelength=args.max_wavelength,
    )
    output_path = (
        Path(args.output)
        if args.output is not None
        else default_output_path(
            args.city_file,
            month=args.month,
            room=args.room,
            fill_method=args.fill_method,
        )
    )
    output_path.parent.mkdir(parents=True, exist_ok=True)
    results.to_csv(output_path, index=False)

    print(f"City file: {target_day.city_file}")
    print(
        f"Target day: {target_day.location_name} ({target_day.location_code}), "
        f"{target_day.month_name}, {len(target_day.metadata)} time bins"
    )
    print(
        f"Room: {calibration.room} with {len(calibration.channels)} channels "
        f"and {len(calibration.wavelengths_nm)} calibration wavelengths"
    )
    print(f"Unit: {target_day.unit}")
    print(f"Wrote lamp schedule to {output_path}")
    print()
    print(
        results[
            [
                "time_of_day",
                *[f"{channel.key}_pct" for channel in calibration.channels],
                "fit_rmse",
            ]
        ]
        .head(10)
        .to_string(index=False)
    )
    return 0


def main(argv: Sequence[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)

    try:
        return run(args)
    except Exception as exc:
        print(f"Error: {exc}")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
