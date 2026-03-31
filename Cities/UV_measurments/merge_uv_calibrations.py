from __future__ import annotations

import argparse
import math
import re
from dataclasses import dataclass
from pathlib import Path


ROOM_RE = re.compile(r"(?<![A-Za-z0-9])(G[4568])(?![A-Za-z0-9])", re.IGNORECASE)


@dataclass
class MergeResult:
    room: str
    standard_name: str
    uv_name: str | None
    output_name: str | None
    status: str
    detail: str


def detect_room(path: Path) -> str | None:
    match = ROOM_RE.search(path.stem)
    return match.group(1).upper() if match else None


def is_standard_csv(path: Path) -> bool:
    return "_calibration_file" in path.stem.lower()


def is_uv_csv(path: Path) -> bool:
    stem = path.stem.lower()
    return not is_standard_csv(path) and any(token in stem for token in ("25", "50", "75", "100"))


def read_lines(path: Path) -> list[str]:
    for encoding in ("utf-8-sig", "cp1252", "latin-1"):
        try:
            return path.read_text(encoding=encoding).splitlines()
        except UnicodeDecodeError:
            continue
    raise UnicodeDecodeError("unknown", b"", 0, 1, f"Could not decode {path}")


def first_cell(line: str) -> str:
    return line.split(";", 1)[0].strip()


def find_first_row(lines: list[str], label: str) -> int | None:
    for index, line in enumerate(lines):
        if first_cell(line) == label:
            return index
    return None


def parse_numeric(cell: str) -> float | None:
    text = cell.strip()
    if not text:
        return None
    try:
        return float(text.replace(",", "."))
    except ValueError:
        return None


def scale_numeric_text(cell: str, factor: float) -> str:
    value = parse_numeric(cell)
    if value is None:
        return cell

    stripped = cell.strip()
    if "E" in stripped.upper():
        mantissa, exponent = re.split(r"[Ee]", stripped, maxsplit=1)
        decimals = 0
        if "," in mantissa:
            decimals = len(mantissa.split(",", 1)[1])
        elif "." in mantissa:
            decimals = len(mantissa.split(".", 1)[1])
        return f"{value * factor:.{decimals}E}".replace(".", ",")

    decimals = 0
    if "," in stripped:
        decimals = len(stripped.split(",", 1)[1])
    elif "." in stripped:
        decimals = len(stripped.split(".", 1)[1])
    return f"{value * factor:.{decimals}f}".replace(".", ",")


def scale_row_values(line: str, factor: float) -> str:
    parts = line.split(";")
    scaled = [parts[0]]
    scaled.extend(scale_numeric_text(cell, factor) for cell in parts[1:])
    return ";".join(scaled)


def convert_uv_radiance_to_irradiance(lines: list[str]) -> tuple[list[str], bool]:
    mode_idx = find_first_row(lines, "Measuring mode")
    spectral_idx = find_first_row(lines, "Wavelength [nm]")
    if mode_idx is None or spectral_idx is None:
        return lines, False

    mode_parts = lines[mode_idx].split(";")
    if not any(part.strip() == "Radiance" for part in mode_parts[1:]):
        return lines, False

    converted = list(lines)
    pi = math.pi

    converted[mode_idx] = ";".join(
        [mode_parts[0], *["Irradiance" if part.strip() == "Radiance" else part for part in mode_parts[1:]]]
    )

    for index, line in enumerate(converted):
        label = first_cell(line)
        if label.startswith("Lv [cd/sqm]"):
            converted[index] = scale_row_values(line.replace("Lv [cd/sqm]", "Ev [lx]"), pi)
        elif label.startswith("Le [W/(sr*sqm)]"):
            converted[index] = scale_row_values(line.replace("Le [W/(sr*sqm)]", "Ee [W/sqm]"), pi)
        elif label.startswith("Ephot "):
            converted[index] = scale_row_values(line, pi)

    spectral_parts = converted[spectral_idx].split(";")
    converted[spectral_idx] = ";".join(
        [spectral_parts[0], *[part.replace("Le [W/(sr*sqm*nm)]", "Ee [W/(sqm*nm)]") for part in spectral_parts[1:]]]
    )

    for index in range(spectral_idx + 1, len(converted)):
        label = first_cell(converted[index])
        if not label:
            continue
        if parse_numeric(label) is None:
            break
        converted[index] = scale_row_values(converted[index], pi)

    return converted, True


def merge_lines(standard_lines: list[str], uv_lines: list[str]) -> list[str]:
    std_header_idx = find_first_row(standard_lines, "Wavelength [nm]")
    uv_header_idx = find_first_row(uv_lines, "Wavelength [nm]")

    if std_header_idx is None or uv_header_idx is None:
        merged: list[str] = []
        total = max(len(standard_lines), len(uv_lines))
        for index in range(total):
            left = standard_lines[index] if index < len(standard_lines) else ""
            right = uv_lines[index] if index < len(uv_lines) else ""
            merged.append(f"{left};{right}")
        return merged

    merged: list[str] = []
    uv_index = 0
    uv_metadata_end = uv_header_idx
    while uv_metadata_end > 0 and first_cell(uv_lines[uv_metadata_end - 1]) == "":
        uv_metadata_end -= 1

    for std_index in range(std_header_idx):
        left = standard_lines[std_index]
        right = ""
        if uv_index < uv_metadata_end and first_cell(left) == first_cell(uv_lines[uv_index]):
            right = uv_lines[uv_index]
            uv_index += 1
        merged.append(f"{left};{right}")

    merged.append(f"{standard_lines[std_header_idx]};{uv_lines[uv_header_idx]}")

    std_tail = standard_lines[std_header_idx + 1 :]
    uv_tail = uv_lines[uv_header_idx + 1 :]
    total_tail = max(len(std_tail), len(uv_tail))
    for index in range(total_tail):
        left = std_tail[index] if index < len(std_tail) else ""
        right = uv_tail[index] if index < len(uv_tail) else ""
        merged.append(f"{left};{right}")

    return merged


def build_room_maps(input_dir: Path) -> tuple[dict[str, Path], dict[str, Path]]:
    standards: dict[str, Path] = {}
    uvs: dict[str, Path] = {}

    for path in sorted(input_dir.glob("*.csv")):
        room = detect_room(path)
        if not room:
            continue
        if is_standard_csv(path):
            standards[room] = path
        elif is_uv_csv(path):
            uvs[room] = path

    return standards, uvs


def merge_folder(input_dir: Path, output_dir: Path, copy_unmatched_standard: bool) -> list[MergeResult]:
    output_dir.mkdir(parents=True, exist_ok=True)
    standards, uvs = build_room_maps(input_dir)
    results: list[MergeResult] = []

    for room, standard_path in sorted(standards.items()):
        uv_path = uvs.get(room)
        output_path = output_dir / standard_path.name

        if uv_path is None:
            if copy_unmatched_standard:
                output_path.write_text(
                    "\n".join(read_lines(standard_path)) + "\n",
                    encoding="utf-8",
                    newline="\n",
                )
                results.append(
                    MergeResult(
                        room=room,
                        standard_name=standard_path.name,
                        uv_name=None,
                        output_name=output_path.name,
                        status="copied",
                        detail="No UV file found; copied standard CSV unchanged.",
                    )
                )
            else:
                results.append(
                    MergeResult(
                        room=room,
                        standard_name=standard_path.name,
                        uv_name=None,
                        output_name=None,
                        status="skipped",
                        detail="No UV file found.",
                    )
                )
            continue

        standard_lines = read_lines(standard_path)
        uv_lines, converted_from_radiance = convert_uv_radiance_to_irradiance(read_lines(uv_path))
        merged_lines = merge_lines(standard_lines, uv_lines)
        output_path.write_text("\n".join(merged_lines) + "\n", encoding="utf-8", newline="\n")
        detail = f"Merged {len(merged_lines)} rows."
        if converted_from_radiance:
            detail += " Converted UV radiance to approximate irradiance using Ee = pi * Le."
        results.append(
            MergeResult(
                room=room,
                standard_name=standard_path.name,
                uv_name=uv_path.name,
                output_name=output_path.name,
                status="merged",
                detail=detail,
            )
        )

    for room, uv_path in sorted(uvs.items()):
        if room in standards:
            continue
        results.append(
            MergeResult(
                room=room,
                standard_name="",
                uv_name=uv_path.name,
                output_name=None,
                status="orphan_uv",
                detail="UV file found without a matching standard calibration CSV.",
            )
        )

    return results


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Paste UV Jeti CSV blocks onto the right side of matching standard calibration CSVs."
    )
    parser.add_argument(
        "--input-dir",
        default=r"C:\Users\maart\Downloads\UV_Input",
        help="Folder containing standard calibration CSVs and separate UV CSVs.",
    )
    parser.add_argument(
        "--output-dir",
        default=r"C:\Users\maart\Downloads\UV_Output",
        help="Folder where merged standard CSVs will be written.",
    )
    parser.add_argument(
        "--copy-unmatched-standard",
        action="store_true",
        help="Copy standard CSVs without a UV partner into the output folder unchanged.",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    input_dir = Path(args.input_dir)
    output_dir = Path(args.output_dir)

    if not input_dir.exists():
        raise SystemExit(f"Input folder does not exist: {input_dir}")

    results = merge_folder(input_dir, output_dir, copy_unmatched_standard=args.copy_unmatched_standard)

    for result in results:
        parts = [result.room, result.status]
        if result.standard_name:
            parts.append(result.standard_name)
        if result.uv_name:
            parts.append(result.uv_name)
        if result.output_name:
            parts.append(f"-> {result.output_name}")
        print(" | ".join(parts))
        print(f"  {result.detail}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
