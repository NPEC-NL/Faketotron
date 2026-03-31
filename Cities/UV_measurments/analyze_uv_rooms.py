from __future__ import annotations

import argparse
import csv
import math
import re
from dataclasses import dataclass
from pathlib import Path

import matplotlib.pyplot as plt


ROOM_RE = re.compile(r"(?<![A-Za-z0-9])(G[4568])(?![A-Za-z0-9])", re.IGNORECASE)
LEVELS = [25, 50, 75, 100]
ROOM_COLORS = {
    "G4": "#2563eb",
    "G5": "#f59e0b",
    "G6": "#16a34a",
    "G8": "#dc2626",
}


@dataclass
class UvRoomData:
    room: str
    wavelengths_nm: list[float]
    spectra_by_percent: dict[int, list[float]]


def read_lines(path: Path) -> list[str]:
    for encoding in ("utf-8-sig", "cp1252", "latin-1"):
        try:
            return path.read_text(encoding=encoding).splitlines()
        except UnicodeDecodeError:
            continue
    raise UnicodeDecodeError("unknown", b"", 0, 1, f"Could not decode {path}")


def detect_room(path: Path) -> str | None:
    match = ROOM_RE.search(path.stem)
    return match.group(1).upper() if match else None


def first_cell(line: str) -> str:
    return line.split(";", 1)[0].strip()


def parse_numeric(cell: str) -> float | None:
    text = cell.strip()
    if not text:
        return None
    try:
        return float(text.replace(",", "."))
    except ValueError:
        return None


def find_uv_header(lines: list[str]) -> tuple[int, int]:
    for row_index, line in enumerate(lines):
        parts = line.split(";")
        wavelength_indices = [index for index, cell in enumerate(parts) if cell.strip() == "Wavelength [nm]"]
        if len(wavelength_indices) >= 2:
            return row_index, wavelength_indices[1]
    raise ValueError("Could not find a merged UV spectral block with a second 'Wavelength [nm]' column.")


def parse_uv_block(path: Path) -> UvRoomData:
    room = detect_room(path)
    if not room:
        raise ValueError(f"Could not determine room from file name: {path.name}")

    lines = read_lines(path)
    header_row_index, uv_start_col = find_uv_header(lines)

    wavelengths_nm: list[float] = []
    spectra_by_percent = {level: [] for level in LEVELS}
    started = False

    for line in lines[header_row_index + 1 :]:
        parts = line.split(";")
        if len(parts) <= uv_start_col:
            if started:
                break
            continue

        wavelength = parse_numeric(parts[uv_start_col])
        if wavelength is None:
            if started:
                break
            continue

        started = True
        wavelengths_nm.append(wavelength)
        for index, level in enumerate(LEVELS):
            value = parse_numeric(parts[uv_start_col + 1 + index]) if len(parts) > uv_start_col + 1 + index else None
            spectra_by_percent[level].append(0.0 if value is None else value)

    if not wavelengths_nm:
        raise ValueError(f"No UV spectral data rows were found in {path.name}.")

    return UvRoomData(
        room=room,
        wavelengths_nm=wavelengths_nm,
        spectra_by_percent=spectra_by_percent,
    )


def integrate_range(wavelengths_nm: list[float], values: list[float], min_nm: float, max_nm: float) -> float:
    filtered = [(nm, value) for nm, value in zip(wavelengths_nm, values) if min_nm <= nm <= max_nm]
    if len(filtered) < 2:
        return filtered[0][1] if filtered else 0.0

    total = 0.0
    for index in range(1, len(filtered)):
        prev_nm, prev_value = filtered[index - 1]
        nm, value = filtered[index]
        total += 0.5 * (prev_value + value) * (nm - prev_nm)
    return total


def ee_to_umol_per_nm(ee: float, wavelength_nm: float) -> float:
    return ee * wavelength_nm * 0.008359


def photon_flux(wavelengths_nm: list[float], ee_values: list[float], min_nm: float, max_nm: float) -> float:
    umol_values = [ee_to_umol_per_nm(ee, nm) for nm, ee in zip(wavelengths_nm, ee_values)]
    return integrate_range(wavelengths_nm, umol_values, min_nm, max_nm)


def peak(values: list[float], wavelengths_nm: list[float]) -> tuple[float, float]:
    peak_index = max(range(len(values)), key=lambda index: values[index])
    return wavelengths_nm[peak_index], values[peak_index]


def write_csv(path: Path, rows: list[dict[str, object]], fieldnames: list[str]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)


def plot_integrated_metric(
    room_data: list[UvRoomData],
    output_path: Path,
    *,
    value_for_room_level,
    ylabel: str,
    title: str,
) -> None:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    fig, ax = plt.subplots(figsize=(9, 6))

    for data in room_data:
        values = [value_for_room_level(data, level) for level in LEVELS]
        ax.plot(
            LEVELS,
            values,
            marker="o",
            linewidth=2,
            color=ROOM_COLORS.get(data.room),
            label=data.room,
        )

    ax.set_xlabel("UVB setting (%)")
    ax.set_ylabel(ylabel)
    ax.set_title(title)
    ax.set_xticks(LEVELS)
    ax.grid(True, alpha=0.3)
    ax.legend()
    fig.tight_layout()
    fig.savefig(output_path, dpi=160)
    plt.close(fig)


def plot_spectral_overlay(room_data: list[UvRoomData], percent: int, output_path: Path) -> None:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    fig, ax = plt.subplots(figsize=(10, 6))

    for data in room_data:
        ax.plot(
            data.wavelengths_nm,
            data.spectra_by_percent[percent],
            linewidth=2,
            color=ROOM_COLORS.get(data.room),
            label=data.room,
        )

    ax.set_xlabel("Wavelength (nm)")
    ax.set_ylabel("UV irradiance Ee [W/(sqm*nm)]")
    ax.set_title(f"UV spectra comparison at {percent}%")
    ax.grid(True, alpha=0.3)
    ax.legend()
    fig.tight_layout()
    fig.savefig(output_path, dpi=160)
    plt.close(fig)


def plot_room_spectra(data: UvRoomData, output_path: Path) -> None:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    fig, ax = plt.subplots(figsize=(10, 6))

    level_colors = {
        25: "#93c5fd",
        50: "#60a5fa",
        75: "#2563eb",
        100: "#1d4ed8",
    }

    for level in LEVELS:
        ax.plot(
            data.wavelengths_nm,
            data.spectra_by_percent[level],
            linewidth=2,
            color=level_colors[level],
            label=f"{level}%",
        )

    ax.set_xlabel("Wavelength (nm)")
    ax.set_ylabel("UV irradiance Ee [W/(sqm*nm)]")
    ax.set_title(f"{data.room} UV spectra at 25/50/75/100%")
    ax.grid(True, alpha=0.3)
    ax.legend(title="Setting")
    fig.tight_layout()
    fig.savefig(output_path, dpi=160)
    plt.close(fig)


def format_table(rows: list[dict[str, object]], columns: list[tuple[str, str]]) -> str:
    rendered = []
    widths = []
    for header, key in columns:
        values = [header, *[str(row[key]) for row in rows]]
        widths.append(max(len(value) for value in values))

    header_line = " | ".join(header.ljust(width) for width, (header, _) in zip(widths, columns))
    sep_line = "-+-".join("-" * width for width in widths)
    rendered.append(header_line)
    rendered.append(sep_line)
    for row in rows:
        rendered.append(" | ".join(str(row[key]).ljust(width) for width, (_, key) in zip(widths, columns)))
    return "\n".join(rendered)


def analyze_folder(input_dir: Path, output_dir: Path) -> None:
    files = sorted(input_dir.glob("G*_Calibration_File*.csv"))
    room_data = [parse_uv_block(path) for path in files if detect_room(path)]
    room_data.sort(key=lambda data: data.room)

    summary_rows: list[dict[str, object]] = []
    summary_100_rows: list[dict[str, object]] = []

    for data in room_data:
        for level in LEVELS:
            ee_values = data.spectra_by_percent[level]
            ee_190_400 = integrate_range(data.wavelengths_nm, ee_values, 190, 400)
            ee_230_400 = integrate_range(data.wavelengths_nm, ee_values, 230, 400)
            photon_190_400 = photon_flux(data.wavelengths_nm, ee_values, 190, 400)
            photon_230_400 = photon_flux(data.wavelengths_nm, ee_values, 230, 400)
            peak_nm, peak_ee = peak(ee_values, data.wavelengths_nm)

            row = {
                "room": data.room,
                "percent": level,
                "integrated_ee_190_400_w_m2": round(ee_190_400, 6),
                "integrated_ee_230_400_w_m2": round(ee_230_400, 6),
                "photon_flux_190_400_umol_m2_s": round(photon_190_400, 6),
                "photon_flux_230_400_umol_m2_s": round(photon_230_400, 6),
                "peak_nm": round(peak_nm, 1),
                "peak_ee_w_m2_nm": round(peak_ee, 6),
            }
            summary_rows.append(row)
            if level == 100:
                summary_100_rows.append(row)

    output_dir.mkdir(parents=True, exist_ok=True)
    write_csv(
        output_dir / "uv_room_summary_all_levels.csv",
        summary_rows,
        [
            "room",
            "percent",
            "integrated_ee_190_400_w_m2",
            "integrated_ee_230_400_w_m2",
            "photon_flux_190_400_umol_m2_s",
            "photon_flux_230_400_umol_m2_s",
            "peak_nm",
            "peak_ee_w_m2_nm",
        ],
    )
    write_csv(
        output_dir / "uv_room_summary_100pct.csv",
        summary_100_rows,
        [
            "room",
            "percent",
            "integrated_ee_190_400_w_m2",
            "integrated_ee_230_400_w_m2",
            "photon_flux_190_400_umol_m2_s",
            "photon_flux_230_400_umol_m2_s",
            "peak_nm",
            "peak_ee_w_m2_nm",
        ],
    )

    plot_integrated_metric(
        room_data,
        output_dir / "uv_integrated_ee_190_400.png",
        value_for_room_level=lambda data, level: integrate_range(
            data.wavelengths_nm,
            data.spectra_by_percent[level],
            190,
            400,
        ),
        ylabel="Integrated UV irradiance Ee 190-400 nm [W/sqm]",
        title="UV integrated irradiance by room",
    )
    plot_integrated_metric(
        room_data,
        output_dir / "uv_photon_flux_230_400.png",
        value_for_room_level=lambda data, level: photon_flux(
            data.wavelengths_nm,
            data.spectra_by_percent[level],
            230,
            400,
        ),
        ylabel="Photon flux 230-400 nm [umol/(s*m^2)]",
        title="UV photon flux by room",
    )
    for data in room_data:
        plot_room_spectra(data, output_dir / f"uv_{data.room.lower()}_spectra_levels.png")

    print("Assumption: merged G5/G6 UV files were converted from radiance to approximate irradiance using Ee = pi * Le.")
    print()
    print("100% comparison")
    print(
        format_table(
            [
                {
                    "room": row["room"],
                    "ee_190_400": f"{row['integrated_ee_190_400_w_m2']:.4f}",
                    "ee_230_400": f"{row['integrated_ee_230_400_w_m2']:.4f}",
                    "photon_230_400": f"{row['photon_flux_230_400_umol_m2_s']:.4f}",
                    "peak_nm": f"{row['peak_nm']:.1f}",
                    "peak_ee": f"{row['peak_ee_w_m2_nm']:.5f}",
                }
                for row in summary_100_rows
            ],
            [
                ("Room", "room"),
                ("Ee 190-400", "ee_190_400"),
                ("Ee 230-400", "ee_230_400"),
                ("Photon 230-400", "photon_230_400"),
                ("Peak nm", "peak_nm"),
                ("Peak Ee/nm", "peak_ee"),
            ],
        )
    )
    print()
    print("All measured levels")
    print(
        format_table(
            [
                {
                    "room": row["room"],
                    "percent": row["percent"],
                    "ee_190_400": f"{row['integrated_ee_190_400_w_m2']:.4f}",
                    "photon_230_400": f"{row['photon_flux_230_400_umol_m2_s']:.4f}",
                }
                for row in summary_rows
            ],
            [
                ("Room", "room"),
                ("%", "percent"),
                ("Ee 190-400", "ee_190_400"),
                ("Photon 230-400", "photon_230_400"),
            ],
        )
    )
    print()
    print(f"Saved CSV summaries and plots to: {output_dir}")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Analyze merged UV calibration CSVs and generate room-comparison summaries and plots."
    )
    parser.add_argument(
        "--input-dir",
        default=r"C:\Users\maart\Downloads\UV_Output",
        help="Folder containing merged calibration CSVs with UV blocks appended on the right.",
    )
    parser.add_argument(
        "--output-dir",
        default=r"C:\Users\maart\Downloads\UV_Output\Analysis",
        help="Folder where comparison CSVs and plots will be written.",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    input_dir = Path(args.input_dir)
    output_dir = Path(args.output_dir)

    if not input_dir.exists():
        raise SystemExit(f"Input folder does not exist: {input_dir}")

    analyze_folder(input_dir, output_dir)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
