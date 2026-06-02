import React, { useEffect, useMemo, useState } from "react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend,
  BarChart,
  Bar,
} from "recharts";

import * as Store from "../state/store";
import { newProtocol, type ProfileKey, type Protocol } from "../profiles";
import { detectRoomFromFilename, type RoomConfig } from "../utils/rooms";
import { parseLampCalibrationCsv, safeNumber, spectrumAtPercent, toUmol, type SpectrumPoint } from "../utils/spectra";

const useProto: any = (Store as any).useProto ?? (Store as any).useStore;

const FILTER_KEYS = [
  "measurement_table",
  "measurement_setup",
  "sun_included",
  "patch",
  "patch_almucantar",
  "patch_azimuth",
] as const;
const SLICE_KEYS = FILTER_KEYS.filter((key) => key !== "measurement_table") as Array<Exclude<FilterKey, "measurement_table">>;
const PREFERRED_MEASUREMENT_TABLES = [
  "spectral_horizontal_irradiance",
  "spectral_direct_irradiance",
  "spectral_patch_radiance",
];
const PLAYBACK_STEP_MS = 250;
const EDGE_RAMP_STEPS = 3;
const CITY_CSV_DOWNLOAD_URL = "https://drive.google.com/drive/folders/1buBKSUWX2Svbk5Vlw58VfwaRszjJ3cVf?";
const CITY_LOCATION_ROWS = [
  {
    code: "CN-PKX",
    name: "Beijing",
    country: "China",
    timezone: "Asia/Shanghai",
    latitude: "39.75 N",
    longitude: "116.96 E",
    altitude: "36",
    environment: "urban",
  },
  {
    code: "DE-BLN",
    name: "Berlin",
    country: "Germany",
    timezone: "Europe/Berlin",
    latitude: "52.51 N",
    longitude: "13.33 E",
    altitude: "35",
    environment: "urban",
  },
  {
    code: "ES-UGR",
    name: "Granada",
    country: "Spain",
    timezone: "Europe/Madrid",
    latitude: "37.18 N",
    longitude: "3.62 W",
    altitude: "680",
    environment: "urban",
  },
  {
    code: "FR-VLX",
    name: "Vaulx-en-Velin",
    country: "France",
    timezone: "Europe/Paris",
    latitude: "45.78 N",
    longitude: "4.93 E",
    altitude: "170",
    environment: "urban",
  },
  {
    code: "SG-SIN",
    name: "Singapore",
    country: "Singapore",
    timezone: "Asia/Singapore",
    latitude: "1.21 N",
    longitude: "103.82 E",
    altitude: "15",
    environment: "urban",
  },
  {
    code: "ES-MAD",
    name: "Madrid",
    country: "Spain",
    timezone: "Europe/Madrid",
    latitude: "40.42 N",
    longitude: "3.70 W",
    altitude: "667",
    environment: "urban",
  },
  {
    code: "US-ABQ",
    name: "Albuquerque",
    country: "United States",
    timezone: "America/Denver",
    latitude: "35.05 N",
    longitude: "106.54 W",
    altitude: "1656",
    environment: "urban",
  },
] as const;

type FilterKey = (typeof FILTER_KEYS)[number];
type CoverageMode = "sparse" | "expanded";
type SpectrumView = "target" | "reconstructed" | "both";
type CityUnit = "energy" | "photon";
type TemperatureMode = "constant" | "follow-light";
type DataSourceKind = "cities" | "psi";

const SPECTRUM_UNIT_LABEL = "μmol m⁻² s⁻¹ nm⁻¹";
const SCHEDULE_UNIT_LABEL = "%";

function formatAxisFloat(value: number): string {
  if (!Number.isFinite(value)) return "";
  const digits = value >= 10 ? 1 : 2;
  return value.toFixed(digits);
}

type MonthOption = {
  value: number;
  label: string;
};

type CalibrationBin = {
  timeBinMinutes: number;
  timeOfDay: string;
  samplesAveraged: number | null;
  wasFilled: boolean;
  targetSpectrum: number[];
  reconstructedSpectrum: number[];
  lampPercentages: Record<string, number>;
  fit: {
    rmse: number | null;
    mae: number | null;
    success: boolean;
    nfev: number | null;
    targetIntegral: number | null;
    reconstructedIntegral: number | null;
  };
};

type CalibrationSelection = {
  city: string;
  month: number;
  monthName: string;
  measurement_table: string;
  measurement_setup: string;
  sun_included: string;
  patch: string;
  patch_almucantar: string;
  patch_azimuth: string;
};

type CalibrationResult = {
  coverageMode: CoverageMode;
  selection: CalibrationSelection;
  room: RoomConfig;
  wavelengthsNm: number[];
  sparseBins: CalibrationBin[];
  expandedBins: CalibrationBin[];
};

type ParsedCityRow = {
  locationName: string;
  locationCode: string;
  month: number;
  monthName: string;
  timeBinMinutes: number;
  timeOfDay: string;
  samplesAveraged: number | null;
  filters: Record<FilterKey, string>;
  spectrum: number[];
};

type ParsedCityFile = {
  fileName: string;
  sourceKind: DataSourceKind;
  sourceUnit: CityUnit;
  wavelengthsNm: number[];
  rows: ParsedCityRow[];
  cities: string[];
  meta?: {
    measurementDateLabel?: string;
    rawMeasurementCount?: number;
    keptMeasurementCount?: number;
    duplicateColumnsRemoved?: number;
  };
};

type TargetBin = {
  timeBinMinutes: number;
  timeOfDay: string;
  samplesAveraged: number | null;
  wasFilled: boolean;
  targetSpectrum: number[];
};

const DEFAULT_FILTERS: Record<FilterKey, string> = {
  measurement_table: "",
  measurement_setup: "",
  sun_included: "",
  patch: "",
  patch_almucantar: "",
  patch_azimuth: "",
};

function labelForFilter(key: FilterKey): string {
  return key
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function hasSpectrumSignal(values: number[]): boolean {
  return values.some((value) => Math.abs(value) > 1e-12);
}

function scaleSpectrum(values: number[], factor: number): number[] {
  return values.map((value) => value * factor);
}

function csvEscape(value: unknown): string {
  const text = value == null ? "" : String(value);
  if (!/[",\n]/.test(text)) return text;
  return `"${text.replace(/"/g, '""')}"`;
}

function downloadText(name: string, text: string, mime = "text/csv;charset=utf-8") {
  const anchor = document.createElement("a");
  anchor.href = "data:" + mime + "," + encodeURIComponent(text);
  anchor.download = name;
  anchor.click();
}

function durationPoint(value: number): [string, number] {
  const clamped = Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0));
  return ["00:05:00", Number(clamped.toFixed(4))];
}

function minutesToDurationString(minutes: number): string {
  const totalSeconds = Math.max(1, Math.round((Number.isFinite(minutes) ? minutes : 0) * 60));
  const hours = Math.floor(totalSeconds / 3600);
  const mins = Math.floor((totalSeconds % 3600) / 60);
  const secs = totalSeconds % 60;
  return `${String(hours).padStart(2, "0")}:${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

function durationMinutesAtIndex(sortedBins: CalibrationBin[], index: number): number {
  if (sortedBins.length <= 1) return 5;
  if (index < sortedBins.length - 1) {
    return sortedBins[index + 1].timeBinMinutes - sortedBins[index].timeBinMinutes;
  }
  return sortedBins[index].timeBinMinutes - sortedBins[index - 1].timeBinMinutes;
}

function binsToDurationPoints(bins: CalibrationBin[], channelKey: string): Array<[string, number]> {
  if (bins.length === 0) return [];

  const sorted = [...bins].sort((a, b) => a.timeBinMinutes - b.timeBinMinutes);
  return sorted.map((bin, index) => {
    const durationMinutes = durationMinutesAtIndex(sorted, index);
    const clamped = Math.max(0, Math.min(100, Number(bin.lampPercentages[channelKey] ?? 0)));
    return [minutesToDurationString(durationMinutes), Number(clamped.toFixed(4))];
  });
}

function splitCsvLine(line: string, delimiter: string): string[] {
  const cells: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let index = 0; index < line.length; index++) {
    const char = line[index];
    if (inQuotes) {
      if (char === '"') {
        if (line[index + 1] === '"') {
          current += '"';
          index += 1;
        } else {
          inQuotes = false;
        }
      } else {
        current += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
      continue;
    }
    if (char === delimiter) {
      cells.push(current);
      current = "";
      continue;
    }
    current += char;
  }

  cells.push(current);
  return cells;
}

function normalizeDimensionValue(column: FilterKey, value: unknown): string {
  const normalized = String(value ?? "").trim();
  if (!normalized || normalized.toLowerCase() === "nan") return "";
  if (column === "sun_included") {
    const lower = normalized.toLowerCase();
    if (lower === "1") return "true";
    if (lower === "0") return "false";
    return lower;
  }
  return normalized;
}

function parseTimeOfDayToMinutes(value: string): number | null {
  const match = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(value.trim());
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

function formatTimeOfDay(minutes: number): string {
  const clamped = Math.max(0, minutes);
  return `${String(Math.floor(clamped / 60)).padStart(2, "0")}:${String(clamped % 60).padStart(2, "0")}`;
}

function detectCityCsvUnit(lines: string[], header: string[]): CityUnit {
  const unitIndex = header.findIndex((column) => column === "fit_unit" || column === "unit");
  if (unitIndex >= 0) {
    const values = Array.from(
      new Set(
        lines
          .slice(1)
          .map((line) => splitCsvLine(line, ",")[unitIndex] ?? "")
          .map((value) => String(value).trim().toLowerCase())
          .filter(Boolean),
      ),
    );
    if (values.includes("photon")) return "photon";
    if (values.includes("energy")) return "energy";
  }

  return "energy";
}

function cityUnitLabel(unit: CityUnit): string {
  return unit === "photon" ? "Photon: umol/(s*m2*nm)" : "Energy: W/(m2*nm)";
}

function parsePsiTimestamp(value: string): {
  dateKey: string;
  dateLabel: string;
  timestampKey: string;
  timeBinMinutes: number;
  timeOfDay: string;
} | null {
  const match = /^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(String(value ?? "").trim());
  if (!match) return null;

  const day = Number(match[1]);
  const month = Number(match[2]);
  const rawYear = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6] ?? "0");
  const year = rawYear < 100 ? 2000 + rawYear : rawYear;

  if (
    !Number.isFinite(day) ||
    !Number.isFinite(month) ||
    !Number.isFinite(year) ||
    !Number.isFinite(hour) ||
    !Number.isFinite(minute) ||
    !Number.isFinite(second)
  ) {
    return null;
  }

  return {
    dateKey: `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
    dateLabel: `${String(day).padStart(2, "0")}/${String(month).padStart(2, "0")}/${String(year).padStart(4, "0")}`,
    timestampKey: `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")} ${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:${String(second).padStart(2, "0")}`,
    timeBinMinutes: hour * 60 + minute + second / 60,
    timeOfDay: `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:${String(second).padStart(2, "0")}`,
  };
}

function parseCityAverageDayCsv(text: string, fileName: string): ParsedCityFile {
  const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length < 2) throw new Error("City CSV is empty.");

  const header = splitCsvLine(lines[0], ",").map((cell) => cell.trim());
  const unit = detectCityCsvUnit(lines, header);
  const spectralColumns = header
    .map((column, index) => ({ column, index, nm: Number(column) }))
    .filter((entry) => Number.isFinite(entry.nm))
    .sort((a, b) => a.nm - b.nm);
  if (spectralColumns.length === 0) {
    throw new Error("No wavelength columns were found in the uploaded city CSV.");
  }

  const columnIndex = (name: string) => header.findIndex((column) => column === name);
  const idxLocationName = columnIndex("location_name");
  const idxLocationCode = columnIndex("location_code");
  const idxMonth = columnIndex("month");
  const idxMonthName = columnIndex("month_name");
  const idxTimeBin = columnIndex("time_bin_minutes");
  const idxTimeOfDay = columnIndex("time_of_day");
  const idxSamples = columnIndex("samples_averaged");

  if (idxLocationName < 0 || idxMonth < 0 || idxTimeBin < 0) {
    throw new Error("City CSV is missing one of the required columns: location_name, month, time_bin_minutes.");
  }

  const getFilter = (row: string[], key: FilterKey) => {
    const idx = columnIndex(key);
    return idx >= 0 ? normalizeDimensionValue(key, row[idx]) : "";
  };

  const rows: ParsedCityRow[] = [];
  for (const line of lines.slice(1)) {
    const cells = splitCsvLine(line, ",");
    const month = Math.trunc(safeNumber(cells[idxMonth]));
    const locationName = String(cells[idxLocationName] ?? "").trim();
    const timeBinMinutes = Math.trunc(
      safeNumber(cells[idxTimeBin] ?? (idxTimeOfDay >= 0 ? parseTimeOfDayToMinutes(String(cells[idxTimeOfDay] ?? "")) : Number.NaN)),
    );

    if (!locationName || !Number.isFinite(month) || !Number.isFinite(timeBinMinutes)) continue;

    rows.push({
      locationName,
      locationCode: idxLocationCode >= 0 ? String(cells[idxLocationCode] ?? "").trim() : "",
      month,
      monthName: idxMonthName >= 0 ? String(cells[idxMonthName] ?? "").trim() : String(month),
      timeBinMinutes,
      timeOfDay:
        idxTimeOfDay >= 0 && String(cells[idxTimeOfDay] ?? "").trim()
          ? String(cells[idxTimeOfDay] ?? "").trim()
          : formatTimeOfDay(timeBinMinutes),
      samplesAveraged:
        idxSamples >= 0 && String(cells[idxSamples] ?? "").trim()
          ? safeNumber(cells[idxSamples])
          : null,
      filters: {
        measurement_table: getFilter(cells, "measurement_table"),
        measurement_setup: getFilter(cells, "measurement_setup"),
        sun_included: getFilter(cells, "sun_included"),
        patch: getFilter(cells, "patch"),
        patch_almucantar: getFilter(cells, "patch_almucantar"),
        patch_azimuth: getFilter(cells, "patch_azimuth"),
      },
      spectrum: spectralColumns.map(({ index, nm }) => {
        const rawValue = safeNumber(cells[index]);
        return unit === "energy" ? toUmol(rawValue, nm) : rawValue;
      }),
    });
  }

  if (rows.length === 0) throw new Error("No usable rows were parsed from the uploaded city CSV.");

  return {
    fileName,
    sourceKind: "cities",
    sourceUnit: unit,
    wavelengthsNm: spectralColumns.map((entry) => entry.nm),
    rows,
    cities: Array.from(new Set(rows.map((row) => row.locationName))).sort((a, b) => a.localeCompare(b)),
  };
}

function parsePsiPhotonFluxCsv(text: string, fileName: string): ParsedCityFile {
  const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length < 7) {
    throw new Error("PSI PhotonFluxDensity.csv is too short to contain timestamps and spectra.");
  }

  const splitTabLine = (line: string) => splitCsvLine(line, "\t").map((cell) => cell.trim());
  const timeLineIndex = lines.findIndex((line) => splitTabLine(line)[0]?.toLowerCase() === "time");
  if (timeLineIndex < 0) {
    throw new Error("PSI PhotonFluxDensity.csv is missing the 'Time' row.");
  }

  const wavelengthHeaderIndex = lines.findIndex((line, index) => index > timeLineIndex && splitTabLine(line)[0]?.toLowerCase() === "[nm]");
  if (wavelengthHeaderIndex < 0) {
    throw new Error("PSI PhotonFluxDensity.csv is missing the '[nm]' row.");
  }

  const timeCells = splitTabLine(lines[timeLineIndex]);
  const uniqueColumns: Array<{
    columnIndex: number;
    dateKey: string;
    dateLabel: string;
    timestampKey: string;
    timeBinMinutes: number;
    timeOfDay: string;
  }> = [];
  const seenTimestamps = new Set<string>();
  const measurementDates = new Set<string>();
  let duplicateColumnsRemoved = 0;

  for (let columnIndex = 1; columnIndex < timeCells.length; columnIndex += 1) {
    const parsed = parsePsiTimestamp(timeCells[columnIndex]);
    if (!parsed) continue;
    measurementDates.add(parsed.dateKey);
    if (seenTimestamps.has(parsed.timestampKey)) {
      duplicateColumnsRemoved += 1;
      continue;
    }
    seenTimestamps.add(parsed.timestampKey);
    uniqueColumns.push({ columnIndex, ...parsed });
  }

  if (uniqueColumns.length === 0) {
    throw new Error("No usable timestamps were found in the PSI PhotonFluxDensity.csv file.");
  }
  if (measurementDates.size > 1) {
    throw new Error("PSI PhotonFluxDensity.csv must contain measurements from a single date.");
  }

  const spectralRows: Array<{ nm: number; values: number[] }> = [];
  for (const line of lines.slice(wavelengthHeaderIndex + 1)) {
    const cells = splitTabLine(line);
    const nm = safeNumber(cells[0]);
    if (!Number.isFinite(nm) || nm <= 0) continue;
    spectralRows.push({
      nm,
      values: uniqueColumns.map(({ columnIndex }) => safeNumber(cells[columnIndex])),
    });
  }

  if (spectralRows.length === 0) {
    throw new Error("No spectral wavelength rows were found in the PSI PhotonFluxDensity.csv file.");
  }

  const measurementDateLabel = uniqueColumns[0]?.dateLabel ?? "";
  const rows: ParsedCityRow[] = uniqueColumns.map((column, measurementIndex) => ({
    locationName: "PSI spectrometer",
    locationCode: "PSI",
    month: 1,
    monthName: measurementDateLabel || "Measurement day",
    timeBinMinutes: column.timeBinMinutes,
    timeOfDay: column.timeOfDay,
    samplesAveraged: null,
    filters: { ...DEFAULT_FILTERS },
    spectrum: spectralRows.map((row) => row.values[measurementIndex] ?? 0),
  }));

  return {
    fileName,
    sourceKind: "psi",
    sourceUnit: "photon",
    wavelengthsNm: spectralRows.map((row) => row.nm),
    rows,
    cities: ["PSI spectrometer"],
    meta: {
      measurementDateLabel,
      rawMeasurementCount: timeCells.length - 1,
      keptMeasurementCount: uniqueColumns.length,
      duplicateColumnsRemoved,
    },
  };
}

function applyFilter(rows: ParsedCityRow[], key: FilterKey, value: string): ParsedCityRow[] {
  if (!value) return rows;
  return rows.filter((row) => row.filters[key] === normalizeDimensionValue(key, value));
}

function distinctValues(rows: ParsedCityRow[], key: FilterKey): string[] {
  return Array.from(new Set(rows.map((row) => row.filters[key]).filter(Boolean))).sort((a, b) => a.localeCompare(b));
}

function bestValidSlice(rows: ParsedCityRow[]): Record<Exclude<FilterKey, "measurement_table">, string> {
  const groups = new Map<string, { values: Record<Exclude<FilterKey, "measurement_table">, string>; rowCount: number; uniqueBins: Set<number> }>();

  for (const row of rows) {
    const values = {
      measurement_setup: row.filters.measurement_setup,
      sun_included: row.filters.sun_included,
      patch: row.filters.patch,
      patch_almucantar: row.filters.patch_almucantar,
      patch_azimuth: row.filters.patch_azimuth,
    };
    const groupKey = SLICE_KEYS.map((field) => values[field]).join("\u0001");
    const existing = groups.get(groupKey);
    if (existing) {
      existing.rowCount += 1;
      existing.uniqueBins.add(row.timeBinMinutes);
    } else {
      groups.set(groupKey, { values, rowCount: 1, uniqueBins: new Set([row.timeBinMinutes]) });
    }
  }

  const valid = Array.from(groups.values()).filter((group) => group.rowCount === group.uniqueBins.size);
  if (valid.length === 0) {
    throw new Error("No unique measurement slice remained after auto-selection for this city/month.");
  }

  valid.sort((a, b) => {
    const uniqueDiff = b.uniqueBins.size - a.uniqueBins.size;
    if (uniqueDiff !== 0) return uniqueDiff;

    const sunPriority = (value: string) => (value === "true" ? 0 : value === "false" ? 1 : value ? 3 : 2);
    const sunDiff = sunPriority(a.values.sun_included) - sunPriority(b.values.sun_included);
    if (sunDiff !== 0) return sunDiff;

    const rowDiff = b.rowCount - a.rowCount;
    if (rowDiff !== 0) return rowDiff;

    return (
      SLICE_KEYS
        .map((field) => a.values[field].localeCompare(b.values[field]))
        .find((value) => value !== 0) ?? 0
    );
  });

  return valid[0].values;
}

function resolveRecommendedSelection(rows: ParsedCityRow[]): Record<FilterKey, string> {
  const availableTables = distinctValues(rows, "measurement_table");
  if (availableTables.length === 0) {
    const best = bestValidSlice(rows);
    return {
      measurement_table: "",
      measurement_setup: best.measurement_setup || "",
      sun_included: best.sun_included || "",
      patch: best.patch || "",
      patch_almucantar: best.patch_almucantar || "",
      patch_azimuth: best.patch_azimuth || "",
    };
  }

  const tableCandidates = Array.from(new Set([...PREFERRED_MEASUREMENT_TABLES, ...availableTables])).filter(Boolean);

  for (const table of tableCandidates) {
    const working = applyFilter(rows, "measurement_table", table);
    if (working.length === 0) continue;
    try {
      const best = bestValidSlice(working);
      return {
        measurement_table: table,
        measurement_setup: best.measurement_setup || "",
        sun_included: best.sun_included || "",
        patch: best.patch || "",
        patch_almucantar: best.patch_almucantar || "",
        patch_azimuth: best.patch_azimuth || "",
      };
    } catch {
      continue;
    }
  }

  throw new Error("No unique measurement slice remained after auto-selection for this city/month.");
}

function ensureUniqueBins(rows: ParsedCityRow[]): ParsedCityRow[] {
  const sorted = [...rows].sort((a, b) => a.timeBinMinutes - b.timeBinMinutes);
  const seen = new Set<number>();
  for (const row of sorted) {
    if (seen.has(row.timeBinMinutes)) {
      throw new Error("Multiple spectra remain for one or more 5-minute bins after auto-selecting the measurement slice.");
    }
    seen.add(row.timeBinMinutes);
  }
  return sorted;
}

function interpolateSpectrum(points: SpectrumPoint[], wavelengthsNm: number[]): Float64Array {
  const source = points.slice().sort((a, b) => a.nm - b.nm);
  const output = new Float64Array(wavelengthsNm.length);
  let sourceIndex = 0;

  for (let index = 0; index < wavelengthsNm.length; index++) {
    const targetNm = wavelengthsNm[index];
    while (sourceIndex + 1 < source.length && source[sourceIndex + 1].nm < targetNm) sourceIndex += 1;

    if (source.length === 0 || targetNm < source[0].nm || targetNm > source[source.length - 1].nm) {
      output[index] = 0;
      continue;
    }

    const left = source[sourceIndex];
    const right = source[Math.min(sourceIndex + 1, source.length - 1)];
    if (left.nm === right.nm) {
      output[index] = toUmol(left.ee, targetNm);
      continue;
    }

    const blend = (targetNm - left.nm) / (right.nm - left.nm);
    output[index] = toUmol(left.ee * (1 - blend) + right.ee * blend, targetNm);
  }

  return output;
}

function filterWavelengthWindow(wavelengthsNm: number[], minNm: number, maxNm: number) {
  const indices: number[] = [];
  const filtered: number[] = [];
  wavelengthsNm.forEach((nm, index) => {
    if (nm >= minNm && nm <= maxNm) {
      indices.push(index);
      filtered.push(nm);
    }
  });
  if (filtered.length === 0) {
    throw new Error(`No wavelength columns remain inside ${minNm}-${maxNm} nm.`);
  }
  return { indices, wavelengthsNm: filtered };
}

function projectRowsToWavelengthWindow(rows: ParsedCityRow[], indices: number[]): ParsedCityRow[] {
  return rows.map((row) => ({
    ...row,
    spectrum: indices.map((index) => row.spectrum[index] ?? 0),
  }));
}

function expandTargetBins(rows: ParsedCityRow[]): TargetBin[] {
  const sparse = rows.map((row) => ({
    timeBinMinutes: row.timeBinMinutes,
    timeOfDay: row.timeOfDay,
    samplesAveraged: row.samplesAveraged,
    wasFilled: false,
    targetSpectrum: row.spectrum,
  }));

  if (sparse.length === 0) return [];

  const expanded: TargetBin[] = [];
  let cursor = 0;
  for (let minute = 0; minute < 24 * 60; minute += 5) {
    while (cursor + 1 < sparse.length && sparse[cursor + 1].timeBinMinutes <= minute) cursor += 1;

    const first = sparse[0];
    const last = sparse[sparse.length - 1];
    if (minute < first.timeBinMinutes || minute > last.timeBinMinutes) {
      expanded.push({
        timeBinMinutes: minute,
        timeOfDay: formatTimeOfDay(minute),
        samplesAveraged: null,
        wasFilled: true,
        targetSpectrum: new Array(first.targetSpectrum.length).fill(0),
      });
      continue;
    }

    const current = sparse[cursor];
    if (current.timeBinMinutes === minute) {
      expanded.push({ ...current });
      continue;
    }

    const next = sparse[Math.min(cursor + 1, sparse.length - 1)];
    const blend = (minute - current.timeBinMinutes) / (next.timeBinMinutes - current.timeBinMinutes);
    expanded.push({
      timeBinMinutes: minute,
      timeOfDay: formatTimeOfDay(minute),
      samplesAveraged: null,
      wasFilled: true,
      targetSpectrum: current.targetSpectrum.map((value, index) => value * (1 - blend) + next.targetSpectrum[index] * blend),
    });
  }

  const firstActiveIndex = expanded.findIndex((bin) => hasSpectrumSignal(bin.targetSpectrum));
  let lastActiveIndex = -1;
  for (let index = expanded.length - 1; index >= 0; index--) {
    if (hasSpectrumSignal(expanded[index].targetSpectrum)) {
      lastActiveIndex = index;
      break;
    }
  }

  if (firstActiveIndex >= 0 && lastActiveIndex >= firstActiveIndex) {
    const firstAnchor = expanded[firstActiveIndex].targetSpectrum;
    const lastAnchor = expanded[lastActiveIndex].targetSpectrum;

    for (let step = 1; step <= EDGE_RAMP_STEPS; step++) {
      const beforeIndex = firstActiveIndex - step;
      if (beforeIndex >= 0) {
        const fraction = Math.max(0, (EDGE_RAMP_STEPS - step) / EDGE_RAMP_STEPS);
        expanded[beforeIndex] = {
          ...expanded[beforeIndex],
          wasFilled: true,
          targetSpectrum: scaleSpectrum(firstAnchor, fraction),
        };
      }

      const afterIndex = lastActiveIndex + step;
      if (afterIndex < expanded.length) {
        const fraction = Math.max(0, (EDGE_RAMP_STEPS - step) / EDGE_RAMP_STEPS);
        expanded[afterIndex] = {
          ...expanded[afterIndex],
          wasFilled: true,
          targetSpectrum: scaleSpectrum(lastAnchor, fraction),
        };
      }
    }
  }

  return expanded;
}

function rowsToTargetBins(rows: ParsedCityRow[]): TargetBin[] {
  return rows.map((row) => ({
    timeBinMinutes: row.timeBinMinutes,
    timeOfDay: row.timeOfDay,
    samplesAveraged: row.samplesAveraged,
    wasFilled: false,
    targetSpectrum: [...row.spectrum],
  }));
}

function cloneCalibrationBin(bin: CalibrationBin): CalibrationBin {
  return {
    ...bin,
    targetSpectrum: [...bin.targetSpectrum],
    reconstructedSpectrum: [...bin.reconstructedSpectrum],
    lampPercentages: { ...bin.lampPercentages },
    fit: { ...bin.fit },
  };
}

function zeroCalibrationBin(minute: number, template: CalibrationBin): CalibrationBin {
  return {
    timeBinMinutes: minute,
    timeOfDay: formatTimeOfDay(minute),
    samplesAveraged: null,
    wasFilled: true,
    targetSpectrum: new Array(template.targetSpectrum.length).fill(0),
    reconstructedSpectrum: new Array(template.reconstructedSpectrum.length).fill(0),
    lampPercentages: Object.fromEntries(Object.keys(template.lampPercentages).map((key) => [key, 0])),
    fit: {
      rmse: null,
      mae: null,
      success: true,
      nfev: null,
      targetIntegral: 0,
      reconstructedIntegral: 0,
    },
  };
}

function expandPsiCalibrationBins(sparseBins: CalibrationBin[]): CalibrationBin[] {
  if (sparseBins.length === 0) return [];

  const sorted = [...sparseBins].sort((a, b) => a.timeBinMinutes - b.timeBinMinutes);
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  const expanded: CalibrationBin[] = [];
  let cursor = 0;

  for (let minute = 0; minute < 24 * 60; minute += 5) {
    if (minute < first.timeBinMinutes || minute > last.timeBinMinutes) {
      expanded.push(zeroCalibrationBin(minute, first));
      continue;
    }

    while (cursor + 1 < sorted.length && sorted[cursor + 1].timeBinMinutes <= minute) cursor += 1;
    const base = cloneCalibrationBin(sorted[cursor]);
    base.timeBinMinutes = minute;
    base.timeOfDay = formatTimeOfDay(minute);
    base.samplesAveraged = null;
    base.wasFilled = minute !== sorted[cursor].timeBinMinutes;
    expanded.push(base);
  }

  return expanded;
}

function integrateArray(values: number[], wavelengthsNm: number[]): number {
  if (values.length < 2) return values[0] ?? 0;
  let sum = 0;
  for (let index = 1; index < values.length; index++) {
    const dx = wavelengthsNm[index] - wavelengthsNm[index - 1];
    sum += 0.5 * (values[index] + values[index - 1]) * dx;
  }
  return sum;
}

function buildCalibrationLookup(calibrationText: string, room: RoomConfig, wavelengthsNm: number[]) {
  const rawCalibration = parseLampCalibrationCsv(calibrationText, room);
  const lookup: Record<string, Float64Array[]> = {};

  for (const channel of room.channels) {
    lookup[channel.key] = [];
    for (let pct = 0; pct <= 100; pct++) {
      const spectrum = spectrumAtPercent(rawCalibration[channel.key], pct);
      lookup[channel.key][pct] = interpolateSpectrum(spectrum, wavelengthsNm);
    }
  }

  return lookup;
}

function fitExpandedBins(
  targets: TargetBin[],
  wavelengthsNm: number[],
  room: RoomConfig,
  lookup: Record<string, Float64Array[]>,
): CalibrationBin[] {
  const channelKeys = room.channels.map((channel) => channel.key);
  let previousPercentages = Object.fromEntries(channelKeys.map((key) => [key, 0])) as Record<string, number>;

  return targets.map((target) => {
    const targetSpectrum = Float64Array.from(target.targetSpectrum);
    if (!hasSpectrumSignal(target.targetSpectrum)) {
      previousPercentages = Object.fromEntries(channelKeys.map((key) => [key, 0])) as Record<string, number>;
      return {
        ...target,
        reconstructedSpectrum: new Array(target.targetSpectrum.length).fill(0),
        lampPercentages: { ...previousPercentages },
        fit: {
          rmse: 0,
          mae: 0,
          success: true,
          nfev: 0,
          targetIntegral: 0,
          reconstructedIntegral: 0,
        },
      };
    }

    const percentages = { ...previousPercentages };
    const currentSpectra = channelKeys.map((key) => lookup[key][percentages[key]]);
    const total = new Float64Array(targetSpectrum.length);
    for (const spectrum of currentSpectra) {
      for (let index = 0; index < total.length; index++) total[index] += spectrum[index];
    }

    let evaluations = 0;
    for (let sweep = 0; sweep < 3; sweep++) {
      let changed = false;
      for (let channelIndex = 0; channelIndex < channelKeys.length; channelIndex++) {
        const key = channelKeys[channelIndex];
        const currentSpectrum = currentSpectra[channelIndex];
        let bestPct = percentages[key];
        let bestSpectrum = currentSpectrum;
        let bestError = Number.POSITIVE_INFINITY;

        for (let pct = 0; pct <= 100; pct++) {
          const candidate = lookup[key][pct];
          let error = 0;
          for (let index = 0; index < total.length; index++) {
            const diff = total[index] - currentSpectrum[index] + candidate[index] - targetSpectrum[index];
            error += diff * diff;
          }
          evaluations += 1;
          if (error < bestError) {
            bestError = error;
            bestPct = pct;
            bestSpectrum = candidate;
          }
        }

        if (bestPct !== percentages[key]) {
          percentages[key] = bestPct;
          currentSpectra[channelIndex] = bestSpectrum;
          for (let index = 0; index < total.length; index++) {
            total[index] = total[index] - currentSpectrum[index] + bestSpectrum[index];
          }
          changed = true;
        }
      }
      if (!changed) break;
    }

    const reconstructedSpectrum = Array.from(total);
    const residual = reconstructedSpectrum.map((value, index) => value - target.targetSpectrum[index]);
    const mse = residual.reduce((sum, value) => sum + value * value, 0) / Math.max(residual.length, 1);
    const mae = residual.reduce((sum, value) => sum + Math.abs(value), 0) / Math.max(residual.length, 1);
    previousPercentages = { ...percentages };

    return {
      ...target,
      reconstructedSpectrum,
      lampPercentages: { ...percentages },
      fit: {
        rmse: Math.sqrt(mse),
        mae,
        success: true,
        nfev: evaluations,
        targetIntegral: integrateArray(target.targetSpectrum, wavelengthsNm),
        reconstructedIntegral: integrateArray(reconstructedSpectrum, wavelengthsNm),
      },
    };
  });
}

function binsToCsv(result: CalibrationResult, bins: CalibrationBin[]): string {
  const headers = [
    "city",
    "month",
    "month_name",
    "room",
    "measurement_table",
    "measurement_setup",
    "sun_included",
    "patch",
    "patch_almucantar",
    "patch_azimuth",
    "time_bin_minutes",
    "time_of_day",
    "samples_averaged",
    "was_filled",
    "fit_rmse",
    "fit_mae",
    "fit_success",
    "fit_nfev",
    "target_integral",
    "reconstructed_integral",
    ...result.room.channels.map((channel) => `${channel.key}_pct`),
  ];

  const rows = bins.map((bin) => [
    result.selection.city,
    result.selection.month,
    result.selection.monthName,
    result.room.id,
    result.selection.measurement_table,
    result.selection.measurement_setup,
    result.selection.sun_included,
    result.selection.patch,
    result.selection.patch_almucantar,
    result.selection.patch_azimuth,
    bin.timeBinMinutes,
    bin.timeOfDay,
    bin.samplesAveraged,
    bin.wasFilled,
    bin.fit.rmse,
    bin.fit.mae,
    bin.fit.success,
    bin.fit.nfev,
    bin.fit.targetIntegral,
    bin.fit.reconstructedIntegral,
    ...result.room.channels.map((channel) => bin.lampPercentages[channel.key] ?? 0),
  ]);

  return [headers, ...rows].map((row) => row.map(csvEscape).join(",")).join("\n");
}

function buildScheduleTicks(bins: CalibrationBin[], minuteStep: number): string[] {
  const exactTicks = bins
    .filter((bin) => bin.timeBinMinutes % minuteStep === 0)
    .map((bin) => bin.timeOfDay);

  if (exactTicks.length >= 2) {
    return Array.from(new Set(exactTicks));
  }

  const stride = Math.max(1, Math.floor(bins.length / 12));
  return bins
    .filter((_, index) => index === 0 || index === bins.length - 1 || index % stride === 0)
    .map((bin) => bin.timeOfDay);
}

function findPlaybackStartIndex(bins: CalibrationBin[], coverageMode: CoverageMode): number {
  if (bins.length === 0 || coverageMode === "sparse") return 0;
  const firstSignalIndex = bins.findIndex((bin) => hasSpectrumSignal(bin.targetSpectrum));
  if (firstSignalIndex < 0) return 0;
  return Math.max(0, firstSignalIndex - 1);
}

function getPartGroupName(part: any): string {
  return String(part?.["group-name"] ?? part?.name ?? "").trim();
}

function findPartIndex(parts: any[], names: string[]): number {
  const expected = new Set(names.map((name) => name.trim()).filter(Boolean));
  return parts.findIndex((part) => expected.has(getPartGroupName(part)));
}

function buildConstantPhase(value: number) {
  return { type: "const", value, duration: "24:00:00" } as const;
}

function uvGroupNameForRoom(roomId?: string | null): "UVA" | "UVB" {
  return roomId === "G7" ? "UVA" : "UVB";
}

function buildTemperatureFollowPoints(
  bins: CalibrationBin[],
  room: RoomConfig,
  minTempC: number,
  maxTempC: number,
  avgTempC: number,
): Array<[string, number]> {
  if (bins.length === 0 || room.channels.length === 0) {
    return [["24:00:00", Math.round(avgTempC * 10)]];
  }

  const sortedBins = [...bins].sort((a, b) => a.timeBinMinutes - b.timeBinMinutes);
  const normalizedLight = sortedBins.map((bin) => {
    const meanPercent =
      room.channels.reduce((sum, channel) => sum + (bin.lampPercentages[channel.key] ?? 0), 0) / room.channels.length;
    return meanPercent / 100;
  });

  const meanLight = normalizedLight.reduce((sum, value) => sum + value, 0) / normalizedLight.length;
  const maxRise = normalizedLight.reduce((max, value) => Math.max(max, value - meanLight), 0);
  const maxDrop = normalizedLight.reduce((max, value) => Math.max(max, meanLight - value), 0);
  const riseScale = maxRise > 0 ? (maxTempC - avgTempC) / maxRise : Number.POSITIVE_INFINITY;
  const dropScale = maxDrop > 0 ? (avgTempC - minTempC) / maxDrop : Number.POSITIVE_INFINITY;
  const scale = Math.max(0, Math.min(riseScale, dropScale));

  return normalizedLight.map((value, index) => {
    const nextTemp = avgTempC + scale * (value - meanLight);
    const clamped = Math.max(minTempC, Math.min(maxTempC, nextTemp));
    return [minutesToDurationString(durationMinutesAtIndex(sortedBins, index)), Math.round(clamped * 10)] as [string, number];
  });
}

export default function CitiesTab() {
  const profile = useProto((s: any) => s.profile) as ProfileKey | undefined;
  const protocol = useProto((s: any) => s.protocol) as Protocol;
  const setProtocol = useProto((s: any) => s.setProtocol);
  const setProfile = useProto((s: any) => s.setProfile);

  const [dataSource, setDataSource] = useState<DataSourceKind>("cities");
  const [cityFile, setCityFile] = useState<File | null>(null);
  const [cityData, setCityData] = useState<ParsedCityFile | null>(null);
  const [parsingCityFile, setParsingCityFile] = useState(false);
  const [selectedMonth, setSelectedMonth] = useState<number | null>(null);
  const [coverageMode, setCoverageMode] = useState<CoverageMode>("expanded");
  const [spectrumView, setSpectrumView] = useState<SpectrumView>("both");
  const [nmMinInput, setNmMinInput] = useState("400");
  const [nmMaxInput, setNmMaxInput] = useState("750");
  const [calibrationFile, setCalibrationFile] = useState<File | null>(null);
  const [timeIndex, setTimeIndex] = useState(0);
  const [result, setResult] = useState<CalibrationResult | null>(null);
  const [runningCalibration, setRunningCalibration] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [viewportWidth, setViewportWidth] = useState(() => (typeof window === "undefined" ? 1280 : window.innerWidth));
  const [error, setError] = useState("");
  const [co2Constant, setCo2Constant] = useState("420");
  const [humidityConstant, setHumidityConstant] = useState("63");
  const [temperatureMode, setTemperatureMode] = useState<TemperatureMode>("constant");
  const [temperatureConstant, setTemperatureConstant] = useState("13");
  const [temperatureNightMin, setTemperatureNightMin] = useState("5");
  const [temperatureDayMax, setTemperatureDayMax] = useState("20");
  const [temperatureAverage, setTemperatureAverage] = useState("13");

  const activeRoom = useMemo(() => {
    if (!calibrationFile) return null;
    return detectRoomFromFilename(calibrationFile.name);
  }, [calibrationFile]);
  const protocolParts = protocol?.sections?.[0]?.parts ?? [];
  const uvGroupName = useMemo(() => {
    const roomDriven = uvGroupNameForRoom(result?.room.id ?? activeRoom?.id ?? null);
    if (findPartIndex(protocolParts, [roomDriven]) >= 0) return roomDriven;
    if (findPartIndex(protocolParts, ["UVA"]) >= 0) return "UVA";
    if (findPartIndex(protocolParts, ["UVB"]) >= 0) return "UVB";
    return roomDriven;
  }, [activeRoom?.id, protocolParts, result?.room.id]);

  const loadedCityName = useMemo(() => {
    if (!cityData || cityData.cities.length !== 1) return "";
    return cityData.cities[0];
  }, [cityData]);

  const citySummary = useMemo(() => {
    if (!cityData) return "";
    if (cityData.sourceKind === "psi") return `Loaded source: PSI spectrometer`;
    if (cityData.cities.length === 1) return `Loaded city: ${cityData.cities[0]}`;
    return `Loaded cities: ${cityData.cities.join(", ")}`;
  }, [cityData]);

  useEffect(() => {
    setCityFile(null);
    setCityData(null);
    setSelectedMonth(null);
    setResult(null);
    setTimeIndex(0);
    setIsPlaying(false);
    setParsingCityFile(false);
    setError("");
  }, [dataSource]);

  useEffect(() => {
    if (!cityFile) {
      setCityData(null);
      setSelectedMonth(null);
      setResult(null);
      setTimeIndex(0);
      setIsPlaying(false);
      setParsingCityFile(false);
      setError("");
      return;
    }

    let cancelled = false;
    setParsingCityFile(true);
    setResult(null);
    setIsPlaying(false);
    setError("");

    cityFile
      .text()
      .then((text) => {
        if (cancelled) return;
        const parsed = dataSource === "cities" ? parseCityAverageDayCsv(text, cityFile.name) : parsePsiPhotonFluxCsv(text, cityFile.name);
        setCityData(parsed);
        setSelectedMonth(null);
        if (parsed.sourceKind === "cities" && parsed.cities.length > 1) {
          setError(`This city CSV contains multiple cities: ${parsed.cities.join(", ")}. Upload a per-city CSV.`);
        } else {
          setError("");
        }
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setCityData(null);
        setSelectedMonth(null);
        setResult(null);
        setIsPlaying(false);
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setParsingCityFile(false);
      });

    return () => {
      cancelled = true;
    };
  }, [cityFile, dataSource]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const onResize = () => setViewportWidth(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const monthOptions = useMemo<MonthOption[]>(() => {
    if (!cityData || !loadedCityName) return [];
    return Array.from(
      new Map(
        cityData.rows
          .filter((row) => row.locationName === loadedCityName)
          .map((row) => [row.month, { value: row.month, label: row.monthName || String(row.month) }]),
      ).values(),
    ).sort((a, b) => a.value - b.value);
  }, [cityData, loadedCityName]);

  useEffect(() => {
    if (monthOptions.length === 0) {
      setSelectedMonth(null);
      return;
    }
    setSelectedMonth((current) => (current != null && monthOptions.some((option) => option.value === current) ? current : monthOptions[0].value));
  }, [monthOptions]);

  const scopedRows = useMemo(() => {
    if (!cityData || !loadedCityName || selectedMonth == null) return [];
    return cityData.rows.filter((row) => row.locationName === loadedCityName && row.month === selectedMonth);
  }, [cityData, loadedCityName, selectedMonth]);

  useEffect(() => {
    setResult(null);
    setTimeIndex(0);
    setIsPlaying(false);
  }, [cityData?.fileName, selectedMonth, calibrationFile?.name, nmMinInput, nmMaxInput]);

  async function runCalibration() {
    if (!cityData) {
      setError(dataSource === "cities" ? "Upload a city average-day CSV first." : "Upload PhotonFluxDensity.csv first.");
      return;
    }
    if (cityData.sourceKind === "cities" && cityData.cities.length !== 1) {
      setError(`This city CSV contains multiple cities: ${cityData.cities.join(", ")}. Upload a per-city CSV.`);
      return;
    }
    if (selectedMonth == null) {
      setError("Choose a month first.");
      return;
    }
    if (!calibrationFile) {
      setError("Upload the lamp calibration CSV first.");
      return;
    }
    if (!activeRoom) {
      setError("Could not detect the room from the calibration filename. Include G4-G8 or the room number in the filename.");
      return;
    }

    const nmMin = Number(nmMinInput);
    const nmMax = Number(nmMaxInput);
    if (!Number.isFinite(nmMin) || !Number.isFinite(nmMax) || nmMin >= nmMax) {
      setError("Enter a valid nm range where the minimum is smaller than the maximum.");
      return;
    }

    setRunningCalibration(true);
    setError("");

    try {
      const selection = resolveRecommendedSelection(scopedRows);
      let filteredRows = scopedRows;
      for (const key of FILTER_KEYS) {
        filteredRows = applyFilter(filteredRows, key, selection[key]);
      }
      if (filteredRows.length === 0) {
        throw new Error("No city spectra remain after auto-selecting the measurement slice.");
      }

      const { indices, wavelengthsNm } = filterWavelengthWindow(cityData.wavelengthsNm, nmMin, nmMax);
      const uniqueRows = projectRowsToWavelengthWindow(ensureUniqueBins(filteredRows), indices);
      const calibrationText = await calibrationFile.text();
      const lookup = buildCalibrationLookup(calibrationText, activeRoom, wavelengthsNm);
      let expandedBins: CalibrationBin[];
      let sparseBins: CalibrationBin[];

      if (cityData.sourceKind === "psi") {
        sparseBins = fitExpandedBins(rowsToTargetBins(uniqueRows), wavelengthsNm, activeRoom, lookup);
        expandedBins = expandPsiCalibrationBins(sparseBins);
      } else {
        const expandedTargets = expandTargetBins(uniqueRows);
        expandedBins = fitExpandedBins(expandedTargets, wavelengthsNm, activeRoom, lookup);
        const sparseLookup = new Map(expandedBins.map((bin) => [bin.timeBinMinutes, bin]));
        sparseBins = uniqueRows.map((row) => {
          const bin = sparseLookup.get(row.timeBinMinutes);
          if (!bin) throw new Error(`Missing reconstructed result for ${row.timeOfDay}.`);
          return {
            ...bin,
            samplesAveraged: row.samplesAveraged,
            wasFilled: false,
            targetSpectrum: [...row.spectrum],
          };
        });
      }

      setResult({
        coverageMode,
        selection: {
          city: loadedCityName,
          month: selectedMonth,
          monthName: monthOptions.find((option) => option.value === selectedMonth)?.label ?? String(selectedMonth),
          measurement_table: selection.measurement_table,
          measurement_setup: selection.measurement_setup,
          sun_included: selection.sun_included,
          patch: selection.patch,
          patch_almucantar: selection.patch_almucantar,
          patch_azimuth: selection.patch_azimuth,
        },
        room: activeRoom,
        wavelengthsNm,
        sparseBins,
        expandedBins,
      });
      setTimeIndex(findPlaybackStartIndex(coverageMode === "expanded" ? expandedBins : sparseBins, coverageMode));
      setIsPlaying(true);
    } catch (err: unknown) {
      setResult(null);
      setTimeIndex(0);
      setIsPlaying(false);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRunningCalibration(false);
    }
  }

  const visibleBins = useMemo(() => {
    if (!result) return [];
    return coverageMode === "expanded" ? result.expandedBins : result.sparseBins;
  }, [coverageMode, result]);

  useEffect(() => {
    if (visibleBins.length === 0) {
      setTimeIndex(0);
      setIsPlaying(false);
      return;
    }
    setTimeIndex((current) => Math.max(0, Math.min(current, visibleBins.length - 1)));
  }, [visibleBins.length]);

  useEffect(() => {
    if (!isPlaying || visibleBins.length === 0 || timeIndex >= visibleBins.length - 1) return;
    const timer = window.setTimeout(() => {
      setTimeIndex((current) => Math.min(current + 1, visibleBins.length - 1));
    }, PLAYBACK_STEP_MS);
    return () => window.clearTimeout(timer);
  }, [isPlaying, timeIndex, visibleBins.length]);

  useEffect(() => {
    if (isPlaying && visibleBins.length > 0 && timeIndex >= visibleBins.length - 1) {
      setIsPlaying(false);
    }
  }, [isPlaying, timeIndex, visibleBins.length]);

  const currentBin = visibleBins[timeIndex] ?? null;

  const spectrumData = useMemo(() => {
    if (!result || !currentBin) return [];
    return result.wavelengthsNm.map((nm, index) => ({
      nm,
      target: spectrumView === "reconstructed" ? undefined : Number((currentBin.targetSpectrum[index] ?? 0).toFixed(6)),
      reconstructed: spectrumView === "target" ? undefined : Number((currentBin.reconstructedSpectrum[index] ?? 0).toFixed(6)),
    }));
  }, [currentBin, result, spectrumView]);

  const scheduleData = useMemo(() => {
    if (!result) return [];
    const bins = coverageMode === "expanded" ? result.expandedBins : result.sparseBins;
    return bins.map((bin) => {
      const row: Record<string, number | string> = {
        time: bin.timeOfDay,
        minute: bin.timeBinMinutes,
      };
      for (const channel of result.room.channels) {
        row[channel.key] = Number((bin.lampPercentages[channel.key] ?? 0).toFixed(2));
      }
      return row;
    });
  }, [coverageMode, result]);

  const scheduleTicks = useMemo(() => {
    if (!result) return [];
    const bins = coverageMode === "expanded" ? result.expandedBins : result.sparseBins;
    return buildScheduleTicks(bins, viewportWidth >= 1024 ? 60 : 120);
  }, [coverageMode, result, viewportWidth]);

  const spectrumYAxisMax = useMemo(() => {
    if (!result) return 1;

    let maxValue = 0;
    for (const bin of [...result.sparseBins, ...result.expandedBins]) {
      for (const value of bin.targetSpectrum) {
        if (Number.isFinite(value)) maxValue = Math.max(maxValue, value);
      }
      for (const value of bin.reconstructedSpectrum) {
        if (Number.isFinite(value)) maxValue = Math.max(maxValue, value);
      }
    }

    return Math.max(0.01, Number((maxValue * 1.05).toFixed(6)));
  }, [result]);

  const selectionSummary = useMemo(() => {
    if (!result) return "";
    return FILTER_KEYS
      .map((key) => {
        const value = result.selection[key];
        return value ? `${labelForFilter(key)}: ${value}` : "";
      })
      .filter(Boolean)
      .join(" | ");
  }, [result]);

  const primaryFileLabel = dataSource === "cities" ? "City average-day CSV" : "PhotonFluxDensity.csv";
  const primaryFileEmptyLabel = dataSource === "cities" ? "No city CSV selected." : "No PhotonFluxDensity.csv selected.";
  const primaryFilePrompt = dataSource === "cities" ? "Upload one city CSV first" : "Upload PhotonFluxDensity.csv first";
  const monthFieldLabel = dataSource === "cities" ? "Month" : "Measurement date";
  const psiSummary = cityData?.sourceKind === "psi" ? cityData.meta : null;

  function togglePlayback() {
    if (visibleBins.length === 0) return;
    if (isPlaying) {
      setIsPlaying(false);
      return;
    }
    if (timeIndex >= visibleBins.length - 1) {
      setTimeIndex(findPlaybackStartIndex(visibleBins, coverageMode));
    }
    setIsPlaying(true);
  }

  function exportBins(kind: CoverageMode) {
    if (!result) return;
    const bins = kind === "expanded" ? result.expandedBins : result.sparseBins;
    const suffix = kind === "expanded" ? "expanded-24h" : "sparse";
    downloadText(
      `${result.selection.city}_${result.selection.monthName}_${result.room.id}_${suffix}.csv`,
      binsToCsv(result, bins),
    );
  }

  function applyToFaketron() {
    if (!result) return;

    const co2Value = Number(co2Constant);
    const humidityValue = Number(humidityConstant);
    const constantTempC = Number(temperatureConstant);
    const nightMinC = Number(temperatureNightMin);
    const dayMaxC = Number(temperatureDayMax);
    const avgTempC = Number(temperatureAverage);
    const uvValue = 0;

    const minAllowedTemp = result.room.id === "G7" ? -4 : 4;
    if (!Number.isFinite(co2Value) || co2Value < 0 || co2Value > 1000) {
      setError("CO2 must be a number between 0 and 1000 ppm.");
      return;
    }
    if (!Number.isFinite(humidityValue) || humidityValue < 35 || humidityValue > 90) {
      setError("Humidity must be a number between 35 and 90%.");
      return;
    }
    if (temperatureMode === "constant") {
      if (!Number.isFinite(constantTempC) || constantTempC < minAllowedTemp || constantTempC > 42) {
        setError(`Constant temperature must be between ${minAllowedTemp} and 42 °C for ${result.room.id}.`);
        return;
      }
    } else {
      if (
        !Number.isFinite(nightMinC) ||
        !Number.isFinite(dayMaxC) ||
        !Number.isFinite(avgTempC) ||
        nightMinC < minAllowedTemp ||
        dayMaxC > 42 ||
        nightMinC > dayMaxC ||
        avgTempC < nightMinC ||
        avgTempC > dayMaxC
      ) {
        setError(
          `Follow-light temperature needs valid bounds for ${result.room.id}: min ${minAllowedTemp}-42 °C, max ${minAllowedTemp}-42 °C, and average between them.`,
        );
        return;
      }
    }

    const targetProfile = result.room.id as ProfileKey;
    const targetProtocol =
      protocol?.sections?.[0]?.parts?.length &&
      result.room.channels.every((channel) =>
        (protocol.sections?.[0]?.parts ?? []).some(
          (part: any) => ((part?.["group-name"] || part?.name) ?? "") === channel.protocolGroupName,
        ),
      )
        ? protocol
        : newProtocol(targetProfile);

    const next = typeof structuredClone === "function"
      ? structuredClone(targetProtocol)
      : JSON.parse(JSON.stringify(targetProtocol));
    const parts = next?.sections?.[0]?.parts ?? [];
    const missing = result.room.channels.filter((channel) =>
      parts.findIndex((part: any) => ((part?.["group-name"] || part?.name) ?? "") === channel.protocolGroupName) < 0,
    );

    if (missing.length > 0) {
      const message =
        `Could not prepare the ${result.room.id} protocol automatically. Missing light groups: ` +
        missing.map((channel) => channel.protocolGroupName).join(", ") +
        ".";
      setError(message);
      window.alert(message);
      return;
    }

    const targetUvGroupName = uvGroupNameForRoom(result.room.id);
    const requiredControls = ["CO2", "Humidity", "Temperature", targetUvGroupName];
    const missingControls = requiredControls.filter((name) => findPartIndex(parts, [name]) < 0);
    if (missingControls.length > 0) {
      const message =
        `Current protocol is missing required control groups: ${missingControls.join(", ")}. ` +
        "Load or create a matching room protocol first.";
      setError(message);
      window.alert(message);
      return;
    }

    for (const channel of result.room.channels) {
      const groupIndex = findPartIndex(parts, [channel.protocolGroupName]);
      const points =
        cityData?.sourceKind === "psi"
          ? binsToDurationPoints(result.expandedBins, channel.key)
          : result.expandedBins.map((bin) => durationPoint(bin.lampPercentages[channel.key] ?? 0));
      parts[groupIndex] = {
        ...parts[groupIndex],
        "group-name": parts[groupIndex]?.["group-name"] ?? parts[groupIndex]?.name ?? channel.protocolGroupName,
        phases: [{ type: "csv-import", points }],
      };
    }

    const co2Index = findPartIndex(parts, ["CO2"]);
    parts[co2Index] = {
      ...parts[co2Index],
      "group-name": parts[co2Index]?.["group-name"] ?? parts[co2Index]?.name ?? "CO2",
      phases: [buildConstantPhase(Math.round(co2Value))],
    };

    const humidityIndex = findPartIndex(parts, ["Humidity"]);
    parts[humidityIndex] = {
      ...parts[humidityIndex],
      "group-name": parts[humidityIndex]?.["group-name"] ?? parts[humidityIndex]?.name ?? "Humidity",
      phases: [buildConstantPhase(Math.round(humidityValue))],
    };

    const temperatureIndex = findPartIndex(parts, ["Temperature"]);
    parts[temperatureIndex] = {
      ...parts[temperatureIndex],
      "group-name": parts[temperatureIndex]?.["group-name"] ?? parts[temperatureIndex]?.name ?? "Temperature",
      phases:
        temperatureMode === "constant"
          ? [buildConstantPhase(Math.round(constantTempC * 10))]
          : [{ type: "csv-import", points: buildTemperatureFollowPoints(result.expandedBins, result.room, nightMinC, dayMaxC, avgTempC) }],
    };

    const uvIndex = findPartIndex(parts, [targetUvGroupName]);
    parts[uvIndex] = {
      ...parts[uvIndex],
      "group-name": parts[uvIndex]?.["group-name"] ?? parts[uvIndex]?.name ?? targetUvGroupName,
      phases: [buildConstantPhase(Math.round(uvValue))],
    };

    next.sections[0].parts = parts.map((part: any) =>
      part && part["group-name"] == null && part.name ? { ...part, "group-name": part.name } : part,
    );

    const previousProfile = profile as string | undefined;
    setProfile(targetProfile);
    setProtocol(next);
    window.dispatchEvent(new CustomEvent("protocol:save-draft", { detail: { protocol: next } }));
    setError("");
    window.alert(
      previousProfile && previousProfile !== targetProfile
        ? `Applied to Faketron for ${result.room.id}. The Editor room was first switched from ${previousProfile} to ${targetProfile}, and only after that the fitted 24h protocol and control settings were written into the protocol.`
        : `Applied to Faketron for ${result.room.id}. The Editor room already matched ${targetProfile}, so the fitted 24h protocol and control settings were written directly into that room protocol.`,
    );
  }

  return (
    <div className="cities-calibration-tab space-y-5">
      <style>{`
        .cities-calibration-tab,
        .cities-calibration-tab :is(h1, h2, h3, h4, h5, h6, th, label, button, strong, b) {
          font-weight: 400;
        }
      `}</style>
      <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-slate-700">
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.55fr)_minmax(340px,0.95fr)]">
          <div className="space-y-2">
            <h3 className="text-lg text-emerald-900">Cities Calibration</h3>
            <p>
              (This is still under construction) Choose either Cities or PSI spectrometer,
              then upload that source file together with one room calibration CSV to fit a Faketron day profile.
            </p>
            {dataSource === "cities" ? (
              <p>
                The city CSV contains one average 24-hour day for one city, split into 5-minute bins, for the month you
                select here. When available, the tool automatically uses the
                <code className="mx-1">spectral_horizontal_irradiance</code>
                slice from that file.
              </p>
            ) : (
              <p>
                PSI mode expects a <code className="mx-1">PhotonFluxDensity.csv</code> export. Timestamps and intervals may
                vary. If the file contains duplicate timestamps, only the first one is kept.
              </p>
            )}
            <p>
              For each time bin, the spectrum from the {dataSource === "cities" ? "city dataset" : "PSI file"} is the{" "}
              target spectrum. The room calibration CSV contains measured spectra for each lamp channel at
              known dimming percentages, and the tool interpolates those measurements to estimate each channel from 0-100%.
            </p>
            <p>
              The fitter then chooses lamp percentages whose summed lamp output is as close as possible to that target
              within the selected nm range. That summed indoor lamp output is the reconstructed spectrum,
              and the remaining mismatch is shown as RMSE.
            </p>
            <p>
              All cities: Madrid: Nofuentes, G. (n.d.). Dataset for "Overirradiance conditions and their
              impact on the spectral distribution at low- and mid-latitude sites", <em>Solar Energy</em>, Volume 259,
              2023, Pages 99-106, https://doi.org/10.1016/j.solener.2023.05.010.
              <a
                href="https://doi.org/10.5281/ZENODO.18169082"
                target="_blank"
                rel="noreferrer"
                className="ml-1 text-emerald-700 underline"
              >
                https://doi.org/10.5281/ZENODO.18169082
              </a>
            </p>
            <p>
              USA New Mexico: Global Horizontal Spectral irradiance dataset from Albuquerque - PV
              Performance Modeling Collaborative (PVPMC). (n.d.). Retrieved April 24, 2026, from
              <a
                href="https://pvpmc.sandia.gov/datasets/spectral-irradiance-dataset-from-albuquerque/"
                target="_blank"
                rel="noreferrer"
                className="ml-1 text-emerald-700 underline"
              >
                https://pvpmc.sandia.gov/datasets/spectral-irradiance-dataset-from-albuquerque/
              </a>
            </p>
            <p>
              All other cities data comes from: SKYSPECTRA: an opensource data package for worldwide
              spectral daylight is described there as an open-source data package of worldwide spectral daylight
              measurements collected from multiple long-term sites and specific experiments. For research use, cite:
              Balakrishnan, P., Diakite-Kortlever, A., Dumortier, D., Hernandez-Andres, J., Kenny, P., Maskarenj, M.,
              Pierson, C., Thorseth, A., Xue, P., &amp; Knoop, M. (2023). SKYSPECTRA: An Opensource Data Package of
              Worldwide Spectral Daylight, Proceedings of the 30th session of the CIE Conference, Ljubljana, Slovenia.
              DOI:10.25039/x50.2023.OP026.
            </p>
          </div>

          <div className="overflow-hidden rounded-2xl border border-emerald-200 bg-white shadow-sm shadow-emerald-100/60 self-start">
            <div className="border-b border-emerald-100 bg-gradient-to-br from-emerald-100 via-teal-50 to-white px-4 py-3">
              <div className="text-sm text-emerald-900">Available City Locations</div>
              <div className="mt-1 text-xs text-slate-600">
                Hardcoded overview of the city datasets currently referenced in this tab.
              </div>
            </div>
            <div className="max-h-[420px] overflow-auto">
              <table className="min-w-full border-separate border-spacing-0 text-xs text-slate-700">
                <thead className="sticky top-0 z-10">
                  <tr className="bg-slate-900 text-left text-[11px] uppercase tracking-[0.08em] text-white">
                    <th className="px-3 py-2">Code</th>
                    <th className="px-3 py-2">Location</th>
                    <th className="px-3 py-2">Country</th>
                    <th className="px-3 py-2">Timezone</th>
                    <th className="px-3 py-2">Lat</th>
                    <th className="px-3 py-2">Lon</th>
                    <th className="px-3 py-2">Alt</th>
                    <th className="px-3 py-2">Env</th>
                  </tr>
                </thead>
                <tbody>
                  {CITY_LOCATION_ROWS.map((row, index) => (
                    <tr
                      key={row.code}
                      className={index % 2 === 0 ? "bg-white" : "bg-emerald-50/55"}
                    >
                      <td className="border-b border-slate-100 px-3 py-2 align-top">
                        <span className="inline-flex rounded-full bg-emerald-100 px-2 py-0.5 text-emerald-900">
                          {row.code}
                        </span>
                      </td>
                      <td className="border-b border-slate-100 px-3 py-2 text-slate-900">{row.name}</td>
                      <td className="border-b border-slate-100 px-3 py-2">{row.country}</td>
                      <td className="border-b border-slate-100 px-3 py-2 font-mono text-[11px] text-slate-600">{row.timezone}</td>
                      <td className="border-b border-slate-100 px-3 py-2">{row.latitude}</td>
                      <td className="border-b border-slate-100 px-3 py-2">{row.longitude}</td>
                      <td className="border-b border-slate-100 px-3 py-2">{row.altitude} m</td>
                      <td className="border-b border-slate-100 px-3 py-2">
                        <span className="inline-flex rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-slate-700">
                          {row.environment}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 items-stretch">
        <div className="rounded-lg border border-slate-200 bg-white p-4 space-y-3 h-full">
          <h4 className=" text-slate-900">1. Data Selection</h4>

          <div>
            <label className="block text-sm text-slate-700 mb-1">Source</label>
            <select
              className="w-full rounded border border-slate-300 p-2 text-sm"
              value={dataSource}
              onChange={(event: React.ChangeEvent<HTMLSelectElement>) => setDataSource(event.target.value as DataSourceKind)}
            >
              <option value="cities">Cities</option>
              <option value="psi">PSI spectrometer</option>
            </select>
          </div>

          <div>
            <label className="block text-sm text-slate-700 mb-1">{primaryFileLabel}</label>
            <input
              type="file"
              accept=".csv,text/csv,text/plain"
              onChange={(event: React.ChangeEvent<HTMLInputElement>) => setCityFile(event.target.files?.[0] ?? null)}
              className="block w-full text-sm"
            />
            <div className="mt-2 text-xs text-slate-500">{cityFile ? cityFile.name : primaryFileEmptyLabel}</div>
            {dataSource === "cities" ? (
              <a
                href={CITY_CSV_DOWNLOAD_URL}
                target="_blank"
                rel="noreferrer"
                className="mt-2 inline-block text-xs text-emerald-700 underline"
              >
                Download the city CSV files
              </a>
            ) : (
              <div className="mt-2 text-xs text-slate-500">
                Upload the PSI-exported <code>PhotonFluxDensity.csv</code> file. Duplicate timestamps are removed by
                keeping the first measurement only.
              </div>
            )}
          </div>

          <div>
            <label className="block text-sm text-slate-700 mb-1">{monthFieldLabel}</label>
            <select
              className="w-full rounded border border-slate-300 p-2 text-sm"
              value={selectedMonth ?? ""}
              onChange={(event: React.ChangeEvent<HTMLSelectElement>) => setSelectedMonth(Number(event.target.value))}
              disabled={monthOptions.length === 0}
            >
              {monthOptions.length ? (
                monthOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))
              ) : (
                <option value="">{cityData?.cities.length === 1 ? `Choose a ${dataSource === "cities" ? "month" : "measurement day"}` : primaryFilePrompt}</option>
              )}
            </select>
          </div>

          <div>
            <label className="block text-sm text-slate-700 mb-1">Lamp calibration CSV</label>
            <input
              type="file"
              accept=".csv,text/csv,text/plain"
              onChange={(event: React.ChangeEvent<HTMLInputElement>) => setCalibrationFile(event.target.files?.[0] ?? null)}
              className="block w-full text-sm"
            />
            <div className="mt-2 text-xs text-slate-500">{calibrationFile ? calibrationFile.name : "No calibration CSV selected."}</div>
            {calibrationFile ? (
              <div className={`mt-1 text-xs ${activeRoom ? "text-slate-500" : "text-amber-700"}`}>
                {activeRoom
                  ? `Detected room from calibration filename: ${activeRoom.id}`
                  : "Could not detect a room from the calibration filename. Include G4-G8 or the room number in the filename."}
              </div>
            ) : null}
            <a
              href="https://drive.google.com/drive/folders/16m5sowew9blQqUsE5MWhW0qihLIMHwJz?usp=sharing"
              target="_blank"
              rel="noreferrer"
              className="mt-2 inline-block text-xs text-emerald-700 underline"
            >
              Download the calibration CSV files
            </a>
          </div>

          <button
            type="button"
            onClick={runCalibration}
            disabled={runningCalibration || parsingCityFile}
            className="w-full rounded bg-emerald-600 px-4 py-2 text-sm text-white hover:bg-emerald-500 disabled:cursor-not-allowed disabled:bg-slate-400"
          >
            {runningCalibration ? "Running calibration..." : "Run Calibration"}
          </button>

          {cityData ? (
            <div className="rounded border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
              <div>{citySummary}</div>
              <div className="mt-1">Detected file unit: {cityUnitLabel(cityData.sourceUnit)}</div>
              <div className="mt-1">Loaded {cityData.rows.length} rows and {cityData.wavelengthsNm.length} wavelengths.</div>
              {psiSummary?.measurementDateLabel ? (
                <div className="mt-1">Measurement date: {psiSummary.measurementDateLabel}</div>
              ) : null}
              {psiSummary?.keptMeasurementCount != null ? (
                <div className="mt-1">
                  Kept {psiSummary.keptMeasurementCount} unique timestamps and ignored {psiSummary.duplicateColumnsRemoved ?? 0} duplicate timestamp columns.
                </div>
              ) : null}
            </div>
          ) : null}
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-4 space-y-3 h-full">
          <h4 className=" text-slate-900">2. Fit and Display</h4>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div>
              <label className="block text-sm text-slate-700 mb-1">Coverage</label>
              <select
                className="w-full rounded border border-slate-300 p-2 text-sm"
                value={coverageMode}
                onChange={(event: React.ChangeEvent<HTMLSelectElement>) => setCoverageMode(event.target.value as CoverageMode)}
              >
                <option value="expanded">Expanded 24h</option>
                <option value="sparse">Sparse observed bins</option>
              </select>
              <div className="mt-1 text-xs text-slate-500">
                Sparse shows only the measured bins from the uploaded {dataSource === "cities" ? "city CSV" : "PSI file"}.
                Expanded 24h fills the full day and is used for preview, export, and apply.
              </div>
            </div>

            <div>
              <label className="block text-sm text-slate-700 mb-1">Spectrum View</label>
              <select
                className="w-full rounded border border-slate-300 p-2 text-sm"
                value={spectrumView}
                onChange={(event: React.ChangeEvent<HTMLSelectElement>) => setSpectrumView(event.target.value as SpectrumView)}
              >
                <option value="both">Both</option>
                <option value="target">Target spectrum</option>
                <option value="reconstructed">Reconstructed spectrum</option>
              </select>
              <div className="mt-1 text-xs text-slate-500">
                Target = uploaded daylight/PSI spectrum for this time bin. Reconstructed = summed room-lamp spectrum at
                the fitted percentages.
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div>
              <label className="block text-sm text-slate-700 mb-1">Nm min</label>
              <input
                type="number"
                className="w-full rounded border border-slate-300 p-2 text-sm"
                value={nmMinInput}
                onChange={(event: React.ChangeEvent<HTMLInputElement>) => setNmMinInput(event.target.value)}
              />
            </div>

            <div>
              <label className="block text-sm text-slate-700 mb-1">Nm max</label>
              <input
                type="number"
                className="w-full rounded border border-slate-300 p-2 text-sm"
                value={nmMaxInput}
                onChange={(event: React.ChangeEvent<HTMLInputElement>) => setNmMaxInput(event.target.value)}
              />
            </div>
          </div>

          <div className="text-xs text-slate-500">
            The selected nm window is the wavelength range used for fitting, plotting, and RMSE. Default: 400-750 nm.
          </div>

          {scopedRows.length > 0 && selectedMonth != null ? (
            <div className="text-xs text-slate-500">
              {scopedRows.length} rows are available for {loadedCityName} {monthOptions.find((option) => option.value === selectedMonth)?.label ?? ""}.
              {dataSource === "cities"
                ? " This is the selected month-long average day, and the measurement slice is auto-selected behind the scenes."
                : " These are the unique PSI measurement timestamps kept from the uploaded PhotonFluxDensity.csv file."}
            </div>
          ) : null}
        </div>
      </div>

      {error ? (
        <div className="rounded border border-red-300 bg-red-50 p-3 text-sm text-red-700">{error}</div>
      ) : null}

      {result ? (
        <>
          <div className="rounded-lg border border-slate-200 bg-white p-4 space-y-4">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <h4 className=" text-slate-900">3. Spectral Viewer</h4>
                <div className="text-xs text-slate-500">
                  {result.selection.city} | {result.selection.monthName} | {result.room.id}
                </div>
                {selectionSummary ? <div className="text-xs text-slate-500 mt-1">Auto-selected slice: {selectionSummary}</div> : null}
              </div>

              <div className="flex items-center gap-3 text-sm text-slate-600">
                <span>
                  Bin {timeIndex + 1} / {visibleBins.length} {currentBin ? `(${currentBin.timeOfDay})` : ""}
                </span>
                <button
                  type="button"
                  onClick={togglePlayback}
                  className="rounded border border-slate-300 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
                >
                  {isPlaying ? "Pause" : "Play"}
                </button>
              </div>
            </div>

            {currentBin ? (
              <div className="grid grid-cols-1 gap-4 xl:grid-cols-[116px_minmax(0,1fr)]">
                <div className="rounded border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700 space-y-1 self-start">
                  <div>Time: {currentBin.timeOfDay}</div>
                  <div>RMSE: {currentBin.fit.rmse?.toFixed(4) ?? "-"}</div>
                </div>

                <div className="min-w-0">
                  <div className="mb-1 text-xs text-slate-500">Unit: {SPECTRUM_UNIT_LABEL}</div>
                  <ResponsiveContainer width="100%" height={320}>
                    <LineChart data={spectrumData} margin={{ top: 8, right: 16, bottom: 20, left: 12 }}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis
                        dataKey="nm"
                        type="number"
                        domain={["dataMin", "dataMax"]}
                        tickCount={10}
                        label={{ value: "Wavelength (nm)", position: "insideBottom", offset: -6 }}
                      />
                      <YAxis
                        domain={[0, spectrumYAxisMax]}
                        width={72}
                        tickFormatter={(value: number) => formatAxisFloat(Number(value))}
                        label={{ value: SPECTRUM_UNIT_LABEL, angle: -90, position: "insideLeft" }}
                      />
                      <Tooltip
                        labelFormatter={(value) => `${value} nm`}
                        formatter={(value: number | string | Array<number | string>, name: string) => {
                          const numericValue = Array.isArray(value) ? value[0] : value;
                          return [`${formatAxisFloat(Number(numericValue))} ${SPECTRUM_UNIT_LABEL}`, name];
                        }}
                      />
                      <Legend />
                      {spectrumView !== "reconstructed" ? (
                        <Line type="linear" dataKey="target" stroke="#0f766e" dot={false} strokeWidth={2} name="Target spectrum" />
                      ) : null}
                      {spectrumView !== "target" ? (
                        <Line type="linear" dataKey="reconstructed" stroke="#dc2626" dot={false} strokeWidth={2} name="Reconstructed spectrum" />
                      ) : null}
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>
            ) : null}

            {visibleBins.length > 0 ? (
              <div className="space-y-2">
                <input
                  type="range"
                  min={0}
                  max={Math.max(0, visibleBins.length - 1)}
                  value={timeIndex}
                  onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
                    setIsPlaying(false);
                    setTimeIndex(Number(event.target.value));
                  }}
                  className="w-full"
                />
                <div className="flex justify-between text-xs text-slate-500">
                  <span>{visibleBins[0]?.timeOfDay}</span>
                  <span>{visibleBins[visibleBins.length - 1]?.timeOfDay}</span>
                </div>
              </div>
            ) : null}
          </div>

          <div className="rounded-lg border border-slate-200 bg-white p-4 space-y-4">
            <h4 className=" text-slate-900">4. Lamp Schedule</h4>
            <ResponsiveContainer width="100%" height={320}>
              <BarChart data={scheduleData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis
                  dataKey="time"
                  ticks={scheduleTicks}
                  interval={0}
                  tick={{ fontSize: 11 }}
                  minTickGap={0}
                  label={{ value: "Time of day", position: "insideBottom", offset: -6 }}
                />
                <YAxis
                  domain={[0, 100]}
                  label={{ value: `Lamp output (${SCHEDULE_UNIT_LABEL})`, angle: -90, position: "insideLeft" }}
                />
                <Tooltip
                  formatter={(value: number | string | Array<number | string>, name: string) => {
                    const numericValue = Array.isArray(value) ? value[0] : value;
                    return [`${Number(numericValue).toFixed(2)} ${SCHEDULE_UNIT_LABEL}`, name];
                  }}
                />
                <Legend />
                {result.room.channels.map((channel) => (
                  <Bar
                    key={channel.key}
                    dataKey={channel.key}
                    name={channel.label}
                    fill={channel.color}
                    maxBarSize={10}
                  />
                ))}
              </BarChart>
            </ResponsiveContainer>
            <div className="text-xs text-slate-500">
              {coverageMode === "expanded"
                ? cityData?.sourceKind === "psi"
                  ? "PSI expanded mode uses 5-minute bins, keeps each fitted value constant until the next PSI timestamp, and sets values to 0 before the first and after the last measurement."
                  : "Expanded mode includes the 15-minute linear ramp-in and ramp-out at the day edges."
                : cityData?.sourceKind === "psi"
                  ? "Sparse mode shows only the original PSI measurement timestamps."
                  : "Sparse mode shows only the originally observed city measurement bins."}
            </div>
          </div>

          <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-slate-700">
            <h4 className=" text-emerald-900">5. How the spectrum fitter works</h4>
            <div className="mt-3 grid gap-3 lg:grid-cols-3">
              <div className="rounded border border-emerald-100 bg-white/75 p-3">
                <div className="text-emerald-900">Input spectrum</div>
                <p className="mt-2">
                  Each time bin has a target spectrum, written here as <code>T[nm]</code>. Only wavelengths inside the
                  selected nm window are used. City spectra in energy units are converted to photon units first; PSI
                  spectra are handled as photon-unit input.
                </p>
              </div>

              <div className="rounded border border-emerald-100 bg-white/75 p-3">
                <div className="text-emerald-900">Reconstruction</div>
                <p className="mt-2">
                  The reconstructed spectrum <code>R[nm]</code> is the sum of all selected room-lamp channel spectra at
                  their fitted percentages.
                </p>
              </div>

              <div className="rounded border border-emerald-100 bg-white/75 p-3 lg:col-span-2">
                <div className="text-emerald-900">How percentages are chosen</div>
                <p className="mt-2">
                  The search starts from the previous time bin's fitted percentages, or from 0% for every channel at
                  the first nonzero bin. It makes up to three passes through the channels. During one channel step,
                  all other channels stay fixed, that channel is tested at every whole-number percentage from 0 to 100,
                  and the percentage with the lowest squared mismatch is kept:
                  <code className="ml-1">sum_nm((R[nm] - T[nm])^2)</code>.
                </p>
              </div>

              <div className="rounded border border-emerald-100 bg-white/75 p-3 lg:col-span-3">
                <div className="text-emerald-900">RMSE</div>
                <p className="mt-2">
                  After the final percentages are selected, the residual at each wavelength is
                  <code className="mx-1">R[nm] - T[nm]</code>. RMSE is
                  <code className="mx-1">sqrt(mean_nm((R[nm] - T[nm])^2))</code>, so larger wavelength errors count more
                  strongly because they are squared. Lower RMSE means the reconstructed lamp spectrum is closer to the
                  target, within the limits of the available lamp channels and 0-100% integer percentage steps.
                </p>
              </div>
            </div>
          </div>

          <div className="rounded-lg border border-slate-200 bg-white p-4">
            <h4 className=" text-slate-900 mb-3">6. Faketron Actions</h4>
            <div className="mb-4 rounded border border-slate-200 bg-slate-50 p-4 space-y-4">
              <div className="text-sm text-slate-700">
                These settings are applied together with the fitted light schedule when you upload to the Faketron.
                CO2, Humidity, and {uvGroupName} are written as constant 24-hour phases. Temperature can be constant
                as well, or it can follow the average light-intensity trend.
              </div>

              <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                Important: if the Editor tab is currently on another room, for example G4, pressing
                 Apply to Faketron must first switch the Editor room to the detected calibration room
                 {result.room.id}. Only after that room change can the fitted schedule be applied to the
                correct protocol.
              </div>

              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
                <div>
                  <label className="block text-sm text-slate-700 mb-1">CO2 constant (ppm)</label>
                  <input
                    type="number"
                    className="w-full rounded border border-slate-300 p-2 text-sm"
                    value={co2Constant}
                    onChange={(event: React.ChangeEvent<HTMLInputElement>) => setCo2Constant(event.target.value)}
                  />
                </div>

                <div>
                  <label className="block text-sm text-slate-700 mb-1">Humidity constant (%)</label>
                  <input
                    type="number"
                    className="w-full rounded border border-slate-300 p-2 text-sm"
                    value={humidityConstant}
                    onChange={(event: React.ChangeEvent<HTMLInputElement>) => setHumidityConstant(event.target.value)}
                  />
                </div>

                <div>
                  <label className="block text-sm text-slate-700 mb-1">Temperature mode</label>
                  <select
                    className="w-full rounded border border-slate-300 p-2 text-sm"
                    value={temperatureMode}
                    onChange={(event: React.ChangeEvent<HTMLSelectElement>) => setTemperatureMode(event.target.value as TemperatureMode)}
                  >
                    <option value="constant">Constant 24h</option>
                    <option value="follow-light">Follow average light intensity</option>
                  </select>
                </div>
              </div>

              <div className="text-xs text-amber-700">
                {uvGroupName} is set to 0%, constant for 24 hours. Adapt this yourself afterwards if you want UV exposure.
              </div>

              {temperatureMode === "constant" ? (
                <div className="max-w-xs">
                  <label className="block text-sm text-slate-700 mb-1">Temperature constant (°C)</label>
                  <input
                    type="number"
                    className="w-full rounded border border-slate-300 p-2 text-sm"
                    value={temperatureConstant}
                    onChange={(event: React.ChangeEvent<HTMLInputElement>) => setTemperatureConstant(event.target.value)}
                  />
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="text-sm text-slate-700">
                    The follow-light option uses the average fitted lamp-intensity curve across the day and maps it to a
                    temperature profile that stays within your minimum and maximum while keeping your chosen daily average.
                  </div>
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                    <div>
                      <label className="block text-sm text-slate-700 mb-1">Night minimum (°C)</label>
                      <input
                        type="number"
                        className="w-full rounded border border-slate-300 p-2 text-sm"
                        value={temperatureNightMin}
                        onChange={(event: React.ChangeEvent<HTMLInputElement>) => setTemperatureNightMin(event.target.value)}
                      />
                    </div>

                    <div>
                      <label className="block text-sm text-slate-700 mb-1">Day maximum (°C)</label>
                      <input
                        type="number"
                        className="w-full rounded border border-slate-300 p-2 text-sm"
                        value={temperatureDayMax}
                        onChange={(event: React.ChangeEvent<HTMLInputElement>) => setTemperatureDayMax(event.target.value)}
                      />
                    </div>

                    <div>
                      <label className="block text-sm text-slate-700 mb-1">Daily average (°C)</label>
                      <input
                        type="number"
                        className="w-full rounded border border-slate-300 p-2 text-sm"
                        value={temperatureAverage}
                        onChange={(event: React.ChangeEvent<HTMLInputElement>) => setTemperatureAverage(event.target.value)}
                      />
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => exportBins("sparse")}
                className="rounded border border-slate-300 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50"
              >
                Export Sparse CSV
              </button>
              <button
                type="button"
                onClick={() => exportBins("expanded")}
                className="rounded border border-slate-300 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50"
              >
                Export Expanded 24h CSV
              </button>
              <button
                type="button"
                onClick={applyToFaketron}
                className="rounded bg-slate-900 px-4 py-2 text-sm text-white hover:bg-slate-700"
              >
                Apply to Faketron
              </button>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}


