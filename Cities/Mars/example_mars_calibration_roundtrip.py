from __future__ import annotations

import argparse
import importlib.util
import re
import sys
from pathlib import Path
from typing import Sequence

import matplotlib

matplotlib.use("Agg")

import matplotlib.colors as mcolors
import matplotlib.pyplot as plt
import pandas as pd

PARENT_CITIES_DIR = Path(__file__).resolve().parents[1]
if str(PARENT_CITIES_DIR) not in sys.path:
    sys.path.insert(0, str(PARENT_CITIES_DIR))

try:
    from .Mars import DEFAULT_IRRADIANCE_SCALE, MEASUREMENT_TABLE, MONTH, measurement_setup_for_tau
except ImportError:
    mars_module_path = Path(__file__).resolve().with_name("Mars.py")
    mars_spec = importlib.util.spec_from_file_location("mars_comimart_generator", mars_module_path)
    if mars_spec is None or mars_spec.loader is None:
        raise ImportError(f"Could not load Mars generator module from {mars_module_path}")
    mars_module = importlib.util.module_from_spec(mars_spec)
    sys.modules[mars_spec.name] = mars_module
    mars_spec.loader.exec_module(mars_module)
    DEFAULT_IRRADIANCE_SCALE = mars_module.DEFAULT_IRRADIANCE_SCALE
    MEASUREMENT_TABLE = mars_module.MEASUREMENT_TABLE
    MONTH = mars_module.MONTH
    measurement_setup_for_tau = mars_module.measurement_setup_for_tau

from calibrate import (  # noqa: E402
    DEFAULT_CALIBRATION_DIR,
    calibrate_target_day,
    load_calibration_set,
    load_city_average_day,
    reconstruct_schedule_spectra,
    target_day_to_spectra_frame,
)


def default_mars_csv() -> Path:
    return Path(__file__).resolve().parent / "outputs" / "Mars_Equator_Ls0_tau0p3_average_sol.csv"


def get_wavelength_columns(frame: pd.DataFrame) -> list[str]:
    return [column for column in frame.columns if re.fullmatch(r"\d+(\.\d+)?", str(column))]


def time_of_day_to_hours(value: object) -> float:
    match = re.fullmatch(r"(\d+):([0-5]\d)", str(value).strip())
    if not match:
        raise ValueError(f"Invalid time_of_day value: {value!r}")
    return int(match.group(1)) + int(match.group(2)) / 60


def plot_spectra_frame(
    spectra_frame: pd.DataFrame,
    output_path: Path,
    *,
    title: str,
    ylabel: str,
) -> Path:
    wavelength_columns = get_wavelength_columns(spectra_frame)
    if not wavelength_columns:
        raise ValueError("No wavelength columns were found in the provided spectra frame")
    if "time_of_day" not in spectra_frame.columns:
        raise KeyError("The provided spectra frame must contain a time_of_day column")

    wavelengths = pd.to_numeric(wavelength_columns)
    plot_data = spectra_frame.loc[:, wavelength_columns].apply(pd.to_numeric, errors="coerce").to_numpy(dtype=float)
    time_hours = spectra_frame["time_of_day"].map(time_of_day_to_hours)

    output_path.parent.mkdir(parents=True, exist_ok=True)
    fig, ax = plt.subplots(figsize=(12, 8))
    norm = mcolors.Normalize(vmin=float(time_hours.min()), vmax=float(time_hours.max()))
    cmap = plt.get_cmap("viridis")
    for row_index in range(len(plot_data)):
        ax.plot(wavelengths, plot_data[row_index], color=cmap(norm(float(time_hours.iloc[row_index]))))
    ax.set_xlabel("Wavelength (nm)")
    ax.set_ylabel(ylabel)
    ax.set_title(title)
    scalar_map = plt.cm.ScalarMappable(cmap=cmap, norm=norm)
    scalar_map.set_array([])
    fig.colorbar(scalar_map, ax=ax, label="Time of sol (hour)")
    fig.tight_layout()
    fig.savefig(output_path)
    plt.close(fig)
    return output_path


def resolve_measurement_setup(mars_csv: Path, requested_setup: str | None, tau: float, irradiance_scale: float) -> str:
    if requested_setup:
        return requested_setup

    frame = pd.read_csv(mars_csv, nrows=50)
    if "measurement_setup" in frame.columns:
        values = sorted(
            {
                str(value).strip()
                for value in frame["measurement_setup"].dropna().tolist()
                if str(value).strip()
            }
        )
        if len(values) == 1:
            return values[0]
        if len(values) > 1:
            raise ValueError(
                "Multiple measurement_setup values found in Mars CSV; pass --measurement-setup"
            )

    return measurement_setup_for_tau(tau, irradiance_scale)


def channel_percentage_columns(lamp_schedule: pd.DataFrame) -> list[str]:
    return [column for column in lamp_schedule.columns if column.endswith("_pct")]


def saturated_time_bins(lamp_schedule: pd.DataFrame, percentage_columns: Sequence[str]) -> pd.DataFrame:
    if not percentage_columns:
        return pd.DataFrame()
    saturated_mask = lamp_schedule.loc[:, percentage_columns].ge(99.999).any(axis=1)
    return lamp_schedule.loc[saturated_mask, ["time_bin_minutes", "time_of_day", *percentage_columns]].copy()


def write_roundtrip_outputs(
    *,
    mars_csv: Path,
    output_dir: Path,
    room: str,
    calibration_dir: Path,
    measurement_setup: str,
    unit: str,
    min_wavelength: float,
    max_wavelength: float,
) -> dict[str, object]:
    calibration = load_calibration_set(room, base_path=calibration_dir, unit=unit)
    target_day = load_city_average_day(
        mars_csv,
        month=MONTH,
        measurement_table=MEASUREMENT_TABLE,
        measurement_setup=measurement_setup,
        sun_included="true",
        fill_method="none",
        unit=unit,
    )
    lamp_schedule = calibrate_target_day(
        target_day,
        calibration,
        min_wavelength=min_wavelength,
        max_wavelength=max_wavelength,
    )
    reconstructed_frame = reconstruct_schedule_spectra(
        lamp_schedule,
        calibration,
        output_wavelengths_nm=target_day.wavelengths_nm,
    )
    target_frame = target_day_to_spectra_frame(target_day)

    output_dir.mkdir(parents=True, exist_ok=True)
    target_csv_path = output_dir / "Mars_target_spectra.csv"
    lamp_schedule_path = output_dir / f"Mars_{calibration.room}_lamp_percentages.csv"
    reconstructed_csv_path = output_dir / f"Mars_{calibration.room}_reconstructed_spectra.csv"
    target_plot_path = output_dir / "Mars_target.png"
    reconstructed_plot_path = output_dir / f"Mars_{calibration.room}_reconstructed.png"

    target_frame.to_csv(target_csv_path, index=False)
    lamp_schedule.to_csv(lamp_schedule_path, index=False)
    reconstructed_frame.to_csv(reconstructed_csv_path, index=False)

    plot_spectra_frame(
        target_frame,
        target_plot_path,
        title="Mars target spectral intensity over one sol",
        ylabel=f"Target intensity ({unit})",
    )
    plot_spectra_frame(
        reconstructed_frame,
        reconstructed_plot_path,
        title=f"Reconstructed {calibration.room} spectral intensity over one Mars sol",
        ylabel=f"Reconstructed intensity ({unit})",
    )

    percentage_columns = channel_percentage_columns(lamp_schedule)
    channel_maxima = {
        column.removesuffix("_pct"): float(lamp_schedule[column].max())
        for column in percentage_columns
    }
    saturated = saturated_time_bins(lamp_schedule, percentage_columns)
    mean_fit_rmse = float(lamp_schedule["fit_rmse"].mean())
    max_integral_shortfall = float(
        (lamp_schedule["target_integral"] - lamp_schedule["reconstructed_integral"]).max()
    )
    capacity_limited = bool(not saturated.empty and max_integral_shortfall > 0)

    return {
        "target_csv": target_csv_path,
        "lamp_schedule_csv": lamp_schedule_path,
        "reconstructed_csv": reconstructed_csv_path,
        "target_plot": target_plot_path,
        "reconstructed_plot": reconstructed_plot_path,
        "rows": len(lamp_schedule),
        "mean_fit_rmse": mean_fit_rmse,
        "channel_maxima": channel_maxima,
        "saturated": saturated,
        "capacity_limited": capacity_limited,
        "max_integral_shortfall": max_integral_shortfall,
    }


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Round-trip a generated Mars COMIMART average-sol CSV through chamber calibration.",
    )
    parser.add_argument(
        "--mars-csv",
        type=Path,
        default=default_mars_csv(),
        help="Generated Mars average-sol CSV to fit.",
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=Path(__file__).resolve().parent / "outputs",
        help="Directory where round-trip CSVs and plots are written.",
    )
    parser.add_argument(
        "--room",
        default="G7",
        help="Room calibration to use for the lamp fit.",
    )
    parser.add_argument(
        "--calibration-dir",
        type=Path,
        default=DEFAULT_CALIBRATION_DIR,
        help=f"Directory containing Jeti calibration files (default: {DEFAULT_CALIBRATION_DIR}).",
    )
    parser.add_argument(
        "--tau",
        type=float,
        default=0.3,
        help="Tau used only to infer measurement_setup when the CSV does not contain one.",
    )
    parser.add_argument(
        "--irradiance-scale",
        type=float,
        default=DEFAULT_IRRADIANCE_SCALE,
        help="Irradiance scale used only to infer measurement_setup when the CSV does not contain one.",
    )
    parser.add_argument(
        "--measurement-setup",
        default=None,
        help="Optional explicit measurement_setup filter.",
    )
    parser.add_argument(
        "--unit",
        choices=("photon", "energy"),
        default="photon",
        help="Unit used for calibration and reconstruction.",
    )
    parser.add_argument(
        "--min-wavelength",
        type=float,
        default=400.0,
        help="Lower wavelength bound for calibration fitting.",
    )
    parser.add_argument(
        "--max-wavelength",
        type=float,
        default=830.0,
        help="Upper wavelength bound for calibration fitting.",
    )
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    try:
        measurement_setup = resolve_measurement_setup(
            args.mars_csv,
            args.measurement_setup,
            args.tau,
            args.irradiance_scale,
        )
        result = write_roundtrip_outputs(
            mars_csv=args.mars_csv,
            output_dir=args.output_dir,
            room=args.room,
            calibration_dir=args.calibration_dir,
            measurement_setup=measurement_setup,
            unit=args.unit,
            min_wavelength=args.min_wavelength,
            max_wavelength=args.max_wavelength,
        )

        print(f"Mars CSV: {args.mars_csv}")
        print(f"Measurement setup: {measurement_setup}")
        print(f"Rows fitted: {result['rows']}")
        print(f"Mean fit RMSE: {result['mean_fit_rmse']:.8g}")
        print("Highest required percentage by channel:")
        for channel, maximum in result["channel_maxima"].items():
            print(f"- {channel}: {maximum:.3f}%")

        saturated = result["saturated"]
        if saturated.empty:
            print("Time bins with one or more channels at 100%: none")
        else:
            print("Time bins with one or more channels at 100%:")
            for _, row in saturated.iterrows():
                print(f"- {row['time_of_day']} ({int(row['time_bin_minutes'])} min)")

        if result["capacity_limited"]:
            print(
                "Chamber capacity: requested Martian intensity exceeds chamber capacity "
                f"for at least one bin; max integral shortfall {result['max_integral_shortfall']:.8g}."
            )
        else:
            print("Chamber capacity: no 100% channel saturation with positive integral shortfall detected.")

        print(f"Target spectra: {result['target_csv']}")
        print(f"Lamp percentages: {result['lamp_schedule_csv']}")
        print(f"Reconstructed spectra: {result['reconstructed_csv']}")
        print(f"Target plot: {result['target_plot']}")
        print(f"Reconstructed plot: {result['reconstructed_plot']}")
        return 0
    except Exception as exc:
        print(f"Error: {exc}")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
