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
import type { Protocol } from "../profiles";
import { ROOM_CONFIGS, detectRoomFromFilename, type RoomConfig } from "../utils/rooms";
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

type FilterKey = (typeof FILTER_KEYS)[number];
type CoverageMode = "sparse" | "expanded";
type SpectrumView = "target" | "reconstructed" | "both";
type CityUnit = "energy" | "photon";

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
  wavelengthsNm: number[];
  rows: ParsedCityRow[];
  cities: string[];
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

function parseCityAverageDayCsv(text: string, fileName: string, unit: CityUnit): ParsedCityFile {
  const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length < 2) throw new Error("City CSV is empty.");

  const header = splitCsvLine(lines[0], ",").map((cell) => cell.trim());
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
    wavelengthsNm: spectralColumns.map((entry) => entry.nm),
    rows,
    cities: Array.from(new Set(rows.map((row) => row.locationName))).sort((a, b) => a.localeCompare(b)),
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
  const tableCandidates = Array.from(new Set([...PREFERRED_MEASUREMENT_TABLES, ...availableTables])).filter(Boolean);
  if (tableCandidates.length === 0) {
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

export default function CitiesTab() {
  const protocol = useProto((s: any) => s.protocol) as Protocol;
  const setProtocol = useProto((s: any) => s.setProtocol);

  const rooms = useMemo(() => Object.values(ROOM_CONFIGS), []);

  const [cityFile, setCityFile] = useState<File | null>(null);
  const [cityUnit, setCityUnit] = useState<CityUnit>("energy");
  const [cityData, setCityData] = useState<ParsedCityFile | null>(null);
  const [parsingCityFile, setParsingCityFile] = useState(false);
  const [selectedMonth, setSelectedMonth] = useState<number | null>(null);
  const [selectedRoom, setSelectedRoom] = useState("G7");
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

  const activeRoom = ROOM_CONFIGS[selectedRoom] ?? rooms[0];

  const loadedCityName = useMemo(() => {
    if (!cityData || cityData.cities.length !== 1) return "";
    return cityData.cities[0];
  }, [cityData]);

  const citySummary = useMemo(() => {
    if (!cityData) return "";
    if (cityData.cities.length === 1) return `Loaded city: ${cityData.cities[0]}`;
    return `Loaded cities: ${cityData.cities.join(", ")}`;
  }, [cityData]);

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
        const parsed = parseCityAverageDayCsv(text, cityFile.name, cityUnit);
        setCityData(parsed);
        setSelectedMonth(null);
        if (parsed.cities.length > 1) {
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
  }, [cityFile, cityUnit]);

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
  }, [cityData?.fileName, selectedMonth, selectedRoom, calibrationFile?.name, nmMinInput, nmMaxInput]);

  async function runCalibration() {
    if (!cityData) {
      setError("Upload a city average-day CSV first.");
      return;
    }
    if (cityData.cities.length !== 1) {
      setError(`This city CSV contains multiple cities: ${cityData.cities.join(", ")}. Upload a per-city CSV.`);
      return;
    }
    if (selectedMonth == null) {
      setError("Choose a month first.");
      return;
    }
    if (!calibrationFile) {
      setError("Upload the lamp calibration CSV for the selected room.");
      return;
    }

    const nmMin = Number(nmMinInput);
    const nmMax = Number(nmMaxInput);
    if (!Number.isFinite(nmMin) || !Number.isFinite(nmMax) || nmMin >= nmMax) {
      setError("Enter a valid nm range where the minimum is smaller than the maximum.");
      return;
    }

    const detectedRoom = detectRoomFromFilename(calibrationFile.name);
    if (detectedRoom && detectedRoom.id !== activeRoom.id) {
      setError(`Calibration file looks like ${detectedRoom.id}, but room ${activeRoom.id} is selected.`);
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
      const expandedTargets = expandTargetBins(uniqueRows);
      const calibrationText = await calibrationFile.text();
      const lookup = buildCalibrationLookup(calibrationText, activeRoom, wavelengthsNm);
      const expandedBins = fitExpandedBins(expandedTargets, wavelengthsNm, activeRoom, lookup);
      const sparseLookup = new Map(expandedBins.map((bin) => [bin.timeBinMinutes, bin]));
      const sparseBins = uniqueRows.map((row) => {
        const bin = sparseLookup.get(row.timeBinMinutes);
        if (!bin) throw new Error(`Missing reconstructed result for ${row.timeOfDay}.`);
        return {
          ...bin,
          samplesAveraged: row.samplesAveraged,
          wasFilled: false,
          targetSpectrum: [...row.spectrum],
        };
      });

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

    const next = typeof structuredClone === "function"
      ? structuredClone(protocol)
      : JSON.parse(JSON.stringify(protocol));
    const parts = next?.sections?.[0]?.parts ?? [];
    const missing = result.room.channels.filter((channel) =>
      parts.findIndex((part: any) => ((part?.["group-name"] || part?.name) ?? "") === channel.protocolGroupName) < 0,
    );

    if (missing.length > 0) {
      const message =
        `Current protocol does not match ${result.room.id}. Missing light groups: ` +
        missing.map((channel) => channel.protocolGroupName).join(", ") +
        ". Load or create a matching room protocol first.";
      setError(message);
      window.alert(message);
      return;
    }

    for (const channel of result.room.channels) {
      const groupIndex = parts.findIndex((part: any) => ((part?.["group-name"] || part?.name) ?? "") === channel.protocolGroupName);
      const points = result.expandedBins.map((bin) => durationPoint(bin.lampPercentages[channel.key] ?? 0));
      parts[groupIndex] = {
        ...parts[groupIndex],
        "group-name": parts[groupIndex]?.["group-name"] ?? parts[groupIndex]?.name ?? channel.protocolGroupName,
        phases: [{ type: "csv-import", points }],
      };
    }

    next.sections[0].parts = parts.map((part: any) =>
      part && part["group-name"] == null && part.name ? { ...part, "group-name": part.name } : part,
    );

    setProtocol(next);
    window.dispatchEvent(new CustomEvent("protocol:save-draft", { detail: { protocol: next } }));
    setError("");
    window.alert(`Applied the expanded 24h schedule to ${result.room.id}.`);
  }

  return (
    <div className="space-y-5">
      <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-slate-700 space-y-2">
        <h3 className="text-lg font-semibold text-emerald-900">Cities Calibration</h3>
        <p>
          This tab runs entirely in the browser. Upload one city average-day CSV and the room calibration CSV, then fit a
          Faketron day profile with no backend or database.
        </p>
        <p>The measurement slice is auto-selected behind the scenes to keep the UI minimal.</p>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="rounded-lg border border-slate-200 bg-white p-4 space-y-3">
          <h4 className="font-semibold text-slate-900">1. Data Selection</h4>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">City average-day CSV</label>
            <input
              type="file"
              accept=".csv,text/csv,text/plain"
              onChange={(event: React.ChangeEvent<HTMLInputElement>) => setCityFile(event.target.files?.[0] ?? null)}
              className="block w-full text-sm"
            />
            <div className="mt-2 text-xs text-slate-500">{cityFile ? cityFile.name : "No city CSV selected."}</div>
            <a
              href={CITY_CSV_DOWNLOAD_URL}
              target="_blank"
              rel="noreferrer"
              className="mt-2 inline-block text-xs text-emerald-700 underline"
            >
              Download the city CSV files
            </a>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">City CSV unit</label>
            <select
              className="w-full rounded border border-slate-300 p-2 text-sm"
              value={cityUnit}
              onChange={(event: React.ChangeEvent<HTMLSelectElement>) => setCityUnit(event.target.value as CityUnit)}
            >
              <option value="energy">Energy: W/(m2*nm)</option>
              <option value="photon">Photon: umol/(s*m2*nm)</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Month</label>
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
                <option value="">{cityData?.cities.length === 1 ? "Choose a month" : "Upload one city CSV first"}</option>
              )}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Room</label>
            <select
              className="w-full rounded border border-slate-300 p-2 text-sm"
              value={selectedRoom}
              onChange={(event: React.ChangeEvent<HTMLSelectElement>) => setSelectedRoom(event.target.value)}
            >
              {rooms.map((room) => (
                <option key={room.id} value={room.id}>
                  {room.id}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Lamp calibration CSV</label>
            <input
              type="file"
              accept=".csv,text/csv,text/plain"
              onChange={(event: React.ChangeEvent<HTMLInputElement>) => setCalibrationFile(event.target.files?.[0] ?? null)}
              className="block w-full text-sm"
            />
            <div className="mt-2 text-xs text-slate-500">{calibrationFile ? calibrationFile.name : "No calibration CSV selected."}</div>
          </div>

          <button
            type="button"
            onClick={runCalibration}
            disabled={runningCalibration || parsingCityFile}
            className="w-full rounded bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:cursor-not-allowed disabled:bg-slate-400"
          >
            {runningCalibration ? "Running calibration..." : "Run Calibration"}
          </button>

          {cityData ? (
            <div className="rounded border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
              <div>{citySummary}</div>
              <div className="mt-1">Loaded {cityData.rows.length} rows and {cityData.wavelengthsNm.length} wavelengths.</div>
            </div>
          ) : null}
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-4 space-y-3 lg:col-span-2">
          <h4 className="font-semibold text-slate-900">2. Fit and Display</h4>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Coverage</label>
              <select
                className="w-full rounded border border-slate-300 p-2 text-sm"
                value={coverageMode}
                onChange={(event: React.ChangeEvent<HTMLSelectElement>) => setCoverageMode(event.target.value as CoverageMode)}
              >
                <option value="expanded">Expanded 24h</option>
                <option value="sparse">Sparse observed bins</option>
              </select>
              <div className="mt-1 text-xs text-slate-500">
                Sparse shows only the measured bins from the uploaded city CSV. Expanded 24h fills the full day and is used for preview, export, and apply.
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Spectrum View</label>
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
                Choose whether the spectral chart shows the city target, the reconstructed Faketron fit, or both together.
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Nm min</label>
              <input
                type="number"
                className="w-full rounded border border-slate-300 p-2 text-sm"
                value={nmMinInput}
                onChange={(event: React.ChangeEvent<HTMLInputElement>) => setNmMinInput(event.target.value)}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Nm max</label>
              <input
                type="number"
                className="w-full rounded border border-slate-300 p-2 text-sm"
                value={nmMaxInput}
                onChange={(event: React.ChangeEvent<HTMLInputElement>) => setNmMaxInput(event.target.value)}
              />
            </div>
          </div>

          <div className="text-xs text-slate-500">
            The selected nm window changes the calibration fit, the plotted spectra, and the fit metrics. Default: 400-750 nm.
          </div>

          {scopedRows.length > 0 && selectedMonth != null ? (
            <div className="text-xs text-slate-500">
              {scopedRows.length} rows are available for {loadedCityName} {monthOptions.find((option) => option.value === selectedMonth)?.label ?? ""}.
              The measurement slice is auto-selected behind the scenes.
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
                <h4 className="font-semibold text-slate-900">3. Spectral Viewer</h4>
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
              <div className="grid grid-cols-1 gap-4 xl:grid-cols-4">
                <div className="rounded border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700 space-y-1">
                  <div><strong>Time:</strong> {currentBin.timeOfDay}</div>
                  <div><strong>Filled bin:</strong> {currentBin.wasFilled ? "Yes" : "No"}</div>
                  <div><strong>Samples averaged:</strong> {currentBin.samplesAveraged ?? "-"}</div>
                  <div><strong>RMSE:</strong> {currentBin.fit.rmse?.toFixed(4) ?? "-"}</div>
                  <div><strong>MAE:</strong> {currentBin.fit.mae?.toFixed(4) ?? "-"}</div>
                  <div><strong>Target integral:</strong> {currentBin.fit.targetIntegral?.toFixed(2) ?? "-"}</div>
                  <div><strong>Reconstructed integral:</strong> {currentBin.fit.reconstructedIntegral?.toFixed(2) ?? "-"}</div>
                  <div><strong>Playback speed:</strong> {PLAYBACK_STEP_MS} ms per bin</div>
                </div>

                <div className="xl:col-span-3">
                  <ResponsiveContainer width="100%" height={320}>
                    <LineChart data={spectrumData}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="nm" type="number" domain={["dataMin", "dataMax"]} tickCount={10} />
                      <YAxis />
                      <Tooltip />
                      <Legend />
                      {spectrumView !== "reconstructed" ? (
                        <Line type="linear" dataKey="target" stroke="#0f766e" dot={false} strokeWidth={2} name="Target" />
                      ) : null}
                      {spectrumView !== "target" ? (
                        <Line type="linear" dataKey="reconstructed" stroke="#dc2626" dot={false} strokeWidth={2} name="Reconstructed" />
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
            <h4 className="font-semibold text-slate-900">4. Lamp Schedule</h4>
            <ResponsiveContainer width="100%" height={320}>
              <BarChart data={scheduleData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="time" ticks={scheduleTicks} interval={0} tick={{ fontSize: 11 }} minTickGap={0} />
                <YAxis domain={[0, 100]} />
                <Tooltip />
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
                ? "Expanded mode includes the 15-minute linear ramp-in and ramp-out at the day edges."
                : "Sparse mode shows only the originally observed city measurement bins."}
            </div>
          </div>

          <div className="rounded-lg border border-slate-200 bg-white p-4">
            <h4 className="font-semibold text-slate-900 mb-3">5. Actions</h4>
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
                className="rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700"
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
