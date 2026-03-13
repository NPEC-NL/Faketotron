from __future__ import annotations

import argparse
import csv
import os
import re
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Iterator, Mapping, Sequence

import pandas as pd

r"""
Utilities for the SKYSPECTRA-style city dataset stored in D:\Maarten\Alan_Cities.

Observed files on disk:
- spectral_horizontal_irradiance.csv
- spectral_direct_irradiance.csv
- spectral_patch_radiance.csv
- meta_location.csv
- meta_weather.csv
- meta_sun_positions.csv
- meta_measurement_parameters.csv

Not present in this folder:
- spectral_tilt_irradiance.csv

Join rules based on the actual CSV schema:
- location -> location_code
- weather -> location_code + timestamp + measurement_setup
- sun_positions -> location_code + timestamp + measurement_setup
- measurement_parameters -> location_code + measurement_setup

The package description often refers to timestamp_local and
spectral_direct_normal_irradiance. In the CSVs on disk those correspond to the
timestamp column and spectral_direct_irradiance.csv.
"""


DEFAULT_DATA_DIR = Path(os.environ.get("ALAN_CITIES_DATA_DIR", r"D:\Maarten\Alan_Cities"))

TIME_PARSE_PATTERN = re.compile(
    r"^(?P<datetime_part>\d{4}-\d{2}-\d{2} \d{2}:\d{2}(?::\d{2})?)(?: (?P<timezone_abbr>[A-Za-z]+))?$"
)
COORDINATE_PATTERN = re.compile(
    r"^\s*(?P<value>[+-]?\d+(?:\.\d+)?)\s*(?P<direction>[NSEW])?\s*$"
)

LOCATION_JOIN_KEYS = ["location_code"]
TIMESTAMP_JOIN_KEYS = ["location_code", "timestamp", "measurement_setup"]
PARAMETER_JOIN_KEYS = ["location_code", "measurement_setup"]
TIMESTAMP_HELPER_COLUMNS = {"timestamp_local", "timestamp_local_dt", "timezone_abbr"}

BOOLEAN_COLUMNS = {"industrial", "sun_included"}
NUMERIC_COLUMNS = {
    "altitude",
    "aperture_angle",
    "cct_direct",
    "cct_horizontal",
    "cct_patch",
    "detector_inclination",
    "global_horizontal_illuminance",
    "global_horizontal_irradiance",
    "patch",
    "patch_almucantar",
    "patch_azimuth",
    "solar_time",
    "spectral_direct_irradiance",
    "spectral_horizontal_irradiance",
    "spectral_patch_radiance",
    "sun_azimuth",
    "sun_elevation",
    "wavelength",
}


@dataclass(frozen=True)
class TableSpec:
    name: str
    filename: str
    category: str

    def path(self, data_dir: Path) -> Path:
        return data_dir / self.filename


TABLE_SPECS: dict[str, TableSpec] = {
    "spectral_horizontal_irradiance": TableSpec(
        name="spectral_horizontal_irradiance",
        filename="spectral_horizontal_irradiance.csv",
        category="measurement",
    ),
    "spectral_direct_irradiance": TableSpec(
        name="spectral_direct_irradiance",
        filename="spectral_direct_irradiance.csv",
        category="measurement",
    ),
    "spectral_patch_radiance": TableSpec(
        name="spectral_patch_radiance",
        filename="spectral_patch_radiance.csv",
        category="measurement",
    ),
    "location": TableSpec(
        name="location",
        filename="meta_location.csv",
        category="supplementary",
    ),
    "weather": TableSpec(
        name="weather",
        filename="meta_weather.csv",
        category="supplementary",
    ),
    "sun_positions": TableSpec(
        name="sun_positions",
        filename="meta_sun_positions.csv",
        category="supplementary",
    ),
    "measurement_parameters": TableSpec(
        name="measurement_parameters",
        filename="meta_measurement_parameters.csv",
        category="supplementary",
    ),
}

TABLE_ALIASES = {
    "horizontal": "spectral_horizontal_irradiance",
    "spectral_global_horizontal_irradiance": "spectral_horizontal_irradiance",
    "direct": "spectral_direct_irradiance",
    "spectral_direct_normal_irradiance": "spectral_direct_irradiance",
    "patch": "spectral_patch_radiance",
    "meta_location": "location",
    "meta_weather": "weather",
    "meta_sun_positions": "sun_positions",
    "meta_measurement_parameters": "measurement_parameters",
}


def resolve_data_dir(data_dir: str | Path | None = None) -> Path:
    base_dir = Path(data_dir) if data_dir is not None else DEFAULT_DATA_DIR
    if not base_dir.exists():
        raise FileNotFoundError(f"Data directory does not exist: {base_dir}")
    return base_dir


def resolve_table_name(table_name: str) -> str:
    normalized = table_name.strip().lower()
    if normalized in TABLE_ALIASES:
        return TABLE_ALIASES[normalized]
    if normalized in TABLE_SPECS:
        return normalized
    raise KeyError(
        f"Unknown table '{table_name}'. Available tables: {', '.join(sorted(TABLE_SPECS))}"
    )


def _parse_coordinate(value: object) -> float | None:
    if value is None or pd.isna(value):
        return None
    match = COORDINATE_PATTERN.match(str(value))
    if not match:
        return None

    magnitude = float(match.group("value"))
    direction = (match.group("direction") or "").upper()
    if direction in {"S", "W"}:
        return -magnitude
    return magnitude


def _normalize_frame(frame: pd.DataFrame, table_name: str) -> pd.DataFrame:
    normalized = frame.copy()
    normalized.columns = [column.strip() for column in normalized.columns]

    for key in {"location_code", "timestamp", "measurement_setup"} & set(normalized.columns):
        normalized[key] = normalized[key].astype("string").str.strip()

    for column in BOOLEAN_COLUMNS & set(normalized.columns):
        upper = normalized[column].astype("string").str.upper()
        normalized[column] = upper.map({"TRUE": True, "FALSE": False}).astype("boolean")

    for column in NUMERIC_COLUMNS & set(normalized.columns):
        if column == "solar_time":
            continue
        normalized[column] = pd.to_numeric(normalized[column], errors="coerce")

    if "timestamp" in normalized.columns:
        timestamp_strings = normalized["timestamp"].astype("string").str.strip()
        extracted = timestamp_strings.str.extract(TIME_PARSE_PATTERN)
        normalized["timestamp_local"] = timestamp_strings
        normalized["timestamp_local_dt"] = pd.to_datetime(
            extracted["datetime_part"], errors="coerce"
        )
        normalized["timezone_abbr"] = extracted["timezone_abbr"].astype("string")

    if "latitude" in normalized.columns:
        normalized["latitude_decimal"] = normalized["latitude"].map(_parse_coordinate)

    if "longitude" in normalized.columns:
        normalized["longitude_decimal"] = normalized["longitude"].map(_parse_coordinate)

    normalized.attrs["table_name"] = table_name
    return normalized


def load_table(
    table_name: str,
    data_dir: str | Path | None = None,
    *,
    usecols: Sequence[str] | None = None,
    nrows: int | None = None,
    chunksize: int | None = None,
) -> pd.DataFrame | Iterator[pd.DataFrame]:
    resolved_name = resolve_table_name(table_name)
    base_dir = resolve_data_dir(data_dir)
    spec = TABLE_SPECS[resolved_name]
    csv_path = spec.path(base_dir)
    if not csv_path.exists():
        raise FileNotFoundError(f"Table file does not exist: {csv_path}")

    reader = pd.read_csv(
        csv_path,
        dtype="string",
        low_memory=False,
        usecols=usecols,
        nrows=nrows,
        chunksize=chunksize,
    )
    if chunksize is None:
        return _normalize_frame(reader, resolved_name)
    return (_normalize_frame(chunk, resolved_name) for chunk in reader)


def load_supplementary_tables(
    data_dir: str | Path | None = None,
) -> dict[str, pd.DataFrame]:
    return {
        name: load_table(name, data_dir=data_dir)
        for name, spec in TABLE_SPECS.items()
        if spec.category == "supplementary"
    }


def _merge_ready(frame: pd.DataFrame, join_keys: Sequence[str]) -> pd.DataFrame:
    keep_columns = [
        column
        for column in frame.columns
        if column not in TIMESTAMP_HELPER_COLUMNS or column in join_keys
    ]
    return frame.loc[:, keep_columns]


def merge_measurement_frame(
    measurement_frame: pd.DataFrame,
    supplementary_tables: Mapping[str, pd.DataFrame],
) -> pd.DataFrame:
    merged = measurement_frame.copy()

    location = supplementary_tables["location"]
    weather = _merge_ready(supplementary_tables["weather"], TIMESTAMP_JOIN_KEYS)
    sun_positions = _merge_ready(supplementary_tables["sun_positions"], TIMESTAMP_JOIN_KEYS)
    parameters = supplementary_tables["measurement_parameters"]

    merged = merged.merge(
        location,
        on=LOCATION_JOIN_KEYS,
        how="left",
        validate="m:1",
    )
    merged = merged.merge(
        weather,
        on=TIMESTAMP_JOIN_KEYS,
        how="left",
        validate="m:1",
    )
    merged = merged.merge(
        sun_positions,
        on=TIMESTAMP_JOIN_KEYS,
        how="left",
        validate="m:1",
    )
    merged = merged.merge(
        parameters,
        on=PARAMETER_JOIN_KEYS,
        how="left",
        validate="m:1",
    )
    return merged


def merge_measurement_table(
    measurement_name: str,
    data_dir: str | Path | None = None,
    *,
    nrows: int | None = None,
) -> pd.DataFrame:
    measurement = load_table(measurement_name, data_dir=data_dir, nrows=nrows)
    if not isinstance(measurement, pd.DataFrame):
        raise TypeError("Expected an in-memory dataframe for merge_measurement_table")
    supplementary = load_supplementary_tables(data_dir=data_dir)
    return merge_measurement_frame(measurement, supplementary)


def iter_merged_measurement_chunks(
    measurement_name: str,
    data_dir: str | Path | None = None,
    *,
    chunksize: int = 250_000,
) -> Iterator[pd.DataFrame]:
    supplementary = load_supplementary_tables(data_dir=data_dir)
    measurement_chunks = load_table(
        measurement_name,
        data_dir=data_dir,
        chunksize=chunksize,
    )
    if isinstance(measurement_chunks, pd.DataFrame):
        raise TypeError("Expected chunked reader for iter_merged_measurement_chunks")
    for chunk in measurement_chunks:
        yield merge_measurement_frame(chunk, supplementary)


def summarize_table(table_name: str, data_dir: str | Path | None = None) -> dict[str, object]:
    resolved_name = resolve_table_name(table_name)
    base_dir = resolve_data_dir(data_dir)
    spec = TABLE_SPECS[resolved_name]
    csv_path = spec.path(base_dir)

    with csv_path.open("r", encoding="utf-8-sig", newline="") as handle:
        reader = csv.reader(handle)
        header = next(reader)
        row_count = 0
        location_codes: set[str] = set()
        setups: set[str] = set()

        location_index = header.index("location_code") if "location_code" in header else None
        setup_index = header.index("measurement_setup") if "measurement_setup" in header else None

        for row in reader:
            row_count += 1
            if location_index is not None and location_index < len(row):
                location_codes.add(row[location_index])
            if setup_index is not None and setup_index < len(row):
                setups.add(row[setup_index])

    return {
        "table": resolved_name,
        "file": spec.filename,
        "category": spec.category,
        "rows": row_count,
        "columns": header,
        "location_codes": sorted(code for code in location_codes if code),
        "measurement_setups": sorted(setup for setup in setups if setup),
    }


def dataset_summary(data_dir: str | Path | None = None) -> pd.DataFrame:
    rows: list[dict[str, object]] = []
    for table_name in TABLE_SPECS:
        summary = summarize_table(table_name, data_dir=data_dir)
        rows.append(
            {
                "table": summary["table"],
                "category": summary["category"],
                "rows": summary["rows"],
                "location_count": len(summary["location_codes"]),
                "locations": ", ".join(summary["location_codes"]),
                "setups": ", ".join(summary["measurement_setups"]) or "-",
                "file": summary["file"],
            }
        )
    return pd.DataFrame(rows)


def export_merged_measurement_csv(
    measurement_name: str,
    output_path: str | Path,
    data_dir: str | Path | None = None,
    *,
    chunksize: int = 250_000,
) -> Path:
    destination = Path(output_path)
    destination.parent.mkdir(parents=True, exist_ok=True)
    if destination.exists():
        destination.unlink()

    wrote_anything = False
    for index, merged_chunk in enumerate(
        iter_merged_measurement_chunks(measurement_name, data_dir=data_dir, chunksize=chunksize)
    ):
        merged_chunk.to_csv(destination, index=False, mode="a", header=index == 0)
        wrote_anything = True

    if not wrote_anything:
        raise RuntimeError(f"No rows were written for {measurement_name}")
    return destination


def _print_frame_preview(frame: pd.DataFrame, rows: int) -> None:
    print(f"shape={frame.shape}")
    print("columns=" + ", ".join(frame.columns))
    print()
    print(frame.head(rows).to_string(index=False))


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Inspect and merge the Alan_Cities CSV dataset.")
    parser.add_argument(
        "--data-dir",
        default=str(DEFAULT_DATA_DIR),
        help=f"Dataset directory (default: {DEFAULT_DATA_DIR})",
    )

    subparsers = parser.add_subparsers(dest="command", required=True)

    summary_parser = subparsers.add_parser("summary", help="Print row counts and table coverage.")
    summary_parser.add_argument(
        "--data-dir",
        default=str(DEFAULT_DATA_DIR),
        help=f"Dataset directory (default: {DEFAULT_DATA_DIR})",
    )

    show_parser = subparsers.add_parser("show", help="Preview a raw or merged table.")
    show_parser.add_argument(
        "--data-dir",
        default=str(DEFAULT_DATA_DIR),
        help=f"Dataset directory (default: {DEFAULT_DATA_DIR})",
    )
    show_parser.add_argument("table", help="Table name or alias.")
    show_parser.add_argument("--rows", type=int, default=5, help="Number of rows to print.")
    show_parser.add_argument(
        "--nrows",
        type=int,
        default=5,
        help="Number of rows to load before previewing.",
    )
    show_parser.add_argument(
        "--merged",
        action="store_true",
        help="Merge a measurement table with supplementary metadata before previewing.",
    )

    merge_parser = subparsers.add_parser(
        "merge",
        help="Merge a measurement table with metadata. Use --output for large tables.",
    )
    merge_parser.add_argument(
        "--data-dir",
        default=str(DEFAULT_DATA_DIR),
        help=f"Dataset directory (default: {DEFAULT_DATA_DIR})",
    )
    merge_parser.add_argument("table", help="Measurement table name or alias.")
    merge_parser.add_argument(
        "--nrows",
        type=int,
        default=None,
        help="Load only the first N rows into memory and print a preview.",
    )
    merge_parser.add_argument(
        "--output",
        type=Path,
        default=None,
        help="Write merged CSV output. Recommended for large tables.",
    )
    merge_parser.add_argument(
        "--chunksize",
        type=int,
        default=250_000,
        help="Chunk size for streamed CSV export.",
    )

    return parser


def run_summary(data_dir: str | Path) -> int:
    summary = dataset_summary(data_dir=data_dir)
    print(summary.to_string(index=False))
    return 0


def run_show(args: argparse.Namespace) -> int:
    table_name = resolve_table_name(args.table)
    if args.merged:
        if TABLE_SPECS[table_name].category != "measurement":
            raise ValueError("--merged can only be used with measurement tables")
        frame = merge_measurement_table(table_name, data_dir=args.data_dir, nrows=args.nrows)
    else:
        frame = load_table(table_name, data_dir=args.data_dir, nrows=args.nrows)
        if not isinstance(frame, pd.DataFrame):
            raise TypeError("show expects an in-memory dataframe")

    _print_frame_preview(frame, args.rows)
    return 0


def run_merge(args: argparse.Namespace) -> int:
    table_name = resolve_table_name(args.table)
    if TABLE_SPECS[table_name].category != "measurement":
        raise ValueError("merge only supports measurement tables")

    if args.output is not None:
        output_path = export_merged_measurement_csv(
            table_name,
            args.output,
            data_dir=args.data_dir,
            chunksize=args.chunksize,
        )
        print(f"Wrote merged CSV to {output_path}")
        return 0

    if args.nrows is None:
        raise ValueError("Use --nrows for in-memory preview, or --output for full streamed export.")

    frame = merge_measurement_table(table_name, data_dir=args.data_dir, nrows=args.nrows)
    _print_frame_preview(frame, rows=min(5, len(frame)))
    return 0


def main(argv: Sequence[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)

    try:
        if args.command == "summary":
            return run_summary(args.data_dir)
        if args.command == "show":
            return run_show(args)
        if args.command == "merge":
            return run_merge(args)
    except Exception as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 1

    parser.print_help()
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
