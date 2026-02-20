from __future__ import annotations

import argparse
import math
import re
from pathlib import Path
from typing import Iterable

import matplotlib.pyplot as plt


NUMBER_PATTERN = re.compile(r"[-+]?\d+(?:[.,]\d+)?(?:[eE][-+]?\d+)?")


def try_parse_number(token: str) -> float | None:
    cleaned = token.strip().strip('"').strip("'")
    if not cleaned:
        return None

    # Reject mixed text tokens such as "Ee [W/m2]".
    if not re.fullmatch(r"[0-9eE+,\-.\s]+", cleaned):
        return None

    try:
        return float(cleaned)
    except ValueError:
        pass

    normalized = cleaned
    if "," in normalized and "." in normalized:
        if normalized.rfind(",") > normalized.rfind("."):
            normalized = normalized.replace(".", "").replace(",", ".")
        else:
            normalized = normalized.replace(",", "")
    elif "," in normalized:
        if normalized.count(",") > 1:
            normalized = normalized.replace(",", "")
        else:
            normalized = normalized.replace(",", ".")

    try:
        return float(normalized)
    except ValueError:
        return None


def parse_first_two_numbers(line: str) -> tuple[float, float] | None:
    for delimiter in (";", "\t", ","):
        parts = line.split(delimiter)
        if len(parts) < 2:
            continue
        parsed = [try_parse_number(part) for part in parts]
        numbers = [value for value in parsed if value is not None]
        if len(numbers) >= 2:
            return numbers[0], numbers[1]

    parts = line.split()
    if len(parts) >= 2:
        parsed = [try_parse_number(part) for part in parts]
        numbers = [value for value in parsed if value is not None]
        if len(numbers) >= 2:
            return numbers[0], numbers[1]

    # Fallback for lines that are mostly numeric but oddly formatted.
    if any(ch.isalpha() for ch in line):
        return None
    tokens = NUMBER_PATTERN.findall(line)
    if len(tokens) < 2:
        return None
    first = try_parse_number(tokens[0])
    second = try_parse_number(tokens[1])
    if first is None or second is None:
        return None
    return first, second


def read_text_with_fallback(path: Path) -> str:
    for encoding in ("utf-8-sig", "utf-8", "cp1252", "latin-1"):
        try:
            return path.read_text(encoding=encoding)
        except UnicodeDecodeError:
            continue
    return path.read_text(errors="replace")


def extract_spectral_series(lines: Iterable[str]) -> list[tuple[float, float]]:
    candidates: list[tuple[int, float, float]] = []
    for line_index, line in enumerate(lines):
        parsed = parse_first_two_numbers(line)
        if parsed is None:
            continue

        wavelength, value = parsed

        if 100.0 <= wavelength <= 2000.0 and math.isfinite(wavelength) and math.isfinite(value):
            candidates.append((line_index, wavelength, value))

    if not candidates:
        raise ValueError("No numeric spectral candidates found.")

    runs: list[list[tuple[int, float, float]]] = []
    current_run: list[tuple[int, float, float]] = []

    for point in candidates:
        if not current_run:
            current_run = [point]
            continue

        prev_line, prev_wavelength, _ = current_run[-1]
        line_idx, wavelength, _ = point
        consecutive_line = line_idx == prev_line + 1
        increasing_wavelength = wavelength > prev_wavelength
        reasonable_step = (wavelength - prev_wavelength) <= 20.0

        if consecutive_line and increasing_wavelength and reasonable_step:
            current_run.append(point)
        else:
            if len(current_run) >= 10:
                runs.append(current_run)
            current_run = [point]

    if len(current_run) >= 10:
        runs.append(current_run)

    if not runs:
        raise ValueError("Could not isolate a spectral table. Need at least 10 consecutive data rows.")

    best_run = max(runs, key=len)
    series = [(wavelength, value) for _, wavelength, value in best_run]
    return series


def integrate_trapezoid(x: list[float], y: list[float]) -> float:
    if len(x) < 2:
        return 0.0
    return sum((x2 - x1) * (y1 + y2) * 0.5 for x1, x2, y1, y2 in zip(x[:-1], x[1:], y[:-1], y[1:]))


def main() -> None:
    parser = argparse.ArgumentParser(description="Analyze spectral CSV and plot PAR range.")
    parser.add_argument("csv_paths", nargs="*", help="One or more CSV files to overlay in one PAR plot.")
    parser.add_argument("--par-min", type=float, default=400.0)
    parser.add_argument("--par-max", type=float, default=700.0)
    parser.add_argument("--save", type=str, help="Optional output image path for the plot.")
    parser.add_argument("--no-show", action="store_true", help="Skip opening the plot window.")
    args = parser.parse_args()

    par_min = min(args.par_min, args.par_max)
    par_max = max(args.par_min, args.par_max)

    if args.csv_paths:
        csv_paths = [Path(p) for p in args.csv_paths]
    else:
        folder = Path(__file__).parent
        default_candidates = [folder / "yup.csv", folder / "A3 24-04-2025.csv"]
        csv_paths = [path for path in default_candidates if path.exists()]
        if not csv_paths:
            csv_paths = [folder / "yup.csv"]

    parsed_series: list[tuple[Path, list[float], list[float], float]] = []

    for csv_path in csv_paths:
        if not csv_path.exists():
            print(f"[WARN] CSV not found, skipping: {csv_path}")
            continue

        try:
            text = read_text_with_fallback(csv_path)
            lines = text.splitlines()
            spectrum = extract_spectral_series(lines)
        except Exception as exc:
            print(f"[WARN] Failed to parse {csv_path}: {exc}")
            continue

        wavelengths = [wl for wl, _ in spectrum]
        values = [val for _, val in spectrum]
        par_points = [(wl, val) for wl, val in zip(wavelengths, values) if par_min <= wl <= par_max]
        if not par_points:
            print(f"[WARN] No PAR points in {csv_path} ({par_min:.0f}-{par_max:.0f} nm), skipping.")
            continue

        par_wavelengths = [wl for wl, _ in par_points]
        par_values = [val for _, val in par_points]
        par_integral = integrate_trapezoid(par_wavelengths, par_values)
        parsed_series.append((csv_path, par_wavelengths, par_values, par_integral))

        print(f"Loaded file: {csv_path}")
        print(f"Detected spectral points: {len(spectrum)} ({min(wavelengths):.0f}-{max(wavelengths):.0f} nm)")
        print(f"PAR points: {len(par_points)} ({par_min:.0f}-{par_max:.0f} nm)")
        print(f"PAR Ee min/max: {min(par_values):.6g} / {max(par_values):.6g} W/(m^2*nm)")
        print(f"PAR Ee integral (trapezoid): {par_integral:.6g} W/m^2")

    if not parsed_series:
        raise ValueError("No valid CSV spectra to plot.")

    plt.figure(figsize=(10, 5))
    for csv_path, par_wavelengths, par_values, _ in parsed_series:
        plt.plot(par_wavelengths, par_values, linewidth=1.8, label=csv_path.stem)

    plt.xlim(par_min, par_max)
    plt.xlabel("Wavelength (nm)")
    plt.ylabel("Irradiance Ee (W/(m^2*nm))")
    plt.title(f"PAR Spectrum Overlay ({par_min:.0f}-{par_max:.0f} nm)")
    plt.grid(True, alpha=0.3)
    plt.legend()
    plt.tight_layout()

    if args.save:
        output_path = Path(args.save)
        plt.savefig(output_path, dpi=160)
        print(f"Saved plot: {output_path}")

    if not args.no_show:
        plt.show()


if __name__ == "__main__":
    main()
