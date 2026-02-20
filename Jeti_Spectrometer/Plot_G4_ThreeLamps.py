from __future__ import annotations

import argparse
import csv
import math
from pathlib import Path

import matplotlib.pyplot as plt


LAMP_NAMES = ("Cool White", "Deep Red", "Far Red")
STEPS_PER_LAMP = 20
DIMMING_STEPS = [i * 5 for i in range(1, STEPS_PER_LAMP + 1)]
SPECTRAL_HEADER = "Wavelength [nm]"
PAR_MIN_NM = 400.0
PAR_MAX_NM = 700.0
PLANCK_CONSTANT = 6.62607015e-34
SPEED_OF_LIGHT = 2.99792458e8
AVOGADRO_CONSTANT = 6.02214076e23
EE_TO_UMOL_FACTOR = 1e-9 * 1e6 / (PLANCK_CONSTANT * SPEED_OF_LIGHT * AVOGADRO_CONSTANT)


def parse_number(token: str) -> float:
    cleaned = token.strip()
    if "," in cleaned and "." in cleaned:
        if cleaned.rfind(",") > cleaned.rfind("."):
            cleaned = cleaned.replace(".", "").replace(",", ".")
        else:
            cleaned = cleaned.replace(",", "")
    elif "," in cleaned:
        cleaned = cleaned.replace(",", ".")
    return float(cleaned)


def read_csv_rows(csv_path: Path) -> tuple[list[list[str]], str]:
    encodings_to_try = ("utf-8-sig", "cp1252")

    for encoding in encodings_to_try:
        try:
            with csv_path.open("r", encoding=encoding, newline="") as handle:
                return list(csv.reader(handle, delimiter=";")), encoding
        except UnicodeDecodeError:
            continue
    raise UnicodeDecodeError("csv", b"", 0, 1, f"Could not decode {csv_path}")


def build_series_labels(series_count: int) -> list[str]:
    expected = STEPS_PER_LAMP * len(LAMP_NAMES)
    if series_count == expected:
        labels: list[str] = []
        for lamp in LAMP_NAMES:
            for step in DIMMING_STEPS:
                labels.append(f"{lamp} {step}%")
        return labels
    return [f"Series {idx + 1}" for idx in range(series_count)]


def read_long_spectra(csv_path: Path) -> tuple[list[float], list[list[float]], str]:
    rows, encoding = read_csv_rows(csv_path)

    header_row_idx = -1
    for idx, row in enumerate(rows):
        if row and row[0].strip() == SPECTRAL_HEADER:
            header_row_idx = idx
            break
    if header_row_idx < 0:
        raise ValueError(f"Row not found: {SPECTRAL_HEADER}")

    header_row = rows[header_row_idx]
    series_count = sum(1 for token in header_row[1:] if token.strip())
    if series_count == 0:
        raise ValueError("No spectral series found after spectral header.")

    wavelengths: list[float] = []
    spectra: list[list[float]] = [[] for _ in range(series_count)]

    for row in rows[header_row_idx + 1 :]:
        if not row:
            if wavelengths:
                break
            continue

        first_token = row[0].strip()
        if not first_token:
            if wavelengths:
                break
            continue

        try:
            wavelength = parse_number(first_token)
        except ValueError:
            if wavelengths:
                break
            continue

        wavelengths.append(wavelength)
        for series_idx in range(series_count):
            token = row[series_idx + 1].strip() if series_idx + 1 < len(row) else ""
            spectra[series_idx].append(parse_number(token) if token else float("nan"))

    if not wavelengths:
        raise ValueError("No wavelength rows found in long-format spectral block.")
    return wavelengths, spectra, encoding


def irradiance_to_photon_flux(wavelength_nm: float, ee_w_per_sqm_nm: float) -> float:
    if math.isnan(ee_w_per_sqm_nm):
        return float("nan")
    return ee_w_per_sqm_nm * wavelength_nm * EE_TO_UMOL_FACTOR


def convert_spectra_to_photon_flux(wavelengths: list[float], spectra: list[list[float]]) -> list[list[float]]:
    converted: list[list[float]] = []
    for values in spectra:
        converted.append(
            [
                irradiance_to_photon_flux(wavelength_nm, ee_value)
                for wavelength_nm, ee_value in zip(wavelengths, values)
            ]
        )
    return converted


def integrate_trapezoid(x: list[float], y: list[float]) -> float:
    if len(x) < 2:
        return 0.0

    integral = 0.0
    for x1, x2, y1, y2 in zip(x[:-1], x[1:], y[:-1], y[1:]):
        if math.isnan(y1) or math.isnan(y2):
            continue
        integral += (x2 - x1) * (y1 + y2) * 0.5
    return integral


def calc_total_par_umol_per_s_sqm(
    wavelengths: list[float], photon_flux_spectrum: list[float], par_min_nm: float = PAR_MIN_NM, par_max_nm: float = PAR_MAX_NM
) -> float:
    par_points = [
        (wavelength_nm, photon_flux)
        for wavelength_nm, photon_flux in zip(wavelengths, photon_flux_spectrum)
        if par_min_nm <= wavelength_nm <= par_max_nm and not math.isnan(photon_flux)
    ]
    if len(par_points) < 2:
        return 0.0
    par_wavelengths = [wavelength_nm for wavelength_nm, _ in par_points]
    par_values = [photon_flux for _, photon_flux in par_points]
    return integrate_trapezoid(par_wavelengths, par_values)


def write_par_csv(par_csv_path: Path, labels: list[str], par_totals: list[float]) -> None:
    with par_csv_path.open("w", newline="", encoding="utf-8-sig") as handle:
        writer = csv.writer(handle, delimiter=";")
        writer.writerow(["Series", "PAR range [nm]", "Total PAR [umol/(s*sqm)]"])
        for label, total_par in zip(labels, par_totals):
            writer.writerow([label, f"{PAR_MIN_NM:.0f}-{PAR_MAX_NM:.0f}", f"{total_par:.6f}"])


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Plot all long-format spectra from one CSV, with wavelength on the x-axis."
    )
    parser.add_argument(
        "csv_path",
        nargs="?",
        default=str(Path(__file__).with_name("G4_5%_increments_3_lamps.csv")),
        help="Path to the combined 3-lamp CSV file (long spectral format).",
    )
    parser.add_argument("--save", type=str, help="Optional output image path.")
    parser.add_argument(
        "--par-csv",
        type=str,
        help="Optional CSV output path for total PAR per series. Defaults to <input_stem>_total_par_umol.csv",
    )
    parser.add_argument("--no-show", action="store_true", help="Skip opening the plot window.")
    parser.add_argument("--legend", action="store_true", help="Show legend for all series.")
    args = parser.parse_args()

    csv_path = Path(args.csv_path)
    if not csv_path.exists():
        raise FileNotFoundError(f"CSV not found: {csv_path}")

    wavelengths, spectra, encoding = read_long_spectra(csv_path)
    labels = build_series_labels(len(spectra))
    photon_flux_spectra = convert_spectra_to_photon_flux(wavelengths, spectra)
    par_totals = [calc_total_par_umol_per_s_sqm(wavelengths, spectrum) for spectrum in photon_flux_spectra]

    print(f"Loaded: {csv_path}")
    print(f"Encoding: {encoding}")
    print(f"Wavelength points: {len(wavelengths)}")
    print(f"Series: {len(spectra)}")
    print(f"PAR range: {PAR_MIN_NM:.0f}-{PAR_MAX_NM:.0f} nm")

    par_csv_path = Path(args.par_csv) if args.par_csv else csv_path.with_name(f"{csv_path.stem}_total_par_umol.csv")
    write_par_csv(par_csv_path, labels, par_totals)
    print(f"Saved PAR CSV: {par_csv_path}")

    plt.figure(figsize=(13, 7))
    for label, values in zip(labels, photon_flux_spectra):
        plt.plot(wavelengths, values, linewidth=1.1, alpha=0.9, label=label)

    plt.xlabel("Wavelength (nm)")
    plt.ylabel("Photon flux density [umol/(s*sqm*nm)]")
    plt.title("G4 3 Lamps: 60 Spectra vs Wavelength (Photon Flux)")
    plt.grid(True, alpha=0.3)
    if args.legend:
        plt.legend(loc="upper left", fontsize=7, ncol=3, framealpha=0.85)
    plt.tight_layout()

    if args.save:
        output_path = Path(args.save)
        plt.savefig(output_path, dpi=180)
        print(f"Saved plot: {output_path}")

    if not args.no_show:
        plt.show()


if __name__ == "__main__":
    main()
