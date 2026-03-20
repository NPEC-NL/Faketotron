from __future__ import annotations

import argparse
import calendar
import csv
import os
import re
import sqlite3
import sys
import tempfile
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
    r"^(?P<datetime_part>\d{4}-\d{2}-\d{2} \d{2}:\d{2}(?::\d{2})?)(?: (?P<timezone_abbr>[A-Za-z]+|[+-]\d{2}(?::?\d{2})?))?$"
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

DEFAULT_AVERAGE_DAY_OUTPUT_SUBDIR = "Per_City_Per_Month_Output"
MEASUREMENT_TABLE_NAMES = tuple(
    table_name for table_name, spec in TABLE_SPECS.items() if spec.category == "measurement"
)
AVERAGE_DAY_DIMENSION_COLUMNS = (
    "measurement_setup",
    "sun_included",
    "patch",
    "patch_almucantar",
    "patch_azimuth",
)
AVERAGE_DAY_BASE_COLUMNS = [
    "location_code",
    "location_name",
    "measurement_table",
    "month",
    "month_name",
    "time_bin_minutes",
    "time_of_day",
    *AVERAGE_DAY_DIMENSION_COLUMNS,
]


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


def resolve_measurement_table_names(table_names: Sequence[str] | None = None) -> list[str]:
    if not table_names:
        return list(MEASUREMENT_TABLE_NAMES)

    resolved_names: list[str] = []
    for table_name in table_names:
        resolved_name = resolve_table_name(table_name)
        if TABLE_SPECS[resolved_name].category != "measurement":
            raise ValueError(f"Table '{table_name}' is not a measurement table")
        if resolved_name not in resolved_names:
            resolved_names.append(resolved_name)
    return resolved_names


def default_average_day_output_dir(data_dir: str | Path | None = None) -> Path:
    return resolve_data_dir(data_dir) / DEFAULT_AVERAGE_DAY_OUTPUT_SUBDIR


def resolve_average_day_output_dir(
    output_dir: str | Path | None = None,
    *,
    data_dir: str | Path | None = None,
) -> Path:
    if output_dir is not None:
        resolved = Path(output_dir)
    else:
        env_output_dir = os.environ.get("ALAN_CITIES_AVERAGE_DAY_DIR")
        if env_output_dir:
            resolved = Path(env_output_dir)
        else:
            resolved = default_average_day_output_dir(data_dir)

    if not resolved.exists():
        raise FileNotFoundError(f"Average-day output directory does not exist: {resolved}")
    return resolved


def _normalize_lookup_text(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", value.lower())


def find_average_day_csv(
    location_name: str,
    *,
    output_dir: str | Path | None = None,
    data_dir: str | Path | None = None,
) -> Path:
    search_dir = resolve_average_day_output_dir(output_dir, data_dir=data_dir)
    target = _normalize_lookup_text(location_name)
    matches = sorted(search_dir.glob("*_average_day_by_month*.csv"))
    filtered = [path for path in matches if target in _normalize_lookup_text(path.stem)]

    if not filtered:
        raise FileNotFoundError(
            f"No average-day CSV matched location '{location_name}' in {search_dir}"
        )
    if len(filtered) > 1:
        raise ValueError(
            f"Multiple average-day CSV files matched location '{location_name}': "
            + ", ".join(str(path.name) for path in filtered)
        )
    return filtered[0]


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


def collect_table_summaries(data_dir: str | Path | None = None) -> list[dict[str, object]]:
    return [summarize_table(table_name, data_dir=data_dir) for table_name in TABLE_SPECS]


def dataset_summary(
    data_dir: str | Path | None = None,
    *,
    summaries: Sequence[Mapping[str, object]] | None = None,
) -> pd.DataFrame:
    table_summaries = list(summaries) if summaries is not None else collect_table_summaries(data_dir)
    rows: list[dict[str, object]] = []
    for summary in table_summaries:
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


def show_choices_summary() -> pd.DataFrame:
    rows: list[dict[str, str]] = []
    aliases_by_table: dict[str, list[str]] = {table_name: [] for table_name in TABLE_SPECS}
    for alias, table_name in TABLE_ALIASES.items():
        aliases_by_table.setdefault(table_name, []).append(alias)

    for table_name, spec in TABLE_SPECS.items():
        aliases = ", ".join(sorted(aliases_by_table.get(table_name, []))) or "-"
        rows.append(
            {
                "show_name": table_name,
                "category": spec.category,
                "supports_merged": "yes" if spec.category == "measurement" else "no",
                "aliases": aliases,
            }
        )
    return pd.DataFrame(rows)


def _read_table_columns(table_name: str, data_dir: str | Path | None = None) -> list[str]:
    resolved_name = resolve_table_name(table_name)
    csv_path = TABLE_SPECS[resolved_name].path(resolve_data_dir(data_dir))
    header = pd.read_csv(csv_path, dtype="string", low_memory=False, nrows=0)
    return [str(column).strip() for column in header.columns]


def _average_day_usecols(table_name: str, data_dir: str | Path | None = None) -> list[str]:
    resolved_name = resolve_table_name(table_name)
    available_columns = set(_read_table_columns(resolved_name, data_dir=data_dir))
    required_columns = ["location_code", "timestamp", "wavelength", resolved_name]
    optional_columns = [
        column for column in AVERAGE_DAY_DIMENSION_COLUMNS if column in available_columns
    ]
    return required_columns + optional_columns


def _string_dimension_values(frame: pd.DataFrame, column: str) -> pd.Series:
    if column not in frame.columns:
        return pd.Series("", index=frame.index, dtype="string")

    normalized = frame[column].astype("string").fillna("").str.strip()
    if column == "sun_included":
        return normalized.str.upper()
    return normalized


def _format_time_of_day(total_minutes: int) -> str:
    hours = total_minutes // 60
    minutes = total_minutes % 60
    return f"{hours:02d}:{minutes:02d}"


def _format_wavelength_column_name(value: object) -> str:
    wavelength = float(value)
    if wavelength.is_integer():
        return str(int(wavelength))
    return format(wavelength, "g")


def _sanitize_filename_component(value: str) -> str:
    sanitized = re.sub(r"[^A-Za-z0-9._-]+", "_", value.strip())
    return sanitized.strip("._") or "unknown"


def _prepare_average_day_chunk(
    frame: pd.DataFrame,
    measurement_table: str,
    *,
    bin_minutes: int,
) -> pd.DataFrame:
    spectral_column = measurement_table
    working = frame.copy()
    working["location_code"] = working["location_code"].astype("string").fillna("").str.strip()

    valid_mask = (
        working["location_code"].ne("")
        & working["timestamp_local_dt"].notna()
        & working["wavelength"].notna()
        & working[spectral_column].notna()
    )
    working = working.loc[valid_mask].copy()
    if working.empty:
        return pd.DataFrame(
            columns=[
                "measurement_table",
                "location_code",
                "month",
                "time_bin_minutes",
                *AVERAGE_DAY_DIMENSION_COLUMNS,
                "wavelength",
                "spectral_sum",
                "sample_count",
            ]
        )

    for column in AVERAGE_DAY_DIMENSION_COLUMNS:
        working[column] = _string_dimension_values(working, column)

    total_seconds = (
        working["timestamp_local_dt"].dt.hour.astype("int64") * 3600
        + working["timestamp_local_dt"].dt.minute.astype("int64") * 60
        + working["timestamp_local_dt"].dt.second.astype("int64")
    )
    bin_seconds = bin_minutes * 60
    working["month"] = working["timestamp_local_dt"].dt.month.astype("int64")
    working["time_bin_minutes"] = ((total_seconds // bin_seconds) * bin_minutes).astype("int64")

    grouping_columns = [
        "location_code",
        "month",
        "time_bin_minutes",
        *AVERAGE_DAY_DIMENSION_COLUMNS,
        "wavelength",
    ]
    grouped = (
        working.groupby(grouping_columns, dropna=False, sort=False)[spectral_column]
        .agg(spectral_sum="sum", sample_count="count")
        .reset_index()
    )
    grouped.insert(0, "measurement_table", measurement_table)
    return grouped


def _create_average_day_database() -> tuple[sqlite3.Connection, Path]:
    handle, temp_path_str = tempfile.mkstemp(prefix="alan_cities_average_day_", suffix=".sqlite3")
    os.close(handle)
    temp_path = Path(temp_path_str)

    connection = sqlite3.connect(temp_path)
    connection.execute("PRAGMA journal_mode = WAL")
    connection.execute("PRAGMA synchronous = NORMAL")
    connection.execute("PRAGMA temp_store = MEMORY")
    connection.execute(
        """
        CREATE TABLE average_day_aggregates (
            measurement_table TEXT NOT NULL,
            location_code TEXT NOT NULL,
            month INTEGER NOT NULL,
            time_bin_minutes INTEGER NOT NULL,
            measurement_setup TEXT NOT NULL,
            sun_included TEXT NOT NULL,
            patch TEXT NOT NULL,
            patch_almucantar TEXT NOT NULL,
            patch_azimuth TEXT NOT NULL,
            wavelength REAL NOT NULL,
            spectral_sum REAL NOT NULL,
            sample_count INTEGER NOT NULL,
            PRIMARY KEY (
                measurement_table,
                location_code,
                month,
                time_bin_minutes,
                measurement_setup,
                sun_included,
                patch,
                patch_almucantar,
                patch_azimuth,
                wavelength
            )
        ) WITHOUT ROWID
        """
    )
    return connection, temp_path


def _insert_average_day_groups(connection: sqlite3.Connection, grouped: pd.DataFrame) -> None:
    if grouped.empty:
        return

    statement = """
        INSERT INTO average_day_aggregates (
            measurement_table,
            location_code,
            month,
            time_bin_minutes,
            measurement_setup,
            sun_included,
            patch,
            patch_almucantar,
            patch_azimuth,
            wavelength,
            spectral_sum,
            sample_count
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (
            measurement_table,
            location_code,
            month,
            time_bin_minutes,
            measurement_setup,
            sun_included,
            patch,
            patch_almucantar,
            patch_azimuth,
            wavelength
        ) DO UPDATE SET
            spectral_sum = spectral_sum + excluded.spectral_sum,
            sample_count = sample_count + excluded.sample_count
    """

    records = (
        (
            str(row.measurement_table),
            str(row.location_code),
            int(row.month),
            int(row.time_bin_minutes),
            str(row.measurement_setup),
            str(row.sun_included),
            str(row.patch),
            str(row.patch_almucantar),
            str(row.patch_azimuth),
            float(row.wavelength),
            float(row.spectral_sum),
            int(row.sample_count),
        )
        for row in grouped.itertuples(index=False)
    )
    with connection:
        connection.executemany(statement, records)


def aggregate_average_day_by_city(
    measurement_tables: Sequence[str],
    *,
    data_dir: str | Path | None = None,
    bin_minutes: int = 5,
    chunksize: int = 250_000,
    connection: sqlite3.Connection,
) -> None:
    for measurement_table in measurement_tables:
        print(f"Averaging {measurement_table}...")
        measurement_chunks = load_table(
            measurement_table,
            data_dir=data_dir,
            usecols=_average_day_usecols(measurement_table, data_dir=data_dir),
            chunksize=chunksize,
        )
        if isinstance(measurement_chunks, pd.DataFrame):
            raise TypeError("Expected chunked reader for aggregate_average_day_by_city")

        processed_rows = 0
        for chunk_index, chunk in enumerate(measurement_chunks, start=1):
            grouped = _prepare_average_day_chunk(
                chunk,
                measurement_table,
                bin_minutes=bin_minutes,
            )
            _insert_average_day_groups(connection, grouped)
            processed_rows += len(chunk)

            if chunk_index % 10 == 0:
                print(f"  processed {processed_rows:,} rows...")

        print(f"Finished {measurement_table}: {processed_rows:,} rows processed.")


def _load_location_names(data_dir: str | Path | None = None) -> dict[str, str]:
    location_frame = load_table(
        "location",
        data_dir=data_dir,
        usecols=["location_code", "location_name"],
    )
    if not isinstance(location_frame, pd.DataFrame):
        raise TypeError("Expected an in-memory dataframe for _load_location_names")
    return dict(
        zip(
            location_frame["location_code"].astype("string"),
            location_frame["location_name"].astype("string"),
            strict=True,
        )
    )


def _average_day_long_frame(
    connection: sqlite3.Connection,
    location_code: str,
    location_name: str,
) -> pd.DataFrame:
    frame = pd.read_sql_query(
        """
        SELECT
            measurement_table,
            location_code,
            month,
            time_bin_minutes,
            measurement_setup,
            sun_included,
            patch,
            patch_almucantar,
            patch_azimuth,
            wavelength,
            spectral_sum / sample_count AS average_spectral_value,
            sample_count AS samples_averaged
        FROM average_day_aggregates
        WHERE location_code = ?
        ORDER BY
            measurement_table,
            month,
            time_bin_minutes,
            measurement_setup,
            sun_included,
            patch,
            patch_almucantar,
            patch_azimuth,
            wavelength
        """,
        connection,
        params=[location_code],
    )
    if frame.empty:
        return frame

    frame["location_name"] = location_name
    frame["month"] = frame["month"].astype("int64")
    frame["month_name"] = frame["month"].map(lambda value: calendar.month_name[int(value)])
    frame["time_bin_minutes"] = frame["time_bin_minutes"].astype("int64")
    frame["time_of_day"] = frame["time_bin_minutes"].map(_format_time_of_day)
    return frame[
        [
            *AVERAGE_DAY_BASE_COLUMNS,
            "wavelength",
            "average_spectral_value",
            "samples_averaged",
        ]
    ]


def _wide_average_day_frame(frame: pd.DataFrame) -> pd.DataFrame:
    if frame.empty:
        return frame

    sample_counts = (
        frame.groupby(AVERAGE_DAY_BASE_COLUMNS, dropna=False, sort=False)["samples_averaged"]
        .min()
        .reset_index()
    )
    pivoted = (
        frame.pivot_table(
            index=AVERAGE_DAY_BASE_COLUMNS,
            columns="wavelength",
            values="average_spectral_value",
            aggfunc="first",
        )
        .reset_index()
    )

    wavelength_columns = [column for column in pivoted.columns if column not in AVERAGE_DAY_BASE_COLUMNS]
    wavelength_columns_sorted = sorted(wavelength_columns, key=float)
    pivoted = pivoted[AVERAGE_DAY_BASE_COLUMNS + wavelength_columns_sorted]
    pivoted = pivoted.merge(sample_counts, on=AVERAGE_DAY_BASE_COLUMNS, how="left")

    ordered_columns = AVERAGE_DAY_BASE_COLUMNS + ["samples_averaged"] + wavelength_columns_sorted
    pivoted = pivoted[ordered_columns]
    pivoted = pivoted.rename(
        columns={column: _format_wavelength_column_name(column) for column in wavelength_columns_sorted}
    )
    return pivoted


def _average_day_output_path(
    output_dir: Path,
    location_code: str,
    location_name: str,
    *,
    output_format: str,
) -> Path:
    filename = (
        f"{_sanitize_filename_component(location_code)}"
        f"_{_sanitize_filename_component(location_name)}_average_day_by_month"
    )
    if output_format != "wide":
        filename = f"{filename}_{output_format}"
    return output_dir / f"{filename}.csv"


def export_average_day_csvs(
    *,
    connection: sqlite3.Connection,
    data_dir: str | Path | None = None,
    output_dir: str | Path,
    output_format: str = "wide",
) -> list[Path]:
    destination_dir = Path(output_dir)
    destination_dir.mkdir(parents=True, exist_ok=True)

    location_names = _load_location_names(data_dir=data_dir)
    location_codes = pd.read_sql_query(
        "SELECT DISTINCT location_code FROM average_day_aggregates ORDER BY location_code",
        connection,
    )["location_code"].tolist()

    written_paths: list[Path] = []
    for location_code in location_codes:
        location_name = location_names.get(location_code, location_code)
        long_frame = _average_day_long_frame(connection, location_code, location_name)
        if long_frame.empty:
            continue

        output_frame = long_frame if output_format == "long" else _wide_average_day_frame(long_frame)
        output_path = _average_day_output_path(
            destination_dir,
            location_code,
            location_name,
            output_format=output_format,
        )
        output_frame.to_csv(output_path, index=False)
        written_paths.append(output_path)
        print(f"Wrote {output_path} ({len(output_frame):,} rows)")

    if not written_paths:
        raise RuntimeError("No per-city average day files were written")
    return written_paths


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


def _print_table_details(summaries: Sequence[Mapping[str, object]]) -> None:
    for summary in summaries:
        print(f"[{summary['table']}]")
        print(f"file={summary['file']}")
        print(f"category={summary['category']}")
        print(f"rows={summary['rows']}")
        print("columns=" + ", ".join(str(column) for column in summary["columns"]))

        locations = ", ".join(str(code) for code in summary["location_codes"]) or "-"
        setups = ", ".join(str(setup) for setup in summary["measurement_setups"]) or "-"
        print(f"location_codes={locations}")
        print(f"measurement_setups={setups}")
        print()


def _print_show_choices(data_dir: str | Path) -> None:
    resolved_dir = resolve_data_dir(data_dir)
    print("SHOW_CHOICES")
    print(show_choices_summary().to_string(index=False))
    print()
    print(f"Average-day output directory: {default_average_day_output_dir(resolved_dir)}")
    print()
    print("Examples:")
    print(
        f'  cities-data show spectral_patch_radiance --data-dir "{resolved_dir}" --rows 5 --nrows 5'
    )
    print(f'  cities-data show patch --data-dir "{resolved_dir}" --rows 5 --nrows 5')
    print(
        f'  cities-data show spectral_patch_radiance --merged --data-dir "{resolved_dir}" --rows 5 --nrows 5'
    )
    print(f'  cities-data merge patch --data-dir "{resolved_dir}" --output merged_patch.csv')
    print(
        f'  cities-data average-day --data-dir "{resolved_dir}" --output-dir "{default_average_day_output_dir(resolved_dir)}"'
    )


def run_default_inspection(data_dir: str | Path) -> int:
    resolved_dir = resolve_data_dir(data_dir)
    summaries = collect_table_summaries(resolved_dir)

    print(f"Alan_Cities dataset directory: {resolved_dir}")
    print()
    print("DATASET_SUMMARY")
    print(dataset_summary(summaries=summaries).to_string(index=False))
    print()
    print("TABLE_DETAILS")
    _print_table_details(summaries)
    _print_show_choices(resolved_dir)
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Inspect and merge the Alan_Cities CSV dataset.")
    parser.add_argument(
        "--data-dir",
        default=str(DEFAULT_DATA_DIR),
        help=f"Dataset directory (default: {DEFAULT_DATA_DIR})",
    )

    subparsers = parser.add_subparsers(dest="command")

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

    average_day_parser = subparsers.add_parser(
        "average-day",
        help="Average each city and month into a representative spectral day CSV.",
    )
    average_day_parser.add_argument(
        "--data-dir",
        default=str(DEFAULT_DATA_DIR),
        help=f"Dataset directory (default: {DEFAULT_DATA_DIR})",
    )
    average_day_parser.add_argument(
        "--output-dir",
        type=Path,
        default=None,
        help=(
            "Directory for per-city averaged CSV files "
            f"(default: <data-dir>\\{DEFAULT_AVERAGE_DAY_OUTPUT_SUBDIR})"
        ),
    )
    average_day_parser.add_argument(
        "--tables",
        nargs="*",
        default=None,
        help=(
            "Measurement tables or aliases to include. "
            f"Defaults to: {', '.join(MEASUREMENT_TABLE_NAMES)}"
        ),
    )
    average_day_parser.add_argument(
        "--bin-minutes",
        type=int,
        default=5,
        help="Time-of-day bin size in minutes for the representative daily spectrum.",
    )
    average_day_parser.add_argument(
        "--chunksize",
        type=int,
        default=250_000,
        help="Chunk size for streamed averaging.",
    )
    average_day_parser.add_argument(
        "--format",
        choices=("wide", "long"),
        default="wide",
        help="Output format. 'wide' makes wavelengths the CSV columns.",
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


def run_average_day(args: argparse.Namespace) -> int:
    if args.bin_minutes <= 0:
        raise ValueError("--bin-minutes must be greater than 0")
    if args.chunksize <= 0:
        raise ValueError("--chunksize must be greater than 0")

    data_dir = resolve_data_dir(args.data_dir)
    output_dir = Path(args.output_dir) if args.output_dir is not None else default_average_day_output_dir(data_dir)
    measurement_tables = resolve_measurement_table_names(args.tables)

    print(f"Alan_Cities dataset directory: {data_dir}")
    print(f"Per-city average output directory: {output_dir}")
    print(f"Measurement tables: {', '.join(measurement_tables)}")
    print(f"Representative day bin size: {args.bin_minutes} minutes")
    print(f"Output format: {args.format}")
    print()

    connection, temp_path = _create_average_day_database()
    try:
        aggregate_average_day_by_city(
            measurement_tables,
            data_dir=data_dir,
            bin_minutes=args.bin_minutes,
            chunksize=args.chunksize,
            connection=connection,
        )
        print()
        written_paths = export_average_day_csvs(
            connection=connection,
            data_dir=data_dir,
            output_dir=output_dir,
            output_format=args.format,
        )
    finally:
        connection.close()
        temp_path.unlink(missing_ok=True)

    print()
    print("Created per-city average day files:")
    for path in written_paths:
        print(f"  {path}")
    return 0


def main(argv: Sequence[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)

    try:
        if args.command is None:
            return run_default_inspection(args.data_dir)
        if args.command == "summary":
            return run_summary(args.data_dir)
        if args.command == "show":
            return run_show(args)
        if args.command == "merge":
            return run_merge(args)
        if args.command == "average-day":
            return run_average_day(args)
    except Exception as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 1

    parser.print_help()
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
