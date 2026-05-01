import React, { useEffect, useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { sampleGroup } from "../utils/sampler";
import type { XY } from "../utils/sampler";
import {
  parseLampCalibrationCsv,
  reconstructSpectrum,
  integrateSpectrum,
  convertSpectrumToUmol,
} from "../utils/spectra";
import type { LampCalibrationData } from "../utils/spectra";
import { ROOM_CONFIGS } from "../utils/rooms";
import type { RoomConfig } from "../utils/rooms";
import { canonicalizeProtocol } from "../utils/canonicalize";
import { formatDurationPreserveDays } from "../utils/time";
import { decodeFYT } from "faketotron-v2-core";
import { LeafButton } from "../LeafButton";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type SensorPoint = { ts: number; value: number };
type ChartRow = { xMs: number; protocol: number | null; sensor: number | null };
type ProtocolGraphRow = { i: number; name: string; unit: string; series: XY[]; phaseStarts: number[]; xmax: number };

type ParamResult = {
  key: string;
  title: string;
  unit: string;
  protocolColor: string;
  sensorColor: string;
  hasProtocol: boolean;
  hasSensor: boolean;
  data: ChartRow[];
};

type CompareResults = {
  standard: ParamResult[];
  restSheets: string[];
  workbook: XLSX.WorkBook;
  protocol: any;
  protocolRows: ProtocolGraphRow[];
  startMs: number;
  endMs: number;
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STEP_MS = 5 * 60 * 1000; // 5-minute chart resolution
const DAY_MS = 24 * 60 * 60 * 1000;
const DAY_SECONDS = 24 * 60 * 60;
const HOUR_SECONDS = 60 * 60;
const DAY_WINDOW_STEP_SECONDS = 60;
const SHARED_AXIS_NOTE = "Shared y-axis: most parameters are shown directly as intensity [%]. CO2 and temperature are divided by 10 on the graph, so all parameters can stay visible together on one overview without the larger CO2 and temperature values dominating the axis scale.";
const SHARED_AXIS_LABEL = "Intensity [%] (except: CO2,CÂ°/10)";
const STANDARD_AXIS_LABEL = "Shared axis (CO2 and Light /10)";
const STANDARD_AXIS_NOTE = "Temperature and RH are shown directly. CO2 and Light are divided by 10 on the axis so the standard variables can stay visible together. Tooltips show the original values.";
const MATCH_WINDOW_MS = STEP_MS; // ±5 min window for sensor matching

const STANDARD_SHEET_KEYS: Record<string, string> = {
  t: "T",
  li: "LI",
  co2: "CO2",
  rh: "Rh",
};

// Two-color scheme per parameter: lighter protocol, darker sensor
const PARAM_COLORS: Record<string, { protocolColor: string; sensorColor: string }> = {
  T:   { protocolColor: "#FB923C", sensorColor: "#C2410C" },
  LI:  { protocolColor: "#FCD34D", sensorColor: "#B45309" },
  CO2: { protocolColor: "#94A3B8", sensorColor: "#334155" },
  Rh:  { protocolColor: "#4ADE80", sensorColor: "#15803D" },
};

const EXTRA_COLORS = [
  "#0EA5E9", "#10B981", "#EF4444", "#F59E0B",
  "#8B5CF6", "#14B8A6", "#E11D48", "#2563EB",
];

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

function normalizeSheetName(name: string): string | null {
  return STANDARD_SHEET_KEYS[name.toLowerCase().trim()] ?? null;
}

/** Parse datetime-local string as wall-clock UTC (matches Excel serial treatment). */
function dtLocalToMs(localStr: string): number {
  return new Date(localStr + "Z").getTime();
}

/** Excel full datetime serial → ms. Column C and D both hold the full serial. */
function excelSerialToMs(serial: number): number {
  return Math.round((serial - 25569) * 86400000);
}

/** ms → "YYYY-MM-DDTHH:MM" for datetime-local input (wall-clock UTC). */
function msToLocalInput(ms: number): string {
  return new Date(ms).toISOString().slice(0, 16);
}

function msToDateInput(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function dateInputStartToMs(dateStr: string): number {
  return new Date(`${dateStr}T00:00:00Z`).getTime();
}

function dateInputEndToMs(dateStr: string): number {
  return new Date(`${dateStr}T23:59:59.999Z`).getTime();
}

/** ms → "DD/MM HH:MM" for chart axis labels. */
function fmtAbsTime(ms: number): string {
  const d = new Date(ms);
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const mo = String(d.getUTCMonth() + 1).padStart(2, "0");
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${dd}/${mo} ${hh}:${mm}`;
}

function fmtDurationWindow(ms: number): string {
  const totalMin = Math.max(0, Math.round(ms / 60000));
  const dd = Math.floor(totalMin / (24 * 60));
  const hh = Math.floor((totalMin - dd * 24 * 60) / 60);
  const mm = totalMin % 60;
  return dd > 0
    ? `${dd}d ${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`
    : `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

function formatAxisTick(value: number): string {
  if (!Number.isFinite(value)) return "-";
  const abs = Math.abs(value);
  if (abs >= 1000) return Math.round(value).toLocaleString();
  if (abs >= 10) return String(Math.round(value));
  const fixed = value.toFixed(1);
  return fixed.endsWith(".0") ? fixed.slice(0, -2) : fixed;
}

function generateXTicks(startMs: number, endMs: number): number[] {
  const span = endMs - startMs;
  let interval: number;
  if      (span <= 2 * 86400000)  interval = 6 * 3600000;
  else if (span <= 7 * 86400000)  interval = 24 * 3600000;
  else if (span <= 30 * 86400000) interval = 3 * 86400000;
  else                             interval = 7 * 86400000;
  const ticks: number[] = [];
  const first = Math.ceil(startMs / interval) * interval;
  for (let t = first; t <= endMs; t += interval) ticks.push(t);
  return ticks;
}

function standardAxisScale(key: string): number {
  return key === "CO2" || key === "LI" ? 10 : 1;
}

function standardLineKey(kind: "protocol" | "sensor", key: string): string {
  return `${kind}_${key}`;
}

function buildStandardChartData(params: ParamResult[], startMs: number, endMs: number): Array<Record<string, any>> {
  const byTime = new Map<number, Record<string, any>>();
  params.forEach((p) => {
    p.data.forEach((row) => {
      if (row.xMs < startMs || row.xMs > endMs) return;
      const entry = byTime.get(row.xMs) ?? { xMs: row.xMs };
      const scale = standardAxisScale(p.key);
      entry[standardLineKey("protocol", p.key)] = row.protocol == null ? null : row.protocol / scale;
      entry[standardLineKey("sensor", p.key)] = row.sensor == null ? null : row.sensor / scale;
      byTime.set(row.xMs, entry);
    });
  });
  return Array.from(byTime.values()).sort((a, b) => Number(a.xMs) - Number(b.xMs));
}

function colorForExtra(name: string, index: number): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return EXTRA_COLORS[(h + index) % EXTRA_COLORS.length];
}

function colorFor(name: string): string {
  const n = (name || "").toLowerCase();
  if (has(n, "cool white") || has(n, "cool-white")) return "#7aa6ff";
  if (has(n, "warm white") || has(n, "warm-white")) return "#FFB84D";
  if (has(n, "daylight")) return "#7DB3FF";
  if (has(n, "far") && has(n, "red")) return "#b1006b";
  if (has(n, "deep") && has(n, "red")) return "#e03131";
  if (has(n, "cyan")) return "#06b6d4";
  if (has(n, "amber")) return "#f59e0b";
  if (has(n, "green")) return "#22c55e";
  if (has(n, "red")) return "#ef4444";
  if (has(n, "blue")) return "#3b82f6";
  if (has(n, "uv")) return "#7C3AED";
  if (has(n, "co2")) return "#9CA3AF";
  if (has(n, "temperature") || has(n, "temp")) return "#F97316";
  if (has(n, "humidity") || has(n, "rh")) return "#22C55E";
  if (has(n, "hydro") || has(n, "water") || has(n, "irrigation")) return "#14B8A6";
  const fallbacks = ["#0EA5E9", "#10B981", "#EF4444", "#F59E0B", "#8B5CF6", "#22C55E", "#E11D48", "#7C3AED"];
  let h = 0;
  for (let i = 0; i < n.length; i++) h = (h * 31 + n.charCodeAt(i)) >>> 0;
  return fallbacks[h % fallbacks.length];
}

function dashFor(name: string): string | undefined {
  const n = (name || "").toLowerCase();
  if (has(n, "co2")) return "6 4";
  if (has(n, "temperature") || has(n, "temp")) return "10 6";
  if (has(n, "hydro") || has(n, "irrigation") || has(n, "water")) return "3 3";
  if (has(n, "humidity") || has(n, "rh")) return "8 3 2 3";
  return undefined;
}

function scaleYByName(name: string, y: number): number {
  const n = (name || "").toLowerCase();
  if (has(n, "co2")) return y / 10;
  if (has(n, "temperature") || has(n, "temp")) return y / 10;
  return y;
}

function isScaledSeries(name: string): boolean {
  const n = (name || "").toLowerCase();
  return has(n, "co2") || has(n, "temperature") || has(n, "temp");
}

function yAt(series: XY[], x: number): number | null {
  if (!series.length) return null;
  const last = series.length - 1;
  if (x <= series[0].x) return series[0].y;
  if (x >= series[last].x) return series[last].y;
  let lo = 0, hi = last;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (series[mid].x <= x) lo = mid + 1;
    else hi = mid - 1;
  }
  const i = Math.max(1, lo) - 1;
  const a = series[i], b = series[i + 1] || a;
  if (b.x === a.x) return a.y;
  return a.y + ((x - a.x) / (b.x - a.x)) * (b.y - a.y);
}

function yAtStrict(series: XY[], x: number): number | null {
  if (!series.length) return null;
  if (x < series[0].x || x > series[series.length - 1].x) return null;
  return yAt(series, x);
}

function fmtHM(sec: number): string {
  const m = Math.max(0, Math.floor(sec / 60));
  const hh = Math.floor(m / 60);
  const mm = m % 60;
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

function ticksNice(maxSpan: number, target = 6): number[] {
  if (maxSpan <= 0) return [0, 1];
  const steps = [1, 2, 5];
  const mag = Math.pow(10, Math.floor(Math.log10(maxSpan / target)));
  let best = mag;
  let bestN = Math.ceil(maxSpan / mag);
  for (const s of steps) {
    const step = s * mag;
    const n = Math.ceil(maxSpan / step);
    if (Math.abs(n - target) < Math.abs(bestN - target)) {
      best = step;
      bestN = n;
    }
  }
  const out: number[] = [];
  for (let v = 0; v <= maxSpan + 1e-9; v += best) out.push(v);
  if (out[out.length - 1] !== Math.round(maxSpan)) out.push(maxSpan);
  return out;
}

function niceCeil(y: number): number {
  if (y <= 100) return 100;
  const mag = Math.pow(10, Math.floor(Math.log10(y)));
  const unit = mag / 2;
  return Math.ceil(y / unit) * unit;
}

function niceFloor(y: number): number {
  if (y >= 0) return 0;
  const padded = y * 1.15;
  const abs = Math.abs(padded);
  const mag = Math.pow(10, Math.floor(Math.log10(Math.max(abs, 1e-9))));
  const unit = Math.max(mag / 2, 1);
  return Math.floor(padded / unit) * unit;
}

function formatHourLabel(hour: number): string {
  return fmtHM(Math.round(hour * HOUR_SECONDS));
}

function seriesKey(index: number): string {
  return `series_${index}`;
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(Math.max(n, min), max);
}

function dayLabel(dayIndex: number): string {
  return `Day ${dayIndex + 1}`;
}

function normalizeType(t: any): "fixed" | "ramp" | "sin" | "clouds" | "csv-import" {
  const s = String(t || "").toLowerCase().trim();
  if (s === "fixed" || s === "const" || s === "constant") return "fixed";
  if (s === "ramp") return "ramp";
  if (s === "sin" || s === "sine") return "sin";
  if (s === "clouds" || s === "cloud") return "clouds";
  if (s === "csv-import") return "csv-import";
  return "fixed";
}

function ensurePhaseShape(raw: any) {
  const t = normalizeType(raw?.type);
  const base = { ...raw, type: t };
  if (t === "fixed") return { duration: "01:00:00", value: 0, ...base };
  if (t === "ramp") return { duration: "01:00:00", step: "00:05:00", start: 0, end: 0, ...base };
  if (t === "sin") return { duration: "01:00:00", step: "00:05:00", min: 0, max: 0, period: "01:00:00", phaseOffset: "00:00:00", ...base };
  if (t === "clouds") {
    return {
      duration: "01:00:00",
      step: "00:05:00",
      offset: 0,
      amplitude: 0,
      cloud_density: 0,
      cloud_position: 0,
      cloud_duration_mean: 0,
      cloud_duration_var: 0,
      fluctuation_mean_ratio: 0,
      fluctuation_var: 0,
      cloud_drop_coeff: 0,
      ...base,
    };
  }
  if (t === "csv-import") return { points: Array.isArray(raw?.points) ? raw.points : [], ...base };
  return base;
}

function formatDetailValue(value: any): string {
  if (value == null || value === "") return "-";
  if (typeof value === "number") return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(2)));
  if (Array.isArray(value)) return `${value.length} item${value.length === 1 ? "" : "s"}`;
  return String(value);
}

function phaseDetails(phase: any): Array<{ label: string; value: string }> {
  const shaped = ensurePhaseShape(phase);
  const type = shaped.type as string;
  if (type === "fixed") return [{ label: "Value", value: formatDetailValue(shaped.value) }];
  if (type === "ramp") {
    return [
      { label: "Step", value: formatDetailValue(shaped.step) },
      { label: "Start", value: formatDetailValue(shaped.start) },
      { label: "End", value: formatDetailValue(shaped.end) },
    ];
  }
  if (type === "sin") {
    return [
      { label: "Step", value: formatDetailValue(shaped.step) },
      { label: "Min", value: formatDetailValue(shaped.min) },
      { label: "Max", value: formatDetailValue(shaped.max) },
      { label: "Period", value: formatDetailValue(shaped.period) },
      { label: "Phase Offset", value: formatDetailValue(shaped.phaseOffset) },
    ];
  }
  if (type === "clouds") {
    return [
      { label: "Step", value: formatDetailValue(shaped.step) },
      { label: "Offset", value: formatDetailValue(shaped.offset) },
      { label: "Amplitude", value: formatDetailValue(shaped.amplitude) },
      { label: "Cloud Density", value: formatDetailValue(shaped.cloud_density) },
      { label: "Cloud Position", value: formatDetailValue(shaped.cloud_position) },
      { label: "Cloud Mean", value: formatDetailValue(shaped.cloud_duration_mean) },
      { label: "Cloud Sigma", value: formatDetailValue(shaped.cloud_duration_var) },
      { label: "Fluct. Mean", value: formatDetailValue(shaped.fluctuation_mean_ratio) },
      { label: "Fluct. Sigma", value: formatDetailValue(shaped.fluctuation_var) },
      { label: "Drop Coeff.", value: formatDetailValue(shaped.cloud_drop_coeff) },
    ];
  }
  if (type === "csv-import") return [{ label: "Points", value: formatDetailValue(shaped.points) }];
  return [];
}

function has(s: string | undefined, sub: string): boolean {
  return (s || "").toLowerCase().includes(sub.toLowerCase());
}

function groupToParam(name: string): "T" | "CO2" | "Rh" | "lamp" | null {
  const n = (name || "").toLowerCase();
  if (has(n, "temp") || has(n, "°c")) return "T";
  if (has(n, "co2")) return "CO2";
  if (has(n, "humid") || n === "rh" || (has(n, "rh") && !has(n, "red"))) return "Rh";
  if (
    has(n, "white") || has(n, "deep red") || has(n, "far red") ||
    has(n, "blue") || has(n, "cyan") || has(n, "amber") ||
    has(n, "green") || has(n, "uv") || has(n, "lamp") || has(n, "led") ||
    has(n, "daylight")
  ) return "lamp";
  return null;
}

function groupToChannelKey(name: string, room: RoomConfig): string | null {
  const n = name.toLowerCase();
  for (const ch of room.channels) {
    const pn = ch.protocolGroupName.toLowerCase();
    if (n === pn || n.includes(pn) || pn.includes(n)) return ch.key;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Sensor data parsing
// ---------------------------------------------------------------------------

/**
 * Parse an XLSX worksheet to {ts, value} pairs.
 *
 * Both "Measuring Date" (col C) and "Measuring Time" (col D) contain the same
 * full datetime serial — use only col C, ignore col D.
 */
function parseSheetToSeries(ws: XLSX.WorkSheet): SensorPoint[] {
  const rows: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null });
  const points: SensorPoint[] = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.length < 6) continue;
    const dateRaw = row[2]; // col C: full datetime serial
    const valueRaw = row[5]; // col F: measured value
    if (typeof dateRaw !== "number" || typeof valueRaw !== "number") continue;
    const ts = excelSerialToMs(dateRaw);
    if (!isFinite(ts)) continue;
    points.push({ ts, value: valueRaw });
  }
  points.sort((a, b) => a.ts - b.ts);
  return points;
}

/** Return the average of sensor readings within ±windowMs of targetMs, or null. */
function avgSensorValue(sorted: SensorPoint[], targetMs: number, windowMs: number): number | null {
  if (!sorted.length) return null;
  // Binary search for first point >= targetMs - windowMs
  const lo_bound = targetMs - windowMs;
  const hi_bound = targetMs + windowMs;
  let lo = 0, hi = sorted.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid].ts < lo_bound) lo = mid + 1;
    else hi = mid;
  }
  let sum = 0, count = 0;
  for (let i = lo; i < sorted.length && sorted[i].ts <= hi_bound; i++) {
    sum += sorted[i].value;
    count++;
  }
  return count ? sum / count : null;
}

// ---------------------------------------------------------------------------
// File picker
// ---------------------------------------------------------------------------

function pickFile(accept: string): Promise<File> {
  return new Promise((resolve, reject) => {
    const inp = document.createElement("input");
    inp.type = "file"; inp.accept = accept;
    inp.onchange = () => { const f = inp.files?.[0]; if (f) resolve(f); else reject(new Error("No file")); };
    inp.click();
  });
}

// ---------------------------------------------------------------------------
// SectionCard (local copy to avoid cross-tab coupling)
// ---------------------------------------------------------------------------

function SectionCard({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div style={{ border: "1px solid #dbe3ea", borderRadius: 12, background: "#ffffff", padding: 16, boxShadow: "0 4px 14px rgba(15,23,42,0.04)" }}>
      <div style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 18, fontWeight: 700, color: "#0f172a" }}>{title}</div>
        {subtitle && <div style={{ marginTop: 4, fontSize: 13, color: "#64748b" }}>{subtitle}</div>}
      </div>
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function ExperimentCheckTab() {
  const [room, setRoom] = useState<string>("G8");
  const [sensorFileName, setSensorFileName] = useState("");
  const [protocolFileName, setProtocolFileName] = useState("");
  const [calibFileName, setCalibFileName] = useState("");
  const [sensorFileRef, setSensorFileRef] = useState<File | null>(null);
  const [protocolFileRef, setProtocolFileRef] = useState<File | null>(null);
  const [calibFileRef, setCalibFileRef] = useState<File | null>(null);
  const [parsedWorkbook, setParsedWorkbook] = useState<XLSX.WorkBook | null>(null);
  const [startDT, setStartDT] = useState("");
  const [endDT, setEndDT] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<CompareResults | null>(null);
  const [extraSheets, setExtraSheets] = useState<Set<string>>(new Set());
  const [standardVisible, setStandardVisible] = useState<Set<string>>(new Set(["T", "LI", "CO2", "Rh"]));
  const [standardZoom, setStandardZoom] = useState(1);
  const [standardScroll, setStandardScroll] = useState(0);
  const [visible, setVisible] = useState<Set<number>>(new Set());
  const [zoom, setZoom] = useState<number>(1);
  const [scroll, setScroll] = useState<number>(0);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const [selPhase, setSelPhase] = useState<{ gi: number; pi: number } | null>(null);
  const [dayIndex, setDayIndex] = useState(0);

  const roomConfig = ROOM_CONFIGS[room];

  async function onPickSensor() {
    try {
      const f = await pickFile(".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      setSensorFileName(f.name);
      setSensorFileRef(f);
      // Parse immediately to cache workbook and auto-fill date range
      try {
        const wb = XLSX.read(new Uint8Array(await f.arrayBuffer()), { type: "array", cellDates: false });
        setParsedWorkbook(wb);
        // Find date range from the first standard sheet that has data
        for (const sheetName of wb.SheetNames) {
          if (!normalizeSheetName(sheetName)) continue;
          const pts = parseSheetToSeries(wb.Sheets[sheetName]);
          if (pts.length >= 2) {
            setStartDT(msToDateInput(pts[0].ts));
            setEndDT(msToDateInput(pts[pts.length - 1].ts));
            break;
          }
        }
      } catch (e: any) {
        console.warn("[ExperimentCheck] Pre-parse failed:", e?.message);
      }
    } catch { /* cancelled */ }
  }

  async function onPickProtocol() {
    try {
      const f = await pickFile(".fyt,application/octet-stream");
      if (!f.name.toLowerCase().endsWith(".fyt")) {
        setError("Please upload a .fyt protocol file.");
        return;
      }
      setProtocolFileName(f.name); setProtocolFileRef(f);
    } catch { /* cancelled */ }
  }

  async function onPickCalib() {
    try {
      const f = await pickFile(".csv,text/csv,text/plain");
      setCalibFileName(f.name); setCalibFileRef(f);
    } catch { /* cancelled */ }
  }

  async function onCompare() {
    setError(null);
    if (!sensorFileRef || !protocolFileRef || !calibFileRef || !startDT || !endDT) {
      setError("Please upload sensor data, protocol, and lamp calibration files, and set start/end datetime.");
      return;
    }
    const startMs = dateInputStartToMs(startDT);
    const endMs   = dateInputEndToMs(endDT);
    if (endMs <= startMs) { setError("End datetime must be after start."); return; }

    setLoading(true);
    try {
      // --- Parse protocol ---
      let protocol: any;
      if (!protocolFileRef.name.toLowerCase().endsWith(".fyt")) {
        throw new Error("Protocol upload must be a .fyt file.");
      }
      const bytes = new Uint8Array(await protocolFileRef.arrayBuffer());
      try {
        const dec: any = decodeFYT(bytes);
        protocol = canonicalizeProtocol(dec.protocol ?? dec);
      } catch {
        const txt = new TextDecoder().decode(bytes);
        protocol = canonicalizeProtocol(JSON.parse(txt.slice(0, Math.max(0, txt.lastIndexOf("}") + 1))));
      }

      const parts: any[] = protocol?.sections?.[0]?.parts ?? [];
      const protocolRepeat = Math.max(1, Number(protocol?.repeat ?? 1));
      const protocolRows: ProtocolGraphRow[] = parts.map((g: any, idx: number) => {
        const out = sampleGroup(g);
        const xmax = out.series.length ? out.series[out.series.length - 1].x : 1;
        const name = (g && (g["group-name"] ?? g.name)) || (Array.isArray(g?.vars) && g.vars.length ? `Group ${idx + 1} (${g.vars[0]})` : `Group ${idx + 1}`);
        const unit = g?.unit || "";
        return { i: idx, name, unit, series: out.series, phaseStarts: out.phaseStarts, xmax };
      });

      const groupSeries = parts.map((g: any) => {
        const name = String(g["group-name"] ?? g.name ?? "");
        const out = sampleGroup(g);
        const baseDuration = out.series.length ? out.series[out.series.length - 1].x : 0;
        return { name, xy: out.series, baseDuration };
      });

      const maxBase = Math.max(1, ...groupSeries.map((g) => g.baseDuration));
      const totalProtocolSec = maxBase * protocolRepeat;

      // --- Parse calibration ---
      const calData: LampCalibrationData = parseLampCalibrationCsv(await calibFileRef.text(), roomConfig);

      // --- Use cached workbook or re-parse ---
      const wb = parsedWorkbook ?? XLSX.read(new Uint8Array(await sensorFileRef.arrayBuffer()), { type: "array", cellDates: false });

      const standardSensor: Record<string, SensorPoint[]> = {};
      const restSheetNames: string[] = [];
      for (const sheetName of wb.SheetNames) {
        const norm = normalizeSheetName(sheetName);
        if (norm) standardSensor[norm] = parseSheetToSeries(wb.Sheets[sheetName]);
        else restSheetNames.push(sheetName);
      }

      // --- Protocol series helpers ---

      function getParamXY(category: "T" | "CO2" | "Rh"): XY[] {
        const g = groupSeries.find((gs) => groupToParam(gs.name) === category);
        if (!g) return [];
        // Temperature stored as 10× actual °C
        if (category === "T") return g.xy.map((p) => ({ x: p.x, y: p.y / 10 }));
        return g.xy;
      }

      function buildRows(protXY: XY[], sensorPts: SensorPoint[]): ChartRow[] {
        const rows: ChartRow[] = [];
        for (let tMs = startMs; tMs <= endMs; tMs += STEP_MS) {
          const tSec = (tMs - startMs) / 1000;
          let protVal: number | null = null;
          if (tSec <= totalProtocolSec && protXY.length) {
            protVal = yAt(protXY, tSec % maxBase);
          }
          rows.push({ xMs: tMs, protocol: protVal, sensor: avgSensorValue(sensorPts, tMs, MATCH_WINDOW_MS) });
        }
        return rows;
      }

      function buildLIRows(): ChartRow[] {
        const lampGroups = groupSeries.filter((gs) => groupToParam(gs.name) === "lamp");
        const liSensor = standardSensor["LI"] ?? [];
        const rows: ChartRow[] = [];
        for (let tMs = startMs; tMs <= endMs; tMs += STEP_MS) {
          const tSec = (tMs - startMs) / 1000;
          let protVal: number | null = null;
          if (tSec <= totalProtocolSec && lampGroups.length) {
            const tInProto = tSec % maxBase;
            const percents: Record<string, number> = {};
            for (const ch of roomConfig.channels) percents[ch.key] = 0;
            for (const lg of lampGroups) {
              const chKey = groupToChannelKey(lg.name, roomConfig);
              if (chKey) percents[chKey] = Math.max(0, Math.min(100, yAt(lg.xy, tInProto) ?? 0));
            }
            const spectrum = convertSpectrumToUmol(reconstructSpectrum(calData, percents));
            protVal = integrateSpectrum(spectrum, 400, 700);
          }
          rows.push({ xMs: tMs, protocol: protVal, sensor: avgSensorValue(liSensor, tMs, MATCH_WINDOW_MS) });
        }
        return rows;
      }

      // --- Assemble results ---
      const standard: ParamResult[] = [
        {
          key: "T", title: "Temperature", unit: "°C",
          ...PARAM_COLORS.T,
          hasProtocol: groupSeries.some((g) => groupToParam(g.name) === "T"),
          hasSensor: (standardSensor["T"] ?? []).length > 0,
          data: buildRows(getParamXY("T"), standardSensor["T"] ?? []),
        },
        {
          key: "LI", title: "Light Intensity", unit: "µmol/m²/s",
          ...PARAM_COLORS.LI,
          hasProtocol: groupSeries.some((g) => groupToParam(g.name) === "lamp"),
          hasSensor: (standardSensor["LI"] ?? []).length > 0,
          data: buildLIRows(),
        },
        {
          key: "CO2", title: "CO₂", unit: "ppm",
          ...PARAM_COLORS.CO2,
          hasProtocol: groupSeries.some((g) => groupToParam(g.name) === "CO2"),
          hasSensor: (standardSensor["CO2"] ?? []).length > 0,
          data: buildRows(getParamXY("CO2"), standardSensor["CO2"] ?? []),
        },
        {
          key: "Rh", title: "Relative Humidity", unit: "%",
          ...PARAM_COLORS.Rh,
          hasProtocol: groupSeries.some((g) => groupToParam(g.name) === "Rh"),
          hasSensor: (standardSensor["Rh"] ?? []).length > 0,
          data: buildRows(getParamXY("Rh"), standardSensor["Rh"] ?? []),
        },
      ];

      setResults({ standard, restSheets: restSheetNames, workbook: wb, protocol, protocolRows, startMs, endMs });
      setStandardVisible(new Set(standard.filter((p) => p.hasProtocol || p.hasSensor).map((p) => p.key)));
      setStandardZoom(1);
      setStandardScroll(0);
      setVisible(new Set(protocolRows.map((_, idx) => idx)));
      setZoom(1);
      setScroll(0);
      setHoverIdx(null);
      setSelPhase(null);
      setDayIndex(0);
      setExtraSheets(new Set());
    } catch (e: any) {
      setError(`Error: ${e?.message ?? String(e)}`);
    } finally {
      setLoading(false);
    }
  }

  function toggleExtra(name: string) {
    setExtraSheets((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name); else next.add(name);
      return next;
    });
  }

  function toggleStandard(key: string) {
    setStandardVisible((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      if (next.size === 0 && results) {
        return new Set(results.standard.filter((p) => p.hasProtocol || p.hasSensor).map((p) => p.key));
      }
      return next;
    });
  }

  const canCompare = !loading && !!sensorFileRef && !!protocolFileRef && !!calibFileRef && !!startDT && !!endDT;
  const standardAvailable = results?.standard.filter((p) => p.hasProtocol || p.hasSensor) ?? [];
  const selectedStandard = standardAvailable.filter((p) => standardVisible.has(p.key));
  const standardSpanMs = results ? Math.max(STEP_MS, results.endMs - results.startMs) : STEP_MS;
  const standardWindowMs = standardSpanMs / Math.max(1, standardZoom);
  const standardDomainStart = results ? results.startMs + Math.min(standardScroll, 1) * Math.max(0, standardSpanMs - standardWindowMs) : 0;
  const standardDomainEnd = standardDomainStart + standardWindowMs;
  const standardChartData = useMemo(
    () => results ? buildStandardChartData(standardAvailable, results.startMs, results.endMs) : [],
    [results, standardAvailable],
  );
  const standardWindowTicks = results ? generateXTicks(standardDomainStart, standardDomainEnd) : [];
  const firstDayEndMs = results ? Math.min(results.endMs, results.startMs + DAY_MS) : 0;
  const firstDayChartData = useMemo(
    () => results ? buildStandardChartData(standardAvailable, results.startMs, firstDayEndMs) : [],
    [results, standardAvailable, firstDayEndMs],
  );
  const firstDayTicks = results ? generateXTicks(results.startMs, firstDayEndMs) : [];
  const extraSelected = results?.restSheets.filter((name) => extraSheets.has(name)) ?? [];
  const extraDefs = useMemo(
    () => extraSelected.map((name) => {
      const index = results?.restSheets.indexOf(name) ?? 0;
      return { name, key: `extra_${index}`, color: colorForExtra(name, index) };
    }),
    [extraSelected, results],
  );
  const extraChartData = useMemo(() => {
    if (!results || !extraDefs.length) return [];
    const parsed = extraDefs.map((def) => ({
      ...def,
      points: results.workbook.Sheets[def.name] ? parseSheetToSeries(results.workbook.Sheets[def.name]) : [],
    }));
    const rows: Array<Record<string, any>> = [];
    for (let tMs = results.startMs; tMs <= results.endMs; tMs += STEP_MS) {
      const row: Record<string, any> = { xMs: tMs };
      parsed.forEach((def) => {
        row[def.key] = avgSensorValue(def.points, tMs, MATCH_WINDOW_MS);
      });
      rows.push(row);
    }
    return rows;
  }, [results, extraDefs]);
  const extraTicks = results ? generateXTicks(results.startMs, results.endMs) : [];
  const xTicks = results ? generateXTicks(results.startMs, results.endMs) : [];
  const protocolParts = results?.protocol?.sections?.[0]?.parts ?? [];
  const protocolRows = results?.protocolRows ?? [];
  const globalXMax = Math.max(1, ...protocolRows.map((r) => r.xmax));
  const totalDays = Math.max(1, Math.ceil(globalXMax / DAY_SECONDS));
  const xWindow = globalXMax / Math.max(1, zoom);
  const xMin = Math.min(scroll, 1) * Math.max(0, globalXMax - xWindow);
  const xMax = xMin + xWindow;

  useEffect(() => {
    setDayIndex((prev) => clamp(prev, 0, Math.max(0, totalDays - 1)));
  }, [totalDays]);

  const frozenYRangeRef = useRef<{ ymin: number; ymax: number; span: number } | null>(null);
  useEffect(() => {
    let ymaxScaled = 0;
    let yminScaled = 0;
    protocolRows.forEach((r) => r.series.forEach((p) => {
      const ys = scaleYByName(r.name, p.y);
      if (ys > ymaxScaled) ymaxScaled = ys;
      if (ys < yminScaled) yminScaled = ys;
    }));
    const ymin = niceFloor(yminScaled);
    const ymax = niceCeil(ymaxScaled);
    frozenYRangeRef.current = { ymin, ymax, span: Math.max(1, ymax - ymin) };
  }, [protocolRows]);

  const yRange = frozenYRangeRef.current || { ymin: 0, ymax: 100, span: 100 };
  const vw = 1000;
  const vh = 380;
  const left = 92;
  const right = 24;
  const top = 18;
  const bottom = 46;
  const plotW = vw - left - right;
  const plotH = vh - top - bottom;
  const graphXTicks = useMemo(() => ticksNice(xWindow), [xWindow]);
  const mapX = (x: number) => left + ((x - xMin) / Math.max(1e-6, xMax - xMin)) * plotW;
  const mapY = (ys: number) => top + (plotH - ((ys - yRange.ymin) / Math.max(1e-6, yRange.span)) * plotH);
  const nudgePx = (idx: number) => ((idx % 3) - 1) * 1.2;

  function toggleVisible(i: number) {
    setVisible((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i); else next.add(i);
      return next.size ? next : new Set(protocolRows.map((_, idx) => idx));
    });
  }

  function pathFrom(points: XY[], name: string, idx: number): string {
    let d = "";
    const offset = nudgePx(idx);
    for (let i = 0; i < points.length; i++) {
      const p = points[i];
      if (p.x < xMin && (points[i + 1]?.x ?? p.x) < xMin) continue;
      if (p.x > xMax && (points[i - 1]?.x ?? p.x) > xMax) break;
      const x = mapX(Math.min(Math.max(p.x, xMin), xMax));
      const y = mapY(scaleYByName(name, p.y)) + offset;
      d += d ? ` L ${x} ${y}` : `M ${x} ${y}`;
    }
    return d || `M ${left} ${top + plotH} L ${left + plotW} ${top + plotH}`;
  }

  const rowBySeriesKey = useMemo(() => {
    const map = new Map<string, ProtocolGraphRow>();
    protocolRows.forEach((row) => map.set(seriesKey(row.i), row));
    return map;
  }, [protocolRows]);

  const dayWindowData = useMemo(() => {
    const absoluteStart = dayIndex * DAY_SECONDS;
    const data: Array<Record<string, number | string | null>> = [];
    for (let offset = 0; offset <= DAY_SECONDS; offset += DAY_WINDOW_STEP_SECONDS) {
      const absolute = absoluteStart + Math.min(offset, DAY_SECONDS);
      const entry: Record<string, number | string | null> = { hour: offset / HOUR_SECONDS, label: fmtHM(offset) };
      protocolRows.forEach((row) => {
        const value = yAtStrict(row.series, absolute);
        entry[seriesKey(row.i)] = value == null ? null : scaleYByName(row.name, value);
      });
      data.push(entry);
    }
    return data;
  }, [protocolRows, dayIndex]);

  function renderParamChart(p: ParamResult) {
    if (!p.hasProtocol && !p.hasSensor) return null;
    const subtitle = !p.hasProtocol
      ? "No matching protocol group — sensor data only."
      : !p.hasSensor
      ? `No '${p.key}' sheet found in sensor file — protocol only.`
      : undefined;
    return (
      <SectionCard key={p.key} title={p.title} subtitle={subtitle}>
        <div style={{ width: "100%", height: 280 }}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={p.data} margin={{ top: 8, right: 24, left: 56, bottom: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis
                dataKey="xMs"
                type="number"
                scale="time"
                domain={[results!.startMs, results!.endMs]}
                ticks={xTicks}
                tickFormatter={fmtAbsTime}
                tick={{ fontSize: 10 }}
              />
              <YAxis
                tick={{ fontSize: 11 }}
                label={{ value: p.unit, angle: -90, position: "insideLeft", dx: -8, dy: p.unit.length > 3 ? 50 : 30, style: { fontSize: 11 } }}
              />
              <Tooltip
                labelFormatter={(v) => fmtAbsTime(Number(v))}
                formatter={(val: any, name: string) => [val == null ? "–" : `${Number(val).toFixed(2)} ${p.unit}`, name]}
              />
              <Legend />
              {p.hasProtocol && (
                <Line
                  dataKey="protocol"
                  name="Protocol"
                  stroke={p.protocolColor}
                  strokeWidth={1.5}
                  strokeDasharray="6 3"
                  dot={false}
                  isAnimationActive={false}
                  connectNulls={false}
                />
              )}
              {p.hasSensor && (
                <Line
                  dataKey="sensor"
                  name="Measured"
                  stroke={p.sensorColor}
                  strokeWidth={2}
                  dot={false}
                  isAnimationActive={false}
                  connectNulls={true}
                />
              )}
            </LineChart>
          </ResponsiveContainer>
        </div>
      </SectionCard>
    );
  }

  function renderStandardLines(params: ParamResult[]) {
    return params.flatMap((p) => {
      const lines: React.ReactNode[] = [];
      if (p.hasProtocol) {
        lines.push(
          <Line key={standardLineKey("protocol", p.key)} dataKey={standardLineKey("protocol", p.key)} name={`${p.title} Protocol`} stroke={p.protocolColor} strokeWidth={1.5} strokeDasharray="6 3" dot={false} isAnimationActive={false} connectNulls={false} />,
        );
      }
      if (p.hasSensor) {
        lines.push(
          <Line key={standardLineKey("sensor", p.key)} dataKey={standardLineKey("sensor", p.key)} name={`${p.title} Measured`} stroke={p.sensorColor} strokeWidth={2} dot={false} isAnimationActive={false} connectNulls={true} />,
        );
      }
      return lines;
    });
  }

  function formatStandardTooltip(val: any, _name: string, item: any) {
    if (val == null) return ["-", _name];
    const dataKey = String(item?.dataKey ?? "");
    const [, kind, key] = dataKey.match(/^(protocol|sensor)_(.+)$/) ?? [];
    const p = standardAvailable.find((candidate) => candidate.key === key);
    const actual = Number(val) * standardAxisScale(key);
    const label = p ? `${p.title} ${kind === "protocol" ? "Protocol" : "Measured"}` : _name;
    return [`${actual.toFixed(2)} ${p?.unit ?? ""}`, label];
  }

  function renderStandardFlexibleChart() {
    if (!results || !standardAvailable.length) return null;
    const missingNotes = standardAvailable
      .filter((p) => !p.hasProtocol || !p.hasSensor)
      .map((p) => `${p.title}: ${!p.hasProtocol ? "sensor only" : "protocol only"}`);
    return (
      <SectionCard title="Flexible Graph" subtitle="Temperature, Light intensity, CO2, and RH in one graph. Select the parameters you want to inspect.">
        <div className="hstack" style={{ gap: 16, alignItems: "center", flexWrap: "wrap", marginBottom: 10 }}>
          <div className="hstack" style={{ gap: 8 }}>
            <label>Zoom:</label>
            <input type="range" min={1} max={10} step={1} value={standardZoom} onChange={(e) => setStandardZoom(parseInt(e.target.value, 10))} />
            <span className="mono">{standardZoom}x</span>
          </div>
          <div className="hstack" style={{ gap: 8 }}>
            <label>Scroll:</label>
            <input type="range" min={0} max={1} step={0.01} value={standardScroll} onChange={(e) => setStandardScroll(parseFloat(e.target.value))} />
          </div>
          <div className="muted small">Window: {fmtDurationWindow(standardDomainStart - results.startMs)} -&gt; {fmtDurationWindow(standardDomainEnd - results.startMs)}</div>
        </div>
        <div className="hstack" style={{ gap: 16, flexWrap: "wrap", marginBottom: 10 }}>
          {standardAvailable.map((p) => (
            <label key={p.key} style={{ display: "inline-flex", gap: 8, alignItems: "center", cursor: "pointer" }}>
              <input type="checkbox" checked={standardVisible.has(p.key)} onChange={() => toggleStandard(p.key)} />
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                <span style={{ width: 18, height: 0, borderTop: `3px solid ${p.sensorColor}`, display: "inline-block" }} />
                <span>{p.title}</span>
              </span>
            </label>
          ))}
        </div>
        <div style={{ width: "100%", height: 360 }}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={standardChartData} margin={{ top: 12, right: 24, left: 42, bottom: 12 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="xMs" type="number" scale="time" domain={[standardDomainStart, standardDomainEnd]} ticks={standardWindowTicks} tickFormatter={fmtAbsTime} tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 11 }} tickFormatter={(value) => formatAxisTick(Number(value))} label={{ value: STANDARD_AXIS_LABEL, angle: -90, position: "insideLeft", dx: -8, dy: 72, style: { fontSize: 11 } }} />
              <Tooltip labelFormatter={(v) => fmtAbsTime(Number(v))} formatter={formatStandardTooltip} />
              <Legend />
              {renderStandardLines(selectedStandard)}
            </LineChart>
          </ResponsiveContainer>
        </div>
        <div style={{ marginTop: 10, fontSize: 12, color: "#64748b" }}>
          {STANDARD_AXIS_NOTE}
          {missingNotes.length ? ` ${missingNotes.join("; ")}.` : ""}
        </div>
      </SectionCard>
    );
  }

  function renderFirstDayChart() {
    if (!results || !standardAvailable.length) return null;
    return (
      <SectionCard title="24-Hour Graph" subtitle={`Uses the filled-in experiment start as the starting time: ${fmtAbsTime(results.startMs)}. The graph stops at the probe end time if the probe range is shorter than 24 hours.`}>
        <div style={{ width: "100%", height: 320 }}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={firstDayChartData} margin={{ top: 12, right: 24, left: 42, bottom: 12 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="xMs" type="number" scale="time" domain={[results.startMs, firstDayEndMs]} ticks={firstDayTicks} tickFormatter={fmtAbsTime} tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 11 }} tickFormatter={(value) => formatAxisTick(Number(value))} label={{ value: STANDARD_AXIS_LABEL, angle: -90, position: "insideLeft", dx: -8, dy: 72, style: { fontSize: 11 } }} />
              <Tooltip labelFormatter={(v) => fmtAbsTime(Number(v))} formatter={formatStandardTooltip} />
              <Legend />
              {renderStandardLines(selectedStandard)}
            </LineChart>
          </ResponsiveContainer>
        </div>
        <div style={{ marginTop: 10, fontSize: 12, color: "#64748b" }}>
          This 24-hour graph follows the same parameter selection as the flexible graph.
        </div>
      </SectionCard>
    );
  }

  function renderAdditionalChannelsChart() {
    if (!results || !results.restSheets.length) return null;
    return (
      <SectionCard title="Additional Channels" subtitle="Optional: select extra sensor sheets to inspect. Selected sheets are shown together in one graph.">
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginBottom: 12 }}>
          {results.restSheets.map((name) => (
            <label key={name} style={{ display: "inline-flex", gap: 6, alignItems: "center", cursor: "pointer" }}>
              <input type="checkbox" checked={extraSheets.has(name)} onChange={() => toggleExtra(name)} />
              <span>{name}</span>
            </label>
          ))}
        </div>
        {extraDefs.length ? (
          <div style={{ width: "100%", height: 280 }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={extraChartData} margin={{ top: 8, right: 24, left: 40, bottom: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="xMs" type="number" scale="time" domain={[results.startMs, results.endMs]} ticks={extraTicks} tickFormatter={fmtAbsTime} tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 11 }} tickFormatter={(value) => formatAxisTick(Number(value))} />
                <Tooltip labelFormatter={(v) => fmtAbsTime(Number(v))} formatter={(val: any, name: string) => [val == null ? "-" : Number(val).toFixed(2), name]} />
                <Legend />
                {extraDefs.map((def) => (
                  <Line key={def.key} dataKey={def.key} name={def.name} stroke={def.color} strokeWidth={1.8} dot={false} isAnimationActive={false} connectNulls={true} />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <div style={{ padding: 14, border: "1px dashed #cbd5e1", borderRadius: 10, background: "#f8fafc", color: "#64748b", fontSize: 13 }}>
            Select one or more additional channels to show them in this graph.
          </div>
        )}
      </SectionCard>
    );
  }

  function renderProtocolDayGraph() {
    if (!results || !protocolRows.length) return null;
    return (
      <SectionCard title="24-Hour Graph" subtitle={`Single-day view for all parameters. Protocol span: ${formatDurationPreserveDays(globalXMax)} (${totalDays} day${totalDays === 1 ? "" : "s"}).`}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center", marginBottom: 12 }}>
          <button className="btn" onClick={() => setDayIndex((prev) => clamp(prev - 1, 0, totalDays - 1))} disabled={dayIndex === 0}>Previous day</button>
          <button className="btn" onClick={() => setDayIndex((prev) => clamp(prev + 1, 0, totalDays - 1))} disabled={dayIndex >= totalDays - 1}>Next day</button>
          <div style={{ minWidth: 120, fontWeight: 600, color: "#0f172a" }}>{dayLabel(dayIndex)}</div>
          <input type="range" min={0} max={Math.max(0, totalDays - 1)} step={1} value={dayIndex} onChange={(event) => setDayIndex(Number(event.target.value))} style={{ flex: "1 1 320px" }} />
        </div>
        <div style={{ width: "100%", height: 360 }}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={dayWindowData} margin={{ top: 12, right: 24, left: 34, bottom: 12 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="hour" type="number" domain={[0, 24]} ticks={[0, 4, 8, 12, 16, 20, 24]} tickFormatter={formatHourLabel} label={{ value: "Time of day", position: "insideBottom", offset: -6 }} />
              <YAxis width={102} domain={["auto", "auto"]} tick={{ fontSize: 11 }} tickFormatter={(value) => formatAxisTick(Number(value))} label={{ value: SHARED_AXIS_LABEL, angle: -90, position: "insideLeft", dx: -8, dy: 82 }} />
              <Tooltip labelFormatter={(value) => formatHourLabel(Number(value))} formatter={(value: any, _name: any, item: any) => { const row = rowBySeriesKey.get(String(item?.dataKey ?? "")); const unit = row?.unit ? ` ${row.unit}` : ""; const numericValue = value == null ? null : Number(value); const actualValue = row && isScaledSeries(row.name) && numericValue != null ? numericValue * 10 : numericValue; const suffix = row && isScaledSeries(row.name) ? " (axis shows /10)" : ""; return [actualValue == null ? "-" : `${actualValue.toFixed(2)}${unit}${suffix}`, row?.name ?? item?.name ?? ""]; }} />
              <Legend />
              {protocolRows.map((row) => <Line key={seriesKey(row.i)} type="monotone" dataKey={seriesKey(row.i)} name={row.name} stroke={colorFor(row.name)} strokeDasharray={dashFor(row.name)} dot={false} strokeWidth={2} connectNulls={false} isAnimationActive={false} />)}
            </LineChart>
          </ResponsiveContainer>
        </div>
        <div style={{ marginTop: 10, fontSize: 12, color: "#64748b" }}>{SHARED_AXIS_NOTE} This graph always shows one 24-hour window. Use the day scroller to move through long experiments such as 40-day schedules.</div>
      </SectionCard>
    );
  }

  function renderProtocolFlexibleGraph() {
    if (!results || !protocolRows.length) return null;
    return (
      <SectionCard title="Flexible Graph" subtitle="Full-protocol graph with zoom, scroll, phase markers, and read-only phase inspection.">
        <div className="label" style={{ marginBottom: 8 }}><span><b>Flexible graph controls</b></span></div>
        <div className="hstack" style={{ gap: 16, alignItems: "center", flexWrap: "wrap", marginBottom: 10 }}>
          <div className="hstack" style={{ gap: 8 }}><label>Zoom:</label><input type="range" min={1} max={10} step={1} value={zoom} onChange={(e) => setZoom(parseInt(e.target.value, 10))} /><span className="mono">{zoom}x</span></div>
          <div className="hstack" style={{ gap: 8 }}><label>Scroll:</label><input type="range" min={0} max={1} step={0.01} value={scroll} onChange={(e) => setScroll(parseFloat(e.target.value))} /></div>
          <div className="muted small">Window: {fmtHM(xMin)} -&gt; {fmtHM(xMax)}</div>
        </div>
        <div className="hstack" style={{ gap: 16, flexWrap: "wrap", marginBottom: 10 }}>
          {protocolRows.map((row, idx) => {
            const color = colorFor(row.name);
            const on = visible.has(idx);
            const dash = dashFor(row.name);
            return <label key={idx} style={{ display: "inline-flex", gap: 8, alignItems: "center", cursor: "pointer" }}><input type="checkbox" checked={on} onChange={() => toggleVisible(idx)} /><span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><span style={{ width: 18, height: 0, borderTop: `3px ${dash ? "dashed" : "solid"} ${color}`, display: "inline-block" }} /><span>{row.name}</span></span></label>;
          })}
        </div>
        <div style={{ width: "100%", maxWidth: 1240, margin: "0 auto", background: "#fafafa", border: "1px solid #eee", borderRadius: 8, padding: 8, boxSizing: "border-box", overflow: "visible", position: "relative" }}>
          <svg viewBox="0 0 1000 380" preserveAspectRatio="xMidYMid meet" style={{ display: "block", width: "100%", height: "auto" }}>
            <line x1={left} y1={top} x2={left} y2={top + plotH} stroke="#e5e7eb" /><line x1={left} y1={top + plotH} x2={left + plotW} y2={top + plotH} stroke="#e5e7eb" />
            {yRange.ymin < 0 ? <line x1={left} y1={mapY(0)} x2={left + plotW} y2={mapY(0)} stroke="#d1d5db" strokeDasharray="4 2" /> : null}
            {graphXTicks.map((tick, i) => { const xv = xMin + tick; const x = mapX(xv); return <g key={i}><line x1={x} y1={top} x2={x} y2={top + plotH} stroke="#f3f4f6" /><text x={x} y={top + plotH + 16} fontSize="10" fill="#6b7280" textAnchor="middle">{fmtHM(xv)}</text></g>; })}
            {(yRange.ymin < 0 ? [yRange.ymin, 0, yRange.ymax] : [yRange.ymin, yRange.ymin + yRange.span / 2, yRange.ymax]).map((v, i) => { const y = mapY(v); return <g key={i}><line x1={left} y1={y} x2={left + plotW} y2={y} stroke="#f3f4f6" /><text x={left - 10} y={y + 4} fontSize="10" fill="#6b7280" textAnchor="end">{formatAxisTick(v)}</text></g>; })}
            {protocolRows.map((row, idx) => { if (!visible.has(idx)) return null; const color = colorFor(row.name); const dash = dashFor(row.name); const d = pathFrom(row.series, row.name, idx); const thick = hoverIdx === idx ? 3 : 2; return <g key={idx} onMouseEnter={() => setHoverIdx(idx)} onMouseLeave={() => setHoverIdx(null)}><path d={d} fill="none" stroke="#fff" strokeOpacity={0.9} strokeWidth={thick + 3} /><path d={d} fill="none" stroke={color} strokeWidth={thick} strokeDasharray={dash} /></g>; })}
            {protocolRows.map((row, idx) => { if (!visible.has(idx)) return null; const color = colorFor(row.name); const offset = nudgePx(idx); return row.phaseStarts.map((px, pi) => { if (px < xMin || px > xMax) return null; const yRaw = yAt(row.series, px); if (yRaw == null) return null; const x = mapX(px); const y = mapY(scaleYByName(row.name, yRaw)) + offset; return <g key={`${idx}-${pi}`} style={{ cursor: "pointer" }} onClick={() => setSelPhase({ gi: idx, pi })}><circle cx={x} cy={y} r={4} fill="#fff" stroke={color} strokeWidth={2} /><text x={x + 6} y={y - 6} fontSize="11" fill={color} stroke="#fff" strokeWidth={3} paintOrder="stroke">{pi + 1}</text></g>; }); })}
            <text x={left + plotW} y={top + plotH + 24} fontSize="11" fill="#6b7280" textAnchor="end">Time (HH:MM)</text>
            <text x={24} y={top + plotH / 2} fontSize="11" fill="#6b7280" textAnchor="middle" transform={`rotate(-90 24 ${top + plotH / 2})`}>{SHARED_AXIS_LABEL}</text>
          </svg>
          {selPhase && (() => {
            const { gi, pi } = selPhase;
            const row = protocolRows[gi];
            const group = protocolParts?.[gi];
            const rawPhase = group?.phases?.[pi] || {};
            const asAny = ensurePhaseShape(rawPhase);
            const type = String(asAny.type || "fixed");
            const startSeconds = row?.phaseStarts?.[pi] ?? 0;
            const endSeconds = row?.phaseStarts?.[pi + 1] ?? row?.xmax ?? startSeconds;
            const details = phaseDetails(asAny);
            return <div className="card" style={{ position: "absolute", right: 12, top: 12, width: 360, background: "white", boxShadow: "0 10px 30px rgba(0,0,0,0.12)", borderRadius: 12, padding: 12, zIndex: 10 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}><div className="label" style={{ margin: 0 }}>Phase {pi + 1}</div><div className="hstack" style={{ gap: 8 }}><button className="btn" onClick={() => setSelPhase(null)}>Close</button></div></div>
              <div className="rule" />
              <div style={{ fontSize: 13, lineHeight: 1.5, display: "grid", gap: 8 }}>
                <div><b>Group:</b> {row?.name}</div>
                <div><b>Type:</b> {type}</div>
                <div><b>Start:</b> {formatDurationPreserveDays(startSeconds)}</div>
                <div><b>End:</b> {formatDurationPreserveDays(endSeconds)}</div>
                <div><b>Duration:</b> {formatDetailValue(asAny.duration)}</div>
                {details.map((detail) => <div key={detail.label}><b>{detail.label}:</b> {detail.value}</div>)}
              </div>
            </div>;
          })()}
        </div>
        <div style={{ marginTop: 10, fontSize: 12, color: "#64748b" }}>{SHARED_AXIS_NOTE}</div>
      </SectionCard>
    );
  }

  return (
    <div style={{ display: "grid", gap: 20 }}>
      {/* Controls */}
      <SectionCard
        title="Experiment Check"
      >
        <div style={{ marginBottom: 16, whiteSpace: "pre-line", fontSize: 13, lineHeight: 1.6, color: "#334155" }}>
          {`Experiment Check is used after an experiment to compare the planned protocol settings with the measured sensor data from the walk-in chamber. Upload the protocol file and the probes.xlsx file, select the chamber and time period, and choose which parameters to display. Faketron then plots the protocol setpoints and measured values in the same graphs, making it easier to verify whether the experiment was carried out as expected.
Use cases
Use this tab to check whether the chamber conditions matched the planned protocol during the experiment. It can help detect unexpected problems, such as humidity drops, temperature deviations or CO₂ fluctuations. This makes it easier to validate the experiment before continuing with later data analysis. Do note that lower-than-expected light levels can be caused by the shade of the gantry on the spectrometer; this has happened in the past.`}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12 }}>
          {/* Room */}
          <label style={{ display: "grid", gap: 6 }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: "#0f172a" }}>Room</span>
            <select
              value={room}
              onChange={(e) => setRoom(e.target.value)}
              style={{ height: 40, padding: "0 12px", border: "1px solid #94a3b8", borderRadius: 10, background: "#f8fafc", color: "#0f172a" }}
            >
              {["G4", "G5", "G6", "G7", "G8"].map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </label>

          {/* Sensor file */}
          <label style={{ display: "grid", gap: 6 }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: "#0f172a" }}>Sensor data (.xlsx)</span>
            <button
              className="btn"
              onClick={onPickSensor}
              style={{ height: 40, textAlign: "left", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
            >
              {sensorFileName || "Upload sensor file…"}
            </button>
          </label>

          {/* Protocol file */}
          <label style={{ display: "grid", gap: 6 }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: "#0f172a" }}>Protocol (.fyt)</span>
            <button
              className="btn"
              onClick={onPickProtocol}
              style={{ height: 40, textAlign: "left", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
            >
              {protocolFileName || "Upload .fyt protocol…"}
            </button>
          </label>

          {/* Calibration — required */}
          <label style={{ display: "grid", gap: 6 }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: "#0f172a" }}>Lamp calibration (.csv)</span>
            <button
              className="btn"
              onClick={onPickCalib}
              style={{ height: 40, textAlign: "left", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
            >
              {calibFileName || "Upload calibration…"}
            </button>
            <span style={{ fontSize: 12, color: "#64748b" }}>
              Download the file for your room from{" "}
              <a
                href="https://drive.google.com/drive/folders/16m5sowew9blQqUsE5MWhW0qihLIMHwJz?usp=sharing"
                target="_blank"
                rel="noreferrer"
                style={{ color: "#1d4ed8", textDecoration: "underline" }}
              >
                Google Drive Folder
              </a>
              , then upload it here.
            </span>
          </label>

          {/* Start datetime */}
          <label style={{ display: "grid", gap: 6 }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: "#0f172a" }}>Experiment start</span>
            <input
              type="date"
              value={startDT}
              onChange={(e) => setStartDT(e.target.value)}
              style={{ height: 40, padding: "0 12px", border: "1px solid #94a3b8", borderRadius: 10, background: "#f8fafc", color: "#0f172a" }}
            />
          </label>

          {/* End datetime */}
          <label style={{ display: "grid", gap: 6 }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: "#0f172a" }}>Experiment end</span>
            <input
              type="date"
              value={endDT}
              onChange={(e) => setEndDT(e.target.value)}
              style={{ height: 40, padding: "0 12px", border: "1px solid #94a3b8", borderRadius: 10, background: "#f8fafc", color: "#0f172a" }}
            />
            <span style={{ fontSize: 12, color: "#64748b" }}>
              Probe files often contain extra days at the end, for example while cleaning out the room. Set this to the real experiment end date.
            </span>
          </label>
        </div>

        <div style={{ marginTop: 20, display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <LeafButton
            onClick={onCompare}
            disabled={!canCompare}
            style={{
              filter: canCompare ? "brightness(1)" : "grayscale(0.6) opacity(0.6)",
              cursor: canCompare ? "pointer" : "not-allowed",
            }}
          >
            <span style={{ color: "#0f172a", fontWeight: 700, fontSize: "0.95rem" }}>
              {loading ? "Loading…" : "Compare"}
            </span>
          </LeafButton>
          {error && <span style={{ color: "#dc2626", fontSize: 13 }}>{error}</span>}
        </div>
      </SectionCard>

      {/* Standard parameter comparison graphs */}
      {renderFirstDayChart()}
      {renderStandardFlexibleChart()}

      {/* Rest / additional sheets */}
      {renderAdditionalChannelsChart()}
      {Boolean(false) && (() => {
        const checkedResults = results;
        if (!checkedResults || checkedResults.restSheets.length === 0) return null;
        const nonNullResults = checkedResults;
        return (
        <SectionCard
          title="Additional Channels"
          subtitle="Optional: select extra sensor sheets to inspect. Sensor data only — no protocol comparison."
        >
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginBottom: 12 }}>
            {nonNullResults.restSheets.map((name) => (
              <label key={name} style={{ display: "inline-flex", gap: 6, alignItems: "center", cursor: "pointer" }}>
                <input type="checkbox" checked={extraSheets.has(name)} onChange={() => toggleExtra(name)} />
                <span>{name}</span>
              </label>
            ))}
          </div>

          {Array.from(extraSheets).map((name) => {
            const ws = nonNullResults.workbook.Sheets[name];
            if (!ws) return null;
            const sensorPts = parseSheetToSeries(ws);
            const chartData = Array.from(
              { length: Math.ceil((nonNullResults.endMs - nonNullResults.startMs) / STEP_MS) + 1 },
              (_, i) => {
                const tMs = nonNullResults.startMs + i * STEP_MS;
                return { xMs: tMs, sensor: avgSensorValue(sensorPts, tMs, MATCH_WINDOW_MS) };
              },
            );
            return (
              <div key={name} style={{ marginTop: 16 }}>
                <div style={{ fontWeight: 600, color: "#0f172a", marginBottom: 4 }}>{name}</div>
                <div style={{ width: "100%", height: 200 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={chartData} margin={{ top: 4, right: 24, left: 40, bottom: 4 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                      <XAxis dataKey="xMs" type="number" scale="time" domain={[nonNullResults.startMs, nonNullResults.endMs]} ticks={xTicks} tickFormatter={fmtAbsTime} tick={{ fontSize: 10 }} />
                      <YAxis tick={{ fontSize: 11 }} />
                      <Tooltip labelFormatter={(v) => fmtAbsTime(Number(v))} formatter={(val: any) => [val == null ? "–" : Number(val).toFixed(2), name]} />
                      <Line dataKey="sensor" name={name} stroke="#0EA5E9" strokeWidth={1.5} dot={false} isAnimationActive={false} connectNulls={true} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>
            );
          })}
        </SectionCard>
        );
      })()}
    </div>
  );
}
