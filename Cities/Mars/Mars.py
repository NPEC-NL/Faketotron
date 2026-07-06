from __future__ import annotations

import argparse
import math
import re
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Sequence

import matplotlib

matplotlib.use("Agg")

import matplotlib.pyplot as plt
import numpy as np
import pandas as pd

PARENT_CITIES_DIR = Path(__file__).resolve().parents[1]
if str(PARENT_CITIES_DIR) not in sys.path:
    sys.path.insert(0, str(PARENT_CITIES_DIR))

from calibrate import (  # noqa: E402
    DEFAULT_CALIBRATION_DIR,
    calibrate_target_day,
    load_calibration_set,
    load_city_average_day,
)


EXPECTED_FILE_COUNT = 43
EXPECTED_WAVELENGTHS_NM = np.arange(300.0, 831.0, 5.0)
EXPECTED_ANGLES_DEG = np.arange(0.0, 73.0, 1.0)
EXPECTED_TAUS = np.round(np.arange(0.1, 8.5 + 0.0001, 0.2), 1)
TIME_BIN_MINUTES = 5
DEFAULT_SOL_LENGTH_MINUTES = 1480
DEFAULT_IRRADIANCE_SCALE = 0.5
SPECTRAL_UNITS = "W m^-2 nm^-1"
SOURCE_REFERENCE_URL = "https://www.mdpi.com/2076-3417/14/23/10812"
MEASUREMENT_TABLE = "spectral_horizontal_irradiance"
LOCATION_CODE = "MARS_EQ_LS0"
LOCATION_NAME = "Mars Equator, Ls 0"
MONTH = 1
MONTH_NAME = "Representative Mars Sol"

METADATA_COLUMNS = [
    "location_code",
    "location_name",
    "measurement_table",
    "month",
    "month_name",
    "time_bin_minutes",
    "time_of_day",
    "measurement_setup",
    "sun_included",
    "patch",
    "patch_almucantar",
    "patch_azimuth",
    "samples_averaged",
]


@dataclass(frozen=True)
class ParsedTauFile:
    path: Path
    tau: float
    tau_from_name: float
    tau_from_header: float | None
    wavelengths_nm: np.ndarray
    angles_deg: np.ndarray
    irradiance: np.ndarray
    metadata_lines: tuple[str, ...]


@dataclass(frozen=True)
class SourceInspection:
    parsed_files: tuple[ParsedTauFile, ...]
    delimiter: str
    units: str
    absolute_or_normalized: str
    warnings: tuple[str, ...]


@dataclass(frozen=True)
class MarsSpectralGrid:
    inspection: SourceInspection
    long_frame: pd.DataFrame
    tau_values: np.ndarray
    wavelengths_nm: np.ndarray
    angles_deg: np.ndarray


@dataclass(frozen=True)
class MarsScenario:
    name: str
    output_stem: str
    measurement_setup: str
    fixed_tau: float | None = None
    profile_name: str = "fixed"
    requested_tau: float | None = None


@dataclass(frozen=True)
class MarsDay:
    scenario_name: str
    output_stem: str
    average_day: pd.DataFrame
    validation: pd.DataFrame
    wavelengths_nm: np.ndarray
    requested_tau: float | None
    selected_tau: float | None
    tau_min: float
    tau_max: float
    dynamic_tau_profile: bool
    measurement_setup: str
    horizon_method: str
    sol_length_minutes: int
    irradiance_scale: float


def tau_label(tau: float) -> str:
    rounded = round(float(tau), 6)
    if math.isclose(rounded, round(rounded)):
        return str(int(round(rounded)))
    return f"{rounded:g}"


def tau_token(tau: float) -> str:
    return tau_label(tau).replace("-", "m").replace(".", "p")


def format_time_of_day(total_minutes: int) -> str:
    hours = total_minutes // 60
    minutes = total_minutes % 60
    return f"{hours:02d}:{minutes:02d}"


def parse_time_of_day(value: str) -> int:
    match = re.fullmatch(r"(\d{1,2}):([0-5]\d)", value.strip())
    if not match:
        raise ValueError(f"Invalid time_of_day value: {value!r}")
    return int(match.group(1)) * 60 + int(match.group(2))


def measurement_setup_for_tau(tau: float, irradiance_scale: float = 1.0) -> str:
    return f"COMIMART_Melgosa2024_tau_{tau_label(tau)}"


def fixed_tau_scenario(name: str, output_stem: str, tau: float) -> MarsScenario:
    return MarsScenario(
        name=name,
        output_stem=output_stem,
        measurement_setup=measurement_setup_for_tau(tau),
        fixed_tau=float(tau),
        profile_name="fixed",
        requested_tau=float(tau),
    )


def default_batch_scenarios() -> tuple[MarsScenario, ...]:
    return (
        fixed_tau_scenario(
            "Clear Tau 0.3",
            "Mars_Equator_Clear_tau0p3_average_sol",
            0.3,
        ),
        fixed_tau_scenario(
            "Moderate Dust Tau 1.1",
            "Mars_Equator_Moderate_Dust_tau1p1_average_sol",
            1.1,
        ),
        fixed_tau_scenario(
            "Dust Storm Tau 4.1",
            "Mars_Equator_Dust_Storm_tau4p1_average_sol",
            4.1,
        ),
        fixed_tau_scenario(
            "Extreme Dust Storm Tau 8.1",
            "Mars_Equator_Extreme_Dust_tau8p1_average_sol",
            8.1,
        ),
        MarsScenario(
            name="Afternoon Dust Storm",
            output_stem="Mars_Equator_Afternoon_Dust_Storm_average_sol",
            measurement_setup="COMIMART_Melgosa2024_afternoon_dust_storm",
            fixed_tau=None,
            profile_name="afternoon_dust_storm",
            requested_tau=None,
        ),
    )


def single_tau_scenario(requested_tau: float, selected_tau: float) -> MarsScenario:
    token = tau_token(selected_tau)
    return MarsScenario(
        name=f"Tau {tau_label(selected_tau)}",
        output_stem=f"Mars_Equator_Ls0_tau{token}_average_sol",
        measurement_setup=measurement_setup_for_tau(selected_tau),
        fixed_tau=float(selected_tau),
        profile_name="fixed",
        requested_tau=float(requested_tau),
    )


def interpolate_linear(value: float, start_x: float, end_x: float, start_y: float, end_y: float) -> float:
    if math.isclose(start_x, end_x):
        return float(end_y)
    fraction = min(1.0, max(0.0, (float(value) - start_x) / (end_x - start_x)))
    return float(start_y + (end_y - start_y) * fraction)


def afternoon_dust_storm_tau(time_bin_minutes: int | float) -> float:
    minutes = float(time_bin_minutes)
    if minutes <= 12 * 60:
        return 0.3
    if minutes <= 14 * 60:
        return interpolate_linear(minutes, 12 * 60, 14 * 60, 0.3, 4.1)
    if minutes <= 16 * 60 + 30:
        return 4.1
    if minutes <= 18 * 60 + 30:
        return interpolate_linear(minutes, 16 * 60 + 30, 18 * 60 + 30, 4.1, 1.1)
    return 1.1


def tau_for_scenario(scenario: MarsScenario, time_bin_minutes: int | float) -> float:
    if scenario.fixed_tau is not None:
        return float(scenario.fixed_tau)
    if scenario.profile_name == "afternoon_dust_storm":
        return afternoon_dust_storm_tau(time_bin_minutes)
    raise ValueError(f"Unsupported Tau profile: {scenario.profile_name}")


def source_file_sort_key(path: Path) -> float:
    match = re.search(r"tau_([0-9]+(?:\.[0-9]+)?)$", path.stem)
    if not match:
        raise ValueError(f"Could not parse Tau value from source file name: {path.name}")
    return float(match.group(1))


def parse_tau_file(path: Path) -> ParsedTauFile:
    if not path.exists():
        raise FileNotFoundError(f"Mars source file does not exist: {path}")

    text = path.read_text(encoding="utf-8", errors="replace")
    lines = text.splitlines()
    if len(lines) < 5:
        raise ValueError(f"{path.name} is too short to contain COMIMART metadata and data")

    tau_from_name = source_file_sort_key(path)
    tau_from_header: float | None = None
    header_match = re.search(
        r"tau\s*=\s*([+-]?\d+(?:\.\d+)?(?:e[+-]?\d+)?)",
        lines[2],
        flags=re.IGNORECASE,
    )
    if header_match:
        tau_from_header = float(header_match.group(1))

    data = np.loadtxt(path, skiprows=3)
    if data.shape != (len(EXPECTED_WAVELENGTHS_NM) + 1, len(EXPECTED_ANGLES_DEG) + 1):
        raise ValueError(
            f"{path.name} has numeric shape {data.shape}, expected "
            f"{(len(EXPECTED_WAVELENGTHS_NM) + 1, len(EXPECTED_ANGLES_DEG) + 1)}"
        )

    angles_deg = data[0, 1:].astype(float)
    wavelengths_nm = data[1:, 0].astype(float)
    irradiance = data[1:, 1:].astype(float)

    if not np.allclose(angles_deg, EXPECTED_ANGLES_DEG):
        raise ValueError(f"{path.name} does not use the expected 0..72 degree angle grid")
    if not np.allclose(wavelengths_nm, EXPECTED_WAVELENGTHS_NM):
        raise ValueError(f"{path.name} does not use the expected 300..830 nm wavelength grid")
    if tau_from_header is not None and not math.isclose(tau_from_name, tau_from_header, rel_tol=0.0, abs_tol=1e-9):
        raise ValueError(
            f"{path.name} Tau mismatch: file name has {tau_from_name:g}, "
            f"metadata has {tau_from_header:g}"
        )
    if not np.isfinite(irradiance).all():
        raise ValueError(f"{path.name} contains missing or non-finite irradiance values")
    if (irradiance < 0).any():
        raise ValueError(f"{path.name} contains negative irradiance values")
    if pd.Index(wavelengths_nm).duplicated().any():
        raise ValueError(f"{path.name} contains duplicated wavelengths")
    if pd.Index(angles_deg).duplicated().any():
        raise ValueError(f"{path.name} contains duplicated solar zenith angles")

    return ParsedTauFile(
        path=path,
        tau=tau_from_header if tau_from_header is not None else tau_from_name,
        tau_from_name=tau_from_name,
        tau_from_header=tau_from_header,
        wavelengths_nm=wavelengths_nm,
        angles_deg=angles_deg,
        irradiance=irradiance,
        metadata_lines=tuple(lines[:3]),
    )


def inspect_mars_source_files(source_dir: str | Path) -> SourceInspection:
    base_dir = Path(source_dir)
    if not base_dir.exists():
        raise FileNotFoundError(f"Mars source directory does not exist: {base_dir}")

    files = sorted(
        base_dir.glob("COMIMART_Simulation_tau_*.txt"),
        key=source_file_sort_key,
    )
    if not files:
        raise FileNotFoundError(f"No COMIMART_Simulation_tau_*.txt files found in {base_dir}")
    if len(files) != EXPECTED_FILE_COUNT:
        raise ValueError(f"Found {len(files)} Tau files, expected {EXPECTED_FILE_COUNT}")

    parsed_files = tuple(parse_tau_file(path) for path in files)
    tau_values = np.round(np.asarray([parsed.tau for parsed in parsed_files], dtype=float), 1)
    if not np.allclose(tau_values, EXPECTED_TAUS):
        raise ValueError(
            "Unexpected Tau grid. Found "
            f"{tau_values.tolist()}, expected {EXPECTED_TAUS.tolist()}"
        )
    if pd.Index(tau_values).duplicated().any():
        raise ValueError("Duplicated Tau values found in source files")

    reference_wavelengths = parsed_files[0].wavelengths_nm
    reference_angles = parsed_files[0].angles_deg
    for parsed in parsed_files[1:]:
        if not np.array_equal(parsed.wavelengths_nm, reference_wavelengths):
            raise ValueError(f"{parsed.path.name} wavelength grid differs from the first file")
        if not np.array_equal(parsed.angles_deg, reference_angles):
            raise ValueError(f"{parsed.path.name} angle grid differs from the first file")

    return SourceInspection(
        parsed_files=parsed_files,
        delimiter="whitespace",
        units=SPECTRAL_UNITS,
        absolute_or_normalized="absolute total spectral irradiance, not normalized spectra",
        warnings=(
            "The TXT headers do not include units; units are taken from the article "
            "figure axis and supplementary description.",
            "The spectra are COMIMART model outputs, not rover measurements.",
        ),
    )


def load_mars_spectral_grid(source_dir: str | Path) -> MarsSpectralGrid:
    inspection = inspect_mars_source_files(source_dir)
    long_frames: list[pd.DataFrame] = []
    for parsed in inspection.parsed_files:
        wide = pd.DataFrame(
            parsed.irradiance,
            index=parsed.wavelengths_nm,
            columns=parsed.angles_deg,
        )
        long_frame = (
            wide.rename_axis(index="wavelength_nm", columns="solar_zenith_angle_deg")
            .stack()
            .reset_index(name="spectral_horizontal_irradiance")
        )
        long_frame.insert(0, "tau", parsed.tau)
        long_frame["source_file"] = parsed.path.name
        long_frames.append(long_frame)

    combined = pd.concat(long_frames, ignore_index=True)
    tau_values = np.asarray([parsed.tau for parsed in inspection.parsed_files], dtype=float)
    wavelengths_nm = inspection.parsed_files[0].wavelengths_nm
    angles_deg = inspection.parsed_files[0].angles_deg
    expected_rows = len(tau_values) * len(wavelengths_nm) * len(angles_deg)
    if len(combined) != expected_rows:
        raise ValueError(f"Long spectral grid has {len(combined)} rows, expected {expected_rows}")

    return MarsSpectralGrid(
        inspection=inspection,
        long_frame=combined,
        tau_values=tau_values,
        wavelengths_nm=wavelengths_nm,
        angles_deg=angles_deg,
    )


def nearest_available_tau(requested_tau: float, available_taus: Sequence[float]) -> float:
    tau_array = np.asarray(available_taus, dtype=float)
    distances = np.abs(tau_array - float(requested_tau))
    min_distance = float(distances.min())
    candidates = tau_array[np.isclose(distances, min_distance)]
    return float(candidates.max())


def mars_time_to_solar_zenith(time_bin_minutes: int | float, sol_length_minutes: int) -> float:
    return abs(360.0 * (float(time_bin_minutes) / float(sol_length_minutes) - 0.5))


def angle_bounds(angle_deg: float, angles_deg: np.ndarray) -> tuple[float, float, float]:
    if angle_deg <= float(angles_deg[0]):
        return float(angles_deg[0]), float(angles_deg[0]), 0.0
    if angle_deg >= float(angles_deg[-1]):
        return float(angles_deg[-1]), float(angles_deg[-1]), 0.0

    upper_index = int(np.searchsorted(angles_deg, angle_deg, side="right"))
    lower_angle = float(angles_deg[upper_index - 1])
    upper_angle = float(angles_deg[upper_index])
    fraction = (angle_deg - lower_angle) / (upper_angle - lower_angle)
    return lower_angle, upper_angle, float(fraction)


def interpolate_angle_spectrum(
    angle_deg: float,
    wavelengths_by_angles: np.ndarray,
    angles_deg: np.ndarray,
) -> tuple[np.ndarray, float, float, float]:
    lower_angle, upper_angle, fraction = angle_bounds(angle_deg, angles_deg)
    lower_index = int(np.where(np.isclose(angles_deg, lower_angle))[0][0])
    upper_index = int(np.where(np.isclose(angles_deg, upper_angle))[0][0])
    if lower_index == upper_index:
        spectrum = wavelengths_by_angles[:, lower_index].copy()
    else:
        spectrum = (
            wavelengths_by_angles[:, lower_index] * (1.0 - fraction)
            + wavelengths_by_angles[:, upper_index] * fraction
        )
    return spectrum, lower_angle, upper_angle, fraction


def apply_horizon_fade(spectrum_72: np.ndarray, angle_deg: float) -> np.ndarray:
    if angle_deg >= 90.0:
        return np.zeros_like(spectrum_72)
    factor = math.cos(math.radians(angle_deg)) / math.cos(math.radians(72.0))
    return np.clip(spectrum_72 * factor, 0.0, None)


def source_spectrum_for_time(
    angle_deg: float,
    wavelengths_by_angles: np.ndarray,
    angles_deg: np.ndarray,
    horizon_method: str,
) -> tuple[np.ndarray, float | None, float | None, float | None, bool, str]:
    if angle_deg >= 90.0:
        return (
            np.zeros(wavelengths_by_angles.shape[0], dtype=float),
            None,
            None,
            None,
            False,
            "night",
        )

    if angle_deg <= float(angles_deg[-1]):
        spectrum, lower_angle, upper_angle, fraction = interpolate_angle_spectrum(
            angle_deg,
            wavelengths_by_angles,
            angles_deg,
        )
        return spectrum, lower_angle, upper_angle, fraction, False, "source-interpolation"

    spectrum_72 = wavelengths_by_angles[:, -1]
    if horizon_method == "cosine-fade":
        spectrum = apply_horizon_fade(spectrum_72, angle_deg)
    elif horizon_method == "zero-after-72":
        spectrum = np.zeros_like(spectrum_72)
    else:
        raise ValueError(f"Unsupported horizon method: {horizon_method}")

    return spectrum, 72.0, 72.0, None, True, horizon_method


def selected_tau_data(
    grid: MarsSpectralGrid,
    selected_tau: float,
    min_wavelength: float,
    max_wavelength: float,
) -> tuple[np.ndarray, np.ndarray, np.ndarray, str]:
    parsed = next(
        parsed_file
        for parsed_file in grid.inspection.parsed_files
        if math.isclose(parsed_file.tau, selected_tau, rel_tol=0.0, abs_tol=1e-9)
    )
    wavelength_mask = (
        (parsed.wavelengths_nm >= float(min_wavelength))
        & (parsed.wavelengths_nm <= float(max_wavelength))
    )
    if not wavelength_mask.any():
        raise ValueError(
            f"No source wavelengths remain between {min_wavelength:g} and {max_wavelength:g} nm"
        )
    return (
        parsed.wavelengths_nm[wavelength_mask],
        parsed.angles_deg,
        parsed.irradiance[wavelength_mask, :],
        parsed.path.name,
    )


def tau_bounds(requested_tau: float, tau_values: np.ndarray) -> tuple[float, float, float]:
    tau_array = np.asarray(tau_values, dtype=float)
    requested = float(requested_tau)
    exact_matches = tau_array[np.isclose(tau_array, requested, rtol=0.0, atol=1e-9)]
    if len(exact_matches):
        exact = float(exact_matches[0])
        return exact, exact, 0.0
    if requested < float(tau_array[0]) or requested > float(tau_array[-1]):
        raise ValueError(
            f"Requested Tau {requested:g} is outside the source Tau range "
            f"{tau_array[0]:g}..{tau_array[-1]:g}"
        )

    upper_index = int(np.searchsorted(tau_array, requested, side="right"))
    lower_tau = float(tau_array[upper_index - 1])
    upper_tau = float(tau_array[upper_index])
    fraction = (requested - lower_tau) / (upper_tau - lower_tau)
    return lower_tau, upper_tau, float(fraction)


def tau_profile_data(
    grid: MarsSpectralGrid,
    min_wavelength: float,
    max_wavelength: float,
) -> tuple[np.ndarray, np.ndarray, np.ndarray, dict[float, np.ndarray], dict[float, str]]:
    first = grid.inspection.parsed_files[0]
    wavelength_mask = (
        (first.wavelengths_nm >= float(min_wavelength))
        & (first.wavelengths_nm <= float(max_wavelength))
    )
    if not wavelength_mask.any():
        raise ValueError(
            f"No source wavelengths remain between {min_wavelength:g} and {max_wavelength:g} nm"
        )

    tau_values = np.asarray(sorted(parsed.tau for parsed in grid.inspection.parsed_files), dtype=float)
    spectra_by_tau: dict[float, np.ndarray] = {}
    source_file_by_tau: dict[float, str] = {}
    for parsed in grid.inspection.parsed_files:
        tau = float(parsed.tau)
        spectra_by_tau[tau] = parsed.irradiance[wavelength_mask, :]
        source_file_by_tau[tau] = parsed.path.name

    return (
        first.wavelengths_nm[wavelength_mask],
        first.angles_deg,
        tau_values,
        spectra_by_tau,
        source_file_by_tau,
    )


def create_mars_average_day(
    grid: MarsSpectralGrid,
    *,
    scenario: MarsScenario,
    horizon_method: str,
    min_wavelength: float,
    max_wavelength: float,
    sol_length_minutes: int,
    irradiance_scale: float,
) -> MarsDay:
    if sol_length_minutes <= 0 or sol_length_minutes % TIME_BIN_MINUTES != 0:
        raise ValueError(f"sol_length_minutes must be a positive multiple of {TIME_BIN_MINUTES}")
    if min_wavelength > max_wavelength:
        raise ValueError("min_wavelength must be <= max_wavelength")
    if not np.isfinite(float(irradiance_scale)) or float(irradiance_scale) < 0:
        raise ValueError("irradiance_scale must be a finite number >= 0")

    wavelengths_nm, angles_deg, tau_values, spectra_by_tau, source_file_by_tau = tau_profile_data(
        grid,
        min_wavelength,
        max_wavelength,
    )

    spectral_rows: list[np.ndarray] = []
    validation_rows: list[dict[str, object]] = []
    time_bins = list(range(0, sol_length_minutes, TIME_BIN_MINUTES))
    requested_tau_values = [tau_for_scenario(scenario, minutes) for minutes in time_bins]
    for minutes in time_bins:
        requested_tau = tau_for_scenario(scenario, minutes)
        source_tau_lower, source_tau_upper, tau_fraction = tau_bounds(requested_tau, tau_values)
        zenith_angle = mars_time_to_solar_zenith(minutes, sol_length_minutes)
        lower_spectrum, lower_angle, upper_angle, angle_fraction, horizon_used, method = source_spectrum_for_time(
            zenith_angle,
            spectra_by_tau[source_tau_lower],
            angles_deg,
            horizon_method,
        )
        if math.isclose(source_tau_lower, source_tau_upper, rel_tol=0.0, abs_tol=1e-9):
            spectrum = lower_spectrum
            source_file = source_file_by_tau[source_tau_lower]
        else:
            upper_spectrum, _, _, _, _, _ = source_spectrum_for_time(
                zenith_angle,
                spectra_by_tau[source_tau_upper],
                angles_deg,
                horizon_method,
            )
            spectrum = lower_spectrum * (1.0 - tau_fraction) + upper_spectrum * tau_fraction
            source_file = (
                f"{source_file_by_tau[source_tau_lower]};"
                f"{source_file_by_tau[source_tau_upper]}"
            )
        spectrum = spectrum * float(irradiance_scale)
        integrated_irradiance = float(np.trapezoid(spectrum, wavelengths_nm))
        spectral_rows.append(spectrum)
        validation_rows.append(
            {
                "time_bin_minutes": minutes,
                "time_of_day": format_time_of_day(minutes),
                "normalized_mars_time": minutes / sol_length_minutes,
                "requested_tau": requested_tau,
                "source_tau_lower": source_tau_lower,
                "source_tau_upper": source_tau_upper,
                "tau_interpolation_fraction": tau_fraction,
                "solar_zenith_angle_deg": zenith_angle,
                "source_angle_lower": lower_angle,
                "source_angle_upper": upper_angle,
                "interpolation_fraction": angle_fraction,
                "horizon_approximation_used": bool(horizon_used),
                "spectrum_method": method,
                "source_file": source_file,
                "source_file_lower": source_file_by_tau[source_tau_lower],
                "source_file_upper": source_file_by_tau[source_tau_upper],
                "integrated_irradiance": integrated_irradiance,
            }
        )

    wavelength_columns = [str(int(wavelength)) if float(wavelength).is_integer() else f"{wavelength:g}" for wavelength in wavelengths_nm]
    metadata = pd.DataFrame(
        {
            "location_code": LOCATION_CODE,
            "location_name": LOCATION_NAME,
            "measurement_table": MEASUREMENT_TABLE,
            "month": MONTH,
            "month_name": MONTH_NAME,
            "time_bin_minutes": time_bins,
            "time_of_day": [format_time_of_day(minutes) for minutes in time_bins],
            "measurement_setup": scenario.measurement_setup,
            "sun_included": "TRUE",
            "patch": "",
            "patch_almucantar": "",
            "patch_azimuth": "",
            "samples_averaged": 1,
        }
    )
    spectra = pd.DataFrame(np.vstack(spectral_rows), columns=wavelength_columns)
    average_day = pd.concat([metadata, spectra], axis=1)
    validation = pd.DataFrame(validation_rows)

    return MarsDay(
        scenario_name=scenario.name,
        output_stem=scenario.output_stem,
        average_day=average_day,
        validation=validation,
        wavelengths_nm=wavelengths_nm,
        requested_tau=scenario.requested_tau,
        selected_tau=scenario.fixed_tau,
        tau_min=float(min(requested_tau_values)),
        tau_max=float(max(requested_tau_values)),
        dynamic_tau_profile=scenario.fixed_tau is None,
        measurement_setup=scenario.measurement_setup,
        horizon_method=horizon_method,
        sol_length_minutes=sol_length_minutes,
        irradiance_scale=float(irradiance_scale),
    )


def wavelength_columns(frame: pd.DataFrame) -> list[str]:
    result: list[tuple[str, float]] = []
    for column in frame.columns:
        try:
            result.append((str(column), float(column)))
        except (TypeError, ValueError):
            continue
    return [column for column, _ in sorted(result, key=lambda item: item[1])]


def validate_mars_average_day(day: MarsDay) -> dict[str, object]:
    frame = day.average_day
    validation = day.validation
    spectral_columns = wavelength_columns(frame)
    expected_rows = day.sol_length_minutes // TIME_BIN_MINUTES
    failures: list[str] = []

    if len(frame) != expected_rows:
        failures.append(f"row count {len(frame)} != expected {expected_rows}")
    if frame["time_of_day"].iloc[0] != "00:00":
        failures.append("first time_of_day is not 00:00")
    expected_last_time = format_time_of_day(day.sol_length_minutes - TIME_BIN_MINUTES)
    if frame["time_of_day"].iloc[-1] != expected_last_time:
        failures.append(f"last time_of_day is not {expected_last_time}")
    if len(spectral_columns) != len(day.wavelengths_nm):
        failures.append(
            f"wavelength column count {len(spectral_columns)} != expected {len(day.wavelengths_nm)}"
        )
    if frame["time_bin_minutes"].duplicated().any():
        failures.append("duplicated time_bin_minutes found")

    spectra = frame.loc[:, spectral_columns].to_numpy(dtype=float)
    if not np.isfinite(spectra).all():
        failures.append("missing or non-finite spectral values found")

    night_mask = validation["solar_zenith_angle_deg"].to_numpy(dtype=float) >= 90.0
    night_max = float(np.nanmax(np.abs(spectra[night_mask]))) if night_mask.any() else 0.0
    if night_max > 1e-12:
        failures.append(f"nighttime spectra are not zero; max abs value {night_max:.6g}")

    noon_minutes = day.sol_length_minutes // 2
    integrated = validation["integrated_irradiance"].to_numpy(dtype=float)
    max_index = int(np.nanargmax(integrated))
    max_time = int(validation["time_bin_minutes"].iloc[max_index])
    if not day.dynamic_tau_profile and abs(max_time - noon_minutes) > TIME_BIN_MINUTES:
        failures.append(
            f"maximum integrated irradiance occurs at {format_time_of_day(max_time)}, "
            f"not near noon {format_time_of_day(noon_minutes)}"
        )

    index_by_minutes = {
        int(minutes): index
        for index, minutes in enumerate(frame["time_bin_minutes"].to_numpy(dtype=int))
    }
    symmetry_diffs: list[float] = []
    for minutes, row_index in index_by_minutes.items():
        counterpart = day.sol_length_minutes - minutes
        if counterpart in index_by_minutes:
            symmetry_diffs.append(
                float(np.nanmax(np.abs(spectra[row_index] - spectra[index_by_minutes[counterpart]])))
            )
    max_symmetry_diff = max(symmetry_diffs) if symmetry_diffs else 0.0
    if not day.dynamic_tau_profile and max_symmetry_diff > 1e-10:
        failures.append(f"morning/afternoon symmetry max difference {max_symmetry_diff:.6g}")

    if failures:
        raise ValueError("Mars average-day validation failed: " + "; ".join(failures))

    return {
        "rows": len(frame),
        "first_time": frame["time_of_day"].iloc[0],
        "last_time": frame["time_of_day"].iloc[-1],
        "wavelength_columns": len(spectral_columns),
        "nighttime_bins": int(night_mask.sum()),
        "max_integrated_irradiance": float(integrated[max_index]),
        "max_integrated_time": format_time_of_day(max_time),
        "max_symmetry_difference": max_symmetry_diff,
        "nighttime_max_abs": night_max,
    }


def output_paths(output_dir: Path, output_stem: str) -> dict[str, Path]:
    stem = output_stem
    return {
        "average_day": output_dir / f"{stem}.csv",
        "validation": output_dir / f"{stem}_validation.csv",
        "report": output_dir / f"{stem}_report.md",
        "heatmap": output_dir / f"{stem}_spectral_heatmap.png",
        "selected_spectra": output_dir / f"{stem}_selected_spectra.png",
        "integrated": output_dir / f"{stem}_integrated_irradiance.png",
    }


def export_mars_average_day(day: MarsDay, output_dir: Path) -> dict[str, Path]:
    output_dir.mkdir(parents=True, exist_ok=True)
    paths = output_paths(output_dir, day.output_stem)
    spectral_columns = wavelength_columns(day.average_day)
    ordered_columns = METADATA_COLUMNS + spectral_columns
    day.average_day.loc[:, ordered_columns].to_csv(paths["average_day"], index=False)
    day.validation.to_csv(paths["validation"], index=False)
    return paths


def selected_plot_minutes(sol_length_minutes: int) -> list[int]:
    raw_minutes = [
        sol_length_minutes * 0.25,
        sol_length_minutes * 0.30,
        sol_length_minutes * 0.375,
        sol_length_minutes * 0.50,
        sol_length_minutes * 0.625,
        sol_length_minutes * 0.70,
        sol_length_minutes * 0.75,
    ]
    return [int(round(value / TIME_BIN_MINUTES) * TIME_BIN_MINUTES) for value in raw_minutes]


def plot_mars_day(day: MarsDay, paths: dict[str, Path]) -> None:
    spectral_columns = wavelength_columns(day.average_day)
    spectra = day.average_day.loc[:, spectral_columns].to_numpy(dtype=float)
    wavelengths_nm = np.asarray([float(column) for column in spectral_columns], dtype=float)
    hours = day.validation["time_bin_minutes"].to_numpy(dtype=float) / 60.0

    fig, ax = plt.subplots(figsize=(10, 6))
    image = ax.imshow(
        spectra,
        aspect="auto",
        origin="lower",
        extent=[wavelengths_nm.min(), wavelengths_nm.max(), hours.min(), hours.max()],
    )
    ax.set_xlabel("Wavelength (nm)")
    ax.set_ylabel("Mars local solar time (hours)")
    ax.set_title(f"Mars COMIMART spectral irradiance, {day.scenario_name}")
    fig.colorbar(image, ax=ax, label=SPECTRAL_UNITS)
    fig.tight_layout()
    fig.savefig(paths["heatmap"], dpi=180)
    plt.close(fig)

    fig, ax = plt.subplots(figsize=(10, 6))
    for minutes in selected_plot_minutes(day.sol_length_minutes):
        row = day.average_day.loc[day.average_day["time_bin_minutes"] == minutes]
        if row.empty:
            continue
        ax.plot(
            wavelengths_nm,
            row.loc[:, spectral_columns].iloc[0].to_numpy(dtype=float),
            label=format_time_of_day(minutes),
        )
    ax.set_xlabel("Wavelength (nm)")
    ax.set_ylabel(f"Spectral horizontal irradiance ({SPECTRAL_UNITS})")
    ax.set_title(f"Selected Mars spectra, {day.scenario_name}")
    ax.legend(title="Time")
    ax.grid(True, alpha=0.25)
    fig.tight_layout()
    fig.savefig(paths["selected_spectra"], dpi=180)
    plt.close(fig)

    fig, ax = plt.subplots(figsize=(10, 5))
    ax.plot(hours, day.validation["integrated_irradiance"].to_numpy(dtype=float))
    ax.set_xlabel("Mars local solar time (hours)")
    ax.set_ylabel(f"Integrated irradiance ({SPECTRAL_UNITS} nm)")
    ax.set_title(f"Integrated Mars irradiance, {day.scenario_name}")
    ax.grid(True, alpha=0.25)
    fig.tight_layout()
    fig.savefig(paths["integrated"], dpi=180)
    plt.close(fig)


def source_summary(inspection: SourceInspection) -> dict[str, object]:
    parsed_files = inspection.parsed_files
    all_values = np.concatenate([parsed.irradiance.ravel() for parsed in parsed_files])
    return {
        "files_found": len(parsed_files),
        "file_names": [parsed.path.name for parsed in parsed_files],
        "tau_min": float(min(parsed.tau for parsed in parsed_files)),
        "tau_max": float(max(parsed.tau for parsed in parsed_files)),
        "wavelength_min": float(parsed_files[0].wavelengths_nm.min()),
        "wavelength_max": float(parsed_files[0].wavelengths_nm.max()),
        "wavelength_interval": float(np.diff(parsed_files[0].wavelengths_nm).min()),
        "wavelength_count": len(parsed_files[0].wavelengths_nm),
        "angle_min": float(parsed_files[0].angles_deg.min()),
        "angle_max": float(parsed_files[0].angles_deg.max()),
        "angle_interval": float(np.diff(parsed_files[0].angles_deg).min()),
        "angle_count": len(parsed_files[0].angles_deg),
        "value_min": float(np.nanmin(all_values)),
        "value_max": float(np.nanmax(all_values)),
        "missing_values": int(np.isnan(all_values).sum()),
        "negative_values": int((all_values < 0).sum()),
        "duplicated_or_invalid_values": 0,
    }


def write_report(
    day: MarsDay,
    grid: MarsSpectralGrid,
    paths: dict[str, Path],
    validation_summary: dict[str, object],
    compatibility_summary: dict[str, object] | None,
) -> None:
    summary = source_summary(grid.inspection)
    requested_tau_text = tau_label(day.requested_tau) if day.requested_tau is not None else "dynamic profile"
    used_tau_text = tau_label(day.selected_tau) if day.selected_tau is not None else "interpolated per time bin"
    tau_profile_text = "dynamic" if day.dynamic_tau_profile else "fixed"
    tau_limitation = (
        "- Tau changes by the configured scenario profile and is linearly interpolated between source Tau files."
        if day.dynamic_tau_profile
        else "- Tau remains constant for the entire sol."
    )
    symmetry_limitation = (
        "- Solar geometry is symmetrical around noon, but the dynamic Tau profile can make irradiance asymmetric."
        if day.dynamic_tau_profile
        else "- Morning and afternoon are assumed symmetrical."
    )
    report_lines = [
        "# Mars COMIMART Sol Report",
        "",
        "## Source Inspection",
        f"- Files found: {summary['files_found']}",
        f"- Tau range: {summary['tau_min']:g}..{summary['tau_max']:g}",
        f"- Wavelength range: {summary['wavelength_min']:g}..{summary['wavelength_max']:g} nm",
        f"- Wavelength interval: {summary['wavelength_interval']:g} nm",
        f"- Solar zenith angles: {summary['angle_min']:g}..{summary['angle_max']:g} deg",
        f"- Angle interval: {summary['angle_interval']:g} deg",
        f"- Delimiter: {grid.inspection.delimiter}",
        f"- Spectral units: {grid.inspection.units}",
        f"- Absolute or normalized: {grid.inspection.absolute_or_normalized}",
        f"- Value range: {summary['value_min']:.8g}..{summary['value_max']:.8g}",
        f"- Missing values: {summary['missing_values']}",
        f"- Negative values: {summary['negative_values']}",
        f"- Duplicated or invalid values: {summary['duplicated_or_invalid_values']}",
        f"- Unit/source reference: {SOURCE_REFERENCE_URL}",
        "",
        "## Scenario",
        f"- Scenario: {day.scenario_name}",
        f"- Tau profile: {tau_profile_text}",
        f"- Requested Tau: {requested_tau_text}",
        f"- Used Tau: {used_tau_text}",
        f"- Tau range in output: {day.tau_min:g}..{day.tau_max:g}",
        f"- Irradiance scale applied: {day.irradiance_scale:g}",
        f"- Measurement setup: {day.measurement_setup}",
        f"- Sol length: {day.sol_length_minutes} minutes",
        f"- Horizon method: {day.horizon_method}",
        f"- Output time range: {validation_summary['first_time']}..{validation_summary['last_time']}",
        f"- Output rows: {validation_summary['rows']}",
        f"- Wavelength columns: {validation_summary['wavelength_columns']}",
        f"- Nighttime bins: {validation_summary['nighttime_bins']}",
        f"- Maximum integrated irradiance: {validation_summary['max_integrated_irradiance']:.8g} at {validation_summary['max_integrated_time']}",
        "",
        "## Files",
        f"- Main CSV: `{paths['average_day']}`",
        f"- Validation CSV: `{paths['validation']}`",
        f"- Heatmap: `{paths['heatmap']}`",
        f"- Selected spectra: `{paths['selected_spectra']}`",
        f"- Integrated irradiance: `{paths['integrated']}`",
        "",
        "## Compatibility",
    ]
    if compatibility_summary is None:
        report_lines.append("- Compatibility check skipped.")
    else:
        report_lines.extend(
            [
                f"- Target rows loaded: {compatibility_summary['target_rows']}",
                f"- Target wavelengths loaded: {compatibility_summary['target_wavelengths']}",
                f"- Calibration room: {compatibility_summary['room']}",
                f"- Calibration rows fitted: {compatibility_summary['calibration_rows']}",
                f"- Mean fit RMSE: {compatibility_summary['mean_fit_rmse']:.8g}",
            ]
        )

    report_lines.extend(
        [
            "",
            "## File Names",
            *[f"- {name}" for name in summary["file_names"]],
            "",
            "## Scientific Limitations",
            "- The spectra are generated by COMIMART and are not direct rover measurements.",
            f"- The output spectra are multiplied by an irradiance scale of {day.irradiance_scale:g}; use `--irradiance-scale 1.0` to export raw source magnitudes.",
            "- The source range ends at 830 nm.",
            f"- A Martian sol is represented as {day.sol_length_minutes} minutes on a 5-minute grid.",
            "- Solar zenith angles above 72 deg are approximated.",
            symmetry_limitation,
            tau_limitation,
            "- Latitude, season and surface albedo are fixed by the supplementary dataset.",
            "- Nighttime irradiance is set to zero.",
            "- One Tau file represents one possible atmospheric scenario, not a universal Mars average sol.",
            "",
            "## Warnings",
            *[f"- {warning}" for warning in grid.inspection.warnings],
        ]
    )

    paths["report"].write_text("\n".join(report_lines) + "\n", encoding="utf-8")


def run_compatibility_check(
    day: MarsDay,
    average_day_path: Path,
    *,
    calibration_room: str,
    calibration_dir: Path,
) -> dict[str, object]:
    target_day = load_city_average_day(
        average_day_path,
        month=MONTH,
        measurement_table=MEASUREMENT_TABLE,
        measurement_setup=day.measurement_setup,
        sun_included="true",
        fill_method="none",
        unit="photon",
    )
    if len(target_day.metadata) != day.sol_length_minutes // TIME_BIN_MINUTES:
        raise ValueError("load_city_average_day returned an unexpected row count")

    calibration = load_calibration_set(
        calibration_room,
        base_path=calibration_dir,
        unit="photon",
    )
    lamp_schedule = calibrate_target_day(
        target_day,
        calibration,
        min_wavelength=400,
        max_wavelength=830,
    )
    return {
        "target_rows": len(target_day.metadata),
        "target_wavelengths": len(target_day.wavelengths_nm),
        "room": calibration.room,
        "calibration_rows": len(lamp_schedule),
        "mean_fit_rmse": float(lamp_schedule["fit_rmse"].mean()),
    }


def run_scenario(
    grid: MarsSpectralGrid,
    scenario: MarsScenario,
    args: argparse.Namespace,
) -> tuple[MarsDay, dict[str, Path], dict[str, object], dict[str, object] | None]:
    day = create_mars_average_day(
        grid,
        scenario=scenario,
        horizon_method=args.horizon_method,
        min_wavelength=args.min_wavelength,
        max_wavelength=args.max_wavelength,
        sol_length_minutes=args.sol_length_minutes,
        irradiance_scale=args.irradiance_scale,
    )
    validation_summary = validate_mars_average_day(day)
    paths = export_mars_average_day(day, args.output_dir)
    plot_mars_day(day, paths)

    compatibility_summary = None
    if not args.skip_compatibility_check:
        compatibility_summary = run_compatibility_check(
            day,
            paths["average_day"],
            calibration_room=args.calibration_room,
            calibration_dir=args.calibration_dir,
        )

    write_report(
        day,
        grid,
        paths,
        validation_summary,
        compatibility_summary,
    )
    return day, paths, validation_summary, compatibility_summary


def batch_summary_row(
    day: MarsDay,
    paths: dict[str, Path],
    validation_summary: dict[str, object],
    compatibility_summary: dict[str, object] | None,
) -> dict[str, object]:
    validation = day.validation
    time_minutes = validation["time_bin_minutes"].to_numpy(dtype=float)
    integrated = validation["integrated_irradiance"].to_numpy(dtype=float)
    return {
        "scenario_name": day.scenario_name,
        "measurement_setup": day.measurement_setup,
        "output_csv_path": str(paths["average_day"]),
        "validation_csv_path": str(paths["validation"]),
        "min_tau": day.tau_min,
        "max_tau": day.tau_max,
        "max_integrated_irradiance": validation_summary["max_integrated_irradiance"],
        "max_time": validation_summary["max_integrated_time"],
        "daily_integrated_irradiance": float(np.trapezoid(integrated, time_minutes)),
        "daily_integrated_irradiance_units": "W m^-2 minute",
        "calibration_room": compatibility_summary["room"] if compatibility_summary else "",
        "calibration_rows": compatibility_summary["calibration_rows"] if compatibility_summary else "",
        "mean_fit_rmse": compatibility_summary["mean_fit_rmse"] if compatibility_summary else "",
    }


def write_batch_summary(rows: list[dict[str, object]], output_dir: Path) -> Path:
    path = output_dir / "Mars_Equator_Dust_Scenarios_Summary.csv"
    pd.DataFrame(rows).to_csv(path, index=False)
    return path


def plot_dust_scenario_comparison(days: Sequence[MarsDay], output_dir: Path) -> Path:
    path = output_dir / "Mars_Equator_Dust_Scenarios_Comparison.png"
    fig, (irradiance_ax, tau_ax) = plt.subplots(
        2,
        1,
        figsize=(11, 8),
        sharex=True,
        gridspec_kw={"height_ratios": [2.0, 1.0]},
    )

    for day in days:
        hours = day.validation["time_bin_minutes"].to_numpy(dtype=float) / 60.0
        integrated = day.validation["integrated_irradiance"].to_numpy(dtype=float)
        requested_tau = day.validation["requested_tau"].to_numpy(dtype=float)
        line_style = "--" if day.dynamic_tau_profile else "-"
        irradiance_ax.plot(hours, integrated, label=day.scenario_name)
        tau_ax.plot(hours, requested_tau, linestyle=line_style, label=day.scenario_name)

    irradiance_ax.set_ylabel(f"Integrated irradiance ({SPECTRAL_UNITS} nm)")
    irradiance_ax.set_title("Mars equator dust scenarios")
    irradiance_ax.grid(True, alpha=0.25)
    irradiance_ax.legend(loc="best", fontsize="small")

    tau_ax.set_xlabel("Mars local solar time (hours)")
    tau_ax.set_ylabel("Tau")
    tau_ax.grid(True, alpha=0.25)

    fig.tight_layout()
    fig.savefig(path, dpi=180)
    plt.close(fig)
    return path


def print_scenario_result(
    day: MarsDay,
    paths: dict[str, Path],
    validation_summary: dict[str, object],
    compatibility_summary: dict[str, object] | None,
) -> None:
    print(f"Scenario: {day.scenario_name}")
    print(f"Tau range: {day.tau_min:g}..{day.tau_max:g}")
    print(f"Output CSV path: {paths['average_day']}")
    print(
        "Maximum integrated irradiance: "
        f"{validation_summary['max_integrated_irradiance']:.8g} "
        f"at {validation_summary['max_integrated_time']}"
    )
    if compatibility_summary is None:
        print("Compatibility test result: skipped")
    else:
        print(
            "Compatibility test result: loaded target and fitted "
            f"{compatibility_summary['calibration_rows']} bins with "
            f"{compatibility_summary['room']}"
        )


def run_batch_defaults(grid: MarsSpectralGrid, args: argparse.Namespace) -> int:
    summary_rows: list[dict[str, object]] = []
    days: list[MarsDay] = []
    for scenario in default_batch_scenarios():
        print(f"Generating scenario: {scenario.name}")
        day, paths, validation_summary, compatibility_summary = run_scenario(
            grid,
            scenario,
            args,
        )
        days.append(day)
        summary_rows.append(
            batch_summary_row(day, paths, validation_summary, compatibility_summary)
        )
        print_scenario_result(day, paths, validation_summary, compatibility_summary)

    comparison_path = plot_dust_scenario_comparison(days, args.output_dir)
    summary_path = write_batch_summary(summary_rows, args.output_dir)
    print(f"Batch comparison graph: {comparison_path}")
    print(f"Batch summary CSV: {summary_path}")
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Create a Cities-compatible Mars average-sol CSV from COMIMART Tau files.",
    )
    parser.add_argument(
        "--source-dir",
        type=Path,
        required=True,
        help="Directory containing COMIMART_Simulation_tau_*.txt files.",
    )
    parser.add_argument(
        "--tau",
        type=float,
        default=0.3,
        help="Requested atmospheric dust opacity Tau for a single-scenario run. Nearest available Tau is used.",
    )
    parser.add_argument(
        "--batch-defaults",
        action="store_true",
        help="Generate the default clear, dusty and afternoon dust-storm Mars-equator scenarios.",
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=Path(__file__).resolve().parent / "outputs",
        help="Directory for the Mars CSV, diagnostics and plots.",
    )
    parser.add_argument(
        "--horizon-method",
        choices=("cosine-fade", "zero-after-72"),
        default="cosine-fade",
        help="How to approximate 72..90 degree solar zenith spectra.",
    )
    parser.add_argument(
        "--min-wavelength",
        type=float,
        default=300.0,
        help="Minimum wavelength to include in the output CSV.",
    )
    parser.add_argument(
        "--max-wavelength",
        type=float,
        default=830.0,
        help="Maximum wavelength to include in the output CSV.",
    )
    parser.add_argument(
        "--sol-length-minutes",
        type=int,
        default=DEFAULT_SOL_LENGTH_MINUTES,
        help="Length of the represented Martian sol in minutes.",
    )
    parser.add_argument(
        "--irradiance-scale",
        type=float,
        default=DEFAULT_IRRADIANCE_SCALE,
        help=(
            "Multiplicative scale applied to all source irradiance values. "
            "Default 0.5 keeps the exported Mars surface-light scenarios below the raw COMIMART magnitudes; "
            "use 1.0 for raw COMIMART magnitudes."
        ),
    )
    parser.add_argument(
        "--calibration-room",
        default="G7",
        help="Room calibration used for the compatibility fit check.",
    )
    parser.add_argument(
        "--calibration-dir",
        type=Path,
        default=DEFAULT_CALIBRATION_DIR,
        help=f"Directory containing Jeti calibration files (default: {DEFAULT_CALIBRATION_DIR}).",
    )
    parser.add_argument(
        "--skip-compatibility-check",
        action="store_true",
        help="Skip load_city_average_day and calibrate_target_day compatibility checks.",
    )
    return parser


def run(args: argparse.Namespace) -> int:
    grid = load_mars_spectral_grid(args.source_dir)
    summary = source_summary(grid.inspection)
    print(f"Source files found: {summary['files_found']}")
    print(f"Confirmed units: {grid.inspection.units}")

    if args.batch_defaults:
        result = run_batch_defaults(grid, args)
    else:
        selected_tau = nearest_available_tau(args.tau, grid.tau_values)
        scenario = single_tau_scenario(args.tau, selected_tau)
        day, paths, validation_summary, compatibility_summary = run_scenario(
            grid,
            scenario,
            args,
        )
        print(f"Requested Tau: {tau_label(args.tau)}")
        print(f"Used Tau: {tau_label(selected_tau)}")
        print(f"Irradiance scale applied: {day.irradiance_scale:g}")
        print(
            f"Wavelength range: {day.wavelengths_nm.min():g}..{day.wavelengths_nm.max():g} nm"
        )
        print(f"Number of wavelength columns: {len(day.wavelengths_nm)}")
        print(f"Number of output time bins: {validation_summary['rows']}")
        print(f"Number of nighttime bins: {validation_summary['nighttime_bins']}")
        print_scenario_result(day, paths, validation_summary, compatibility_summary)
        result = 0

    print("Warnings and approximations:")
    for warning in grid.inspection.warnings:
        print(f"- {warning}")
    if args.horizon_method == "cosine-fade":
        print("- Solar zenith angles between 72 and 90 deg use cosine-fade approximation.")
    else:
        print("- Solar zenith angles above 72 deg are set to zero.")
    return result


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()
    return run(args)


if __name__ == "__main__":
    raise SystemExit(main())
