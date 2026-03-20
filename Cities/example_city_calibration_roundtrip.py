from __future__ import annotations

import argparse
from dataclasses import dataclass
from pathlib import Path
from typing import Sequence

import pandas as pd

try:
    from .Cities import find_average_day_csv, resolve_average_day_output_dir
    from .calibrate import (
        DEFAULT_CALIBRATION_DIR,
        DEFAULT_MEASUREMENT_TABLE,
        calibrate_target_day,
        load_calibration_set,
        load_city_average_day,
        reconstruct_schedule_spectra,
        target_day_to_spectra_frame,
    )
    from .plot_spectra import plot_spectra_frame
except ImportError:
    from Cities import find_average_day_csv, resolve_average_day_output_dir
    from calibrate import (
        DEFAULT_CALIBRATION_DIR,
        DEFAULT_MEASUREMENT_TABLE,
        calibrate_target_day,
        load_calibration_set,
        load_city_average_day,
        reconstruct_schedule_spectra,
        target_day_to_spectra_frame,
    )
    from plot_spectra import plot_spectra_frame


@dataclass(frozen=True)
class ExampleCase:
    location_name: str
    month: int
    month_name: str


EXAMPLE_CASES = (
    ExampleCase(location_name="Singapore", month=5, month_name="May"),
    ExampleCase(location_name="Berlin", month=6, month_name="June"),
)
PREFERRED_MEASUREMENT_TABLES = (
    "spectral_horizontal_irradiance",
    "spectral_direct_irradiance",
    "spectral_patch_radiance",
)
SLICE_DIMENSION_COLUMNS = (
    "measurement_setup",
    "sun_included",
    "patch",
    "patch_almucantar",
    "patch_azimuth",
)


def _normalize_sun_value(value: object) -> str:
    normalized = str(value).strip().lower()
    if normalized == "1":
        return "true"
    if normalized == "0":
        return "false"
    return normalized


def _choose_single_value(values: Sequence[str], *, preferred: Sequence[str] = ()) -> str | None:
    cleaned = [str(value).strip() for value in values if str(value).strip()]
    if not cleaned:
        return None

    unique_values = sorted(set(cleaned), key=str.lower)
    lookup = {value.lower(): value for value in unique_values}
    for preferred_value in preferred:
        if preferred_value.lower() in lookup:
            return lookup[preferred_value.lower()]
    return unique_values[0]


def _normalize_dimension_value(column: str, value: object) -> str:
    normalized = str(value).strip()
    if not normalized or normalized.lower() == "nan":
        return ""
    if column == "sun_included":
        return _normalize_sun_value(normalized)
    return normalized


def _apply_preview_filter(
    frame: pd.DataFrame,
    column: str,
    selected_value: str | None,
) -> pd.DataFrame:
    if selected_value is None or column not in frame.columns:
        return frame

    normalized_series = frame[column].map(lambda value: _normalize_dimension_value(column, value))
    comparison = _normalize_dimension_value(column, selected_value)
    return frame.loc[normalized_series == comparison].copy()


def _best_valid_slice(frame: pd.DataFrame) -> dict[str, str | None]:
    working = frame.copy()
    dimension_columns = [column for column in SLICE_DIMENSION_COLUMNS if column in working.columns]
    normalized_columns: list[str] = []
    for column in dimension_columns:
        normalized_column = f"__norm_{column}"
        working[normalized_column] = working[column].map(
            lambda value, dimension=column: _normalize_dimension_value(dimension, value)
        )
        normalized_columns.append(normalized_column)

    if normalized_columns:
        grouped = (
            working.groupby(normalized_columns, dropna=False, sort=False)
            .agg(
                row_count=("time_bin_minutes", "size"),
                unique_bins=("time_bin_minutes", "nunique"),
            )
            .reset_index()
        )
    else:
        grouped = pd.DataFrame([{"row_count": len(working), "unique_bins": working["time_bin_minutes"].nunique()}])

    valid_groups = grouped.loc[grouped["row_count"] == grouped["unique_bins"]].copy()
    if valid_groups.empty:
        raise ValueError(
            "No unique measurement slice remained after filtering. "
            "The city/month/table combination still contains overlapping spectra per time bin."
        )

    if "__norm_sun_included" in valid_groups.columns:
        valid_groups["_sun_priority"] = valid_groups["__norm_sun_included"].map(
            {"true": 0, "false": 1, "": 2}
        ).fillna(3)
    else:
        valid_groups["_sun_priority"] = 0

    sort_columns = ["unique_bins", "_sun_priority", "row_count", *normalized_columns]
    ascending = [False, True, False, *([True] * len(normalized_columns))]
    valid_groups = valid_groups.sort_values(sort_columns, ascending=ascending, kind="stable")
    best_group = valid_groups.iloc[0]

    result: dict[str, str | None] = {}
    for column, normalized_column in zip(dimension_columns, normalized_columns, strict=True):
        value = str(best_group[normalized_column]).strip()
        result[column] = value or None
    return result


def _resolve_case_filters(
    city_file: Path,
    *,
    month: int,
    measurement_table: str,
    measurement_setup: str | None,
    sun_included: str | None,
    patch: str | None,
    patch_almucantar: str | None,
    patch_azimuth: str | None,
) -> tuple[str, str | None, str | None, str | None, str | None, str | None]:
    preview = pd.read_csv(city_file)
    monthly = preview.loc[preview["month"] == month].copy()
    if monthly.empty:
        raise ValueError(f"No rows remain in {city_file.name} for month={month}")

    if "measurement_table" in monthly.columns:
        available_tables = [
            value
            for value in monthly["measurement_table"].astype("string").fillna("").str.strip().tolist()
            if value
        ]
        table_candidates = (
            list(dict.fromkeys([*PREFERRED_MEASUREMENT_TABLES, *available_tables]))
            if measurement_table == "auto"
            else [measurement_table]
        )
    else:
        table_candidates = [measurement_table]

    for selected_measurement_table in table_candidates:
        filtered = monthly.copy()
        if "measurement_table" in filtered.columns:
            filtered = filtered.loc[
                filtered["measurement_table"].astype("string").fillna("").str.strip()
                == selected_measurement_table
            ].copy()
        if filtered.empty:
            continue

        filtered = _apply_preview_filter(filtered, "measurement_setup", measurement_setup)
        filtered = _apply_preview_filter(filtered, "sun_included", sun_included)
        filtered = _apply_preview_filter(filtered, "patch", patch)
        filtered = _apply_preview_filter(filtered, "patch_almucantar", patch_almucantar)
        filtered = _apply_preview_filter(filtered, "patch_azimuth", patch_azimuth)
        if filtered.empty:
            continue

        try:
            best_slice = _best_valid_slice(filtered)
        except ValueError:
            continue

        return (
            selected_measurement_table,
            best_slice.get("measurement_setup"),
            best_slice.get("sun_included"),
            best_slice.get("patch"),
            best_slice.get("patch_almucantar"),
            best_slice.get("patch_azimuth"),
        )

    raise ValueError(
        f"No unique measurement slice was found in {city_file.name} for month={month}. "
        "Try specifying --measurement-table/--measurement-setup/--sun-included/"
        "--patch/--patch-almucantar/--patch-azimuth explicitly."
    )


def _case_slug(location_name: str, month_name: str, room: str) -> str:
    slug = f"{location_name}_{month_name}_{room}"
    return "".join(character if character.isalnum() or character in "._-" else "_" for character in slug)


def run_example_case(
    example_case: ExampleCase,
    *,
    room: str,
    average_day_dir: Path,
    output_dir: Path,
    calibration_dir: Path,
    measurement_table: str,
    measurement_setup: str | None,
    sun_included: str | None,
    patch: str | None,
    patch_almucantar: str | None,
    patch_azimuth: str | None,
    fill_method: str,
    unit: str,
):
    city_file = find_average_day_csv(example_case.location_name, output_dir=average_day_dir)
    (
        selected_measurement_table,
        selected_setup,
        selected_sun,
        selected_patch,
        selected_patch_almucantar,
        selected_patch_azimuth,
    ) = _resolve_case_filters(
        city_file,
        month=example_case.month,
        measurement_table=measurement_table,
        measurement_setup=measurement_setup,
        sun_included=sun_included,
        patch=patch,
        patch_almucantar=patch_almucantar,
        patch_azimuth=patch_azimuth,
    )

    calibration = load_calibration_set(room, base_path=calibration_dir, unit=unit)
    target_day = load_city_average_day(
        city_file,
        month=example_case.month,
        measurement_table=selected_measurement_table,
        measurement_setup=selected_setup,
        sun_included=selected_sun,
        patch=selected_patch,
        patch_almucantar=selected_patch_almucantar,
        patch_azimuth=selected_patch_azimuth,
        fill_method=fill_method,
        unit=unit,
    )
    lamp_schedule = calibrate_target_day(target_day, calibration)
    reconstructed_frame = reconstruct_schedule_spectra(
        lamp_schedule,
        calibration,
        output_wavelengths_nm=target_day.wavelengths_nm,
    )
    target_frame = target_day_to_spectra_frame(target_day)

    output_dir.mkdir(parents=True, exist_ok=True)
    case_slug = _case_slug(example_case.location_name, target_day.month_name, room)

    target_csv_path = output_dir / f"{case_slug}_target_spectra.csv"
    lamp_schedule_path = output_dir / f"{case_slug}_lamp_percentages.csv"
    reconstructed_csv_path = output_dir / f"{case_slug}_reconstructed_spectra.csv"
    target_plot_path = output_dir / f"{case_slug}_target.png"
    reconstructed_plot_path = output_dir / f"{case_slug}_reconstructed.png"

    target_frame.to_csv(target_csv_path, index=False)
    lamp_schedule.to_csv(lamp_schedule_path, index=False)
    reconstructed_frame.to_csv(reconstructed_csv_path, index=False)

    plot_spectra_frame(
        target_frame,
        target_plot_path,
        title=f"Target spectral intensity over a day for {example_case.location_name} - {target_day.month_name}",
    )
    plot_spectra_frame(
        reconstructed_frame,
        reconstructed_plot_path,
        title=(
            f"Reconstructed {room} spectral intensity over a day for "
            f"{example_case.location_name} - {target_day.month_name}"
        ),
    )

    fit_rmse = float(lamp_schedule["fit_rmse"].mean()) if "fit_rmse" in lamp_schedule.columns else float("nan")
    print(
        f"{example_case.location_name} {target_day.month_name}: "
        f"measurement_table={selected_measurement_table}, "
        f"setup={selected_setup or '<auto/blank>'}, "
        f"sun_included={selected_sun or '<auto/blank>'}, "
        f"patch={selected_patch or '<auto/blank>'}, "
        f"patch_almucantar={selected_patch_almucantar or '<auto/blank>'}, "
        f"patch_azimuth={selected_patch_azimuth or '<auto/blank>'}, "
        f"rows={len(lamp_schedule)}, mean_fit_rmse={fit_rmse:.4f}"
    )
    print(f"  lamp percentages: {lamp_schedule_path}")
    print(f"  reconstructed spectra: {reconstructed_csv_path}")
    print(f"  reconstructed plot: {reconstructed_plot_path}")

    return {
        "location_name": example_case.location_name,
        "month": example_case.month,
        "month_name": target_day.month_name,
        "room": room,
        "city_file": str(city_file),
        "measurement_table": selected_measurement_table,
        "measurement_setup": selected_setup or "",
        "sun_included": selected_sun or "",
        "patch": selected_patch or "",
        "patch_almucantar": selected_patch_almucantar or "",
        "patch_azimuth": selected_patch_azimuth or "",
        "rows": len(lamp_schedule),
        "mean_fit_rmse": fit_rmse,
        "lamp_schedule_csv": str(lamp_schedule_path),
        "reconstructed_spectra_csv": str(reconstructed_csv_path),
        "reconstructed_plot": str(reconstructed_plot_path),
    }


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description=(
            "Example round-trip for Singapore May and Berlin June: "
            "city spectra -> lamp percentages -> reconstructed spectra -> plots."
        )
    )
    parser.add_argument(
        "--average-day-dir",
        type=Path,
        default=None,
        help=(
            "Directory containing per-city '*_average_day_by_month*.csv' files. "
            "Defaults to ALAN_CITIES_AVERAGE_DAY_DIR or the Cities.py default output directory."
        ),
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=Path(__file__).resolve().parent / "example_outputs",
        help="Directory where CSVs and plots will be written.",
    )
    parser.add_argument(
        "--room",
        default="G7",
        help="Room calibration to use for the lamp fit (default: G7).",
    )
    parser.add_argument(
        "--measurement-table",
        default="auto",
        help=(
            "Measurement table to load from the city CSVs. "
            f"Use 'auto' to prefer {DEFAULT_MEASUREMENT_TABLE} and fall back to another available table."
        ),
    )
    parser.add_argument(
        "--measurement-setup",
        default=None,
        help="Optional measurement_setup filter. If omitted, the script auto-selects one value per case.",
    )
    parser.add_argument(
        "--sun-included",
        choices=("auto", "true", "false"),
        default="auto",
        help="Optional sun_included filter. 'auto' prefers true when multiple values exist.",
    )
    parser.add_argument(
        "--patch",
        default=None,
        help="Optional patch filter for spectral_patch_radiance data.",
    )
    parser.add_argument(
        "--patch-almucantar",
        default=None,
        help="Optional patch_almucantar filter for spectral_patch_radiance data.",
    )
    parser.add_argument(
        "--patch-azimuth",
        default=None,
        help="Optional patch_azimuth filter for spectral_patch_radiance data.",
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
        help="Unit used for calibration and reconstruction.",
    )
    parser.add_argument(
        "--calibration-dir",
        type=Path,
        default=DEFAULT_CALIBRATION_DIR,
        help=f"Directory containing the Jeti calibration files (default: {DEFAULT_CALIBRATION_DIR}).",
    )
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)

    try:
        average_day_dir = resolve_average_day_output_dir(args.average_day_dir)
        selected_sun = None if args.sun_included == "auto" else args.sun_included

        rows = [
            run_example_case(
                example_case,
                room=args.room,
                average_day_dir=average_day_dir,
                output_dir=args.output_dir,
                calibration_dir=args.calibration_dir,
                measurement_table=args.measurement_table,
                measurement_setup=args.measurement_setup,
                sun_included=selected_sun,
                patch=args.patch,
                patch_almucantar=args.patch_almucantar,
                patch_azimuth=args.patch_azimuth,
                fill_method=args.fill_method,
                unit=args.unit,
            )
            for example_case in EXAMPLE_CASES
        ]

        summary_path = args.output_dir / f"example_summary_{args.room}.csv"
        pd.DataFrame(rows).to_csv(summary_path, index=False)
        print(f"Summary: {summary_path}")
        return 0
    except Exception as exc:
        print(f"Error: {exc}")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
