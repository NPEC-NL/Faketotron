from __future__ import annotations

import argparse
import csv
from pathlib import Path

import matplotlib.pyplot as plt


METRIC_ROW = "Ephot (Begin..End) [umol/s sqm]"
LAMP_NAMES = ("Cool White", "Deep Red", "Far Red")
STEPS_PER_LAMP = 20
DIMMING_STEPS = [i * 5 for i in range(1, STEPS_PER_LAMP + 1)]


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


def read_metric_values(csv_path: Path, metric_row_name: str = METRIC_ROW) -> list[float]:
    encodings_to_try = ("utf-8-sig", "cp1252")

    for encoding in encodings_to_try:
        try:
            with csv_path.open("r", encoding=encoding, newline="") as handle:
                reader = csv.reader(handle, delimiter=";")
                for row in reader:
                    if not row:
                        continue
                    header = row[0].strip()
                    if header != metric_row_name:
                        continue
                    values: list[float] = []
                    for token in row[1:]:
                        token = token.strip()
                        if not token:
                            continue
                        values.append(parse_number(token))
                    return values
        except UnicodeDecodeError:
            continue
    raise ValueError(f"Row not found: {metric_row_name}")


def split_lamp_series(values: list[float]) -> dict[str, list[float]]:
    expected = STEPS_PER_LAMP * len(LAMP_NAMES)
    if len(values) < expected:
        raise ValueError(f"Expected at least {expected} values, got {len(values)}.")

    values = values[:expected]
    return {
        lamp: values[idx * STEPS_PER_LAMP : (idx + 1) * STEPS_PER_LAMP]
        for idx, lamp in enumerate(LAMP_NAMES)
    }


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Plot 5%..100% measurements for Cool White, Deep Red, and Far Red from one CSV."
    )
    parser.add_argument(
        "csv_path",
        nargs="?",
        default=str(Path(__file__).with_name("G4_5%_increments_3_lamps.csv")),
        help="Path to the combined 3-lamp CSV file.",
    )
    parser.add_argument("--save", type=str, help="Optional output image path.")
    parser.add_argument("--no-show", action="store_true", help="Skip opening the plot window.")
    args = parser.parse_args()

    csv_path = Path(args.csv_path)
    if not csv_path.exists():
        raise FileNotFoundError(f"CSV not found: {csv_path}")

    values = read_metric_values(csv_path)
    lamp_series = split_lamp_series(values)

    print(f"Loaded: {csv_path}")
    print(f"Metric: {METRIC_ROW}")
    for lamp in LAMP_NAMES:
        print(f"{lamp}: {len(lamp_series[lamp])} points")

    plt.figure(figsize=(10, 5))
    for lamp in LAMP_NAMES:
        plt.plot(DIMMING_STEPS, lamp_series[lamp], marker="o", linewidth=2, label=lamp)

    plt.xticks(DIMMING_STEPS)
    plt.xlabel("Dimming level (%)")
    plt.ylabel("Ephot (umol/s sqm)")
    plt.title("G4 3 Lamps: PAR Photon Flux vs Dimming Level")
    plt.grid(True, alpha=0.3)
    plt.legend()
    plt.tight_layout()

    if args.save:
        output_path = Path(args.save)
        plt.savefig(output_path, dpi=180)
        print(f"Saved plot: {output_path}")

    if not args.no_show:
        plt.show()


if __name__ == "__main__":
    main()
