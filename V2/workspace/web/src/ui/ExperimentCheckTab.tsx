import React, { useState } from "react";
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
import { decodeFYT } from "faketotron-v2-core";
import { LeafButton } from "../LeafButton";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type SensorPoint = { ts: number; value: number };
type ChartRow = { xMs: number; protocol: number | null; sensor: number | null };

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
  startMs: number;
  endMs: number;
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STEP_MS = 5 * 60 * 1000; // 5-minute chart resolution
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

/** ms → "DD/MM HH:MM" for chart axis labels. */
function fmtAbsTime(ms: number): string {
  const d = new Date(ms);
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const mo = String(d.getUTCMonth() + 1).padStart(2, "0");
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${dd}/${mo} ${hh}:${mm}`;
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

function has(s: string, sub: string): boolean {
  return s.toLowerCase().includes(sub.toLowerCase());
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
            setStartDT(msToLocalInput(pts[0].ts));
            setEndDT(msToLocalInput(pts[pts.length - 1].ts));
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
      const f = await pickFile(".json,.fyt,application/json,application/octet-stream");
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
    const startMs = dtLocalToMs(startDT);
    const endMs   = dtLocalToMs(endDT);
    if (endMs <= startMs) { setError("End datetime must be after start."); return; }

    setLoading(true);
    try {
      // --- Parse protocol ---
      let protocol: any;
      if (protocolFileRef.name.toLowerCase().endsWith(".json")) {
        protocol = canonicalizeProtocol(JSON.parse(await protocolFileRef.text()));
      } else {
        const bytes = new Uint8Array(await protocolFileRef.arrayBuffer());
        try {
          const dec: any = decodeFYT(bytes);
          protocol = canonicalizeProtocol(dec.protocol ?? dec);
        } catch {
          const txt = new TextDecoder().decode(bytes);
          protocol = canonicalizeProtocol(JSON.parse(txt.slice(0, Math.max(0, txt.lastIndexOf("}") + 1))));
        }
      }

      const parts: any[] = protocol?.sections?.[0]?.parts ?? [];
      const protocolRepeat = Math.max(1, Number(protocol?.repeat ?? 1));

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

      setResults({ standard, restSheets: restSheetNames, workbook: wb, startMs, endMs });
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

  const canCompare = !loading && !!sensorFileRef && !!protocolFileRef && !!calibFileRef && !!startDT && !!endDT;
  const xTicks = results ? generateXTicks(results.startMs, results.endMs) : [];

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

  return (
    <div style={{ display: "grid", gap: 20 }}>
      {/* Controls */}
      <SectionCard
        title="Experiment Check"
        subtitle="Upload sensor data, protocol, and lamp calibration. Start and end times are auto-filled from the sensor file and can be adjusted."
      >
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
            <span style={{ fontSize: 13, fontWeight: 700, color: "#0f172a" }}>Protocol (.json / .fyt)</span>
            <button
              className="btn"
              onClick={onPickProtocol}
              style={{ height: 40, textAlign: "left", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
            >
              {protocolFileName || "Upload protocol…"}
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
              type="datetime-local"
              value={startDT}
              onChange={(e) => setStartDT(e.target.value)}
              style={{ height: 40, padding: "0 12px", border: "1px solid #94a3b8", borderRadius: 10, background: "#f8fafc", color: "#0f172a" }}
            />
          </label>

          {/* End datetime */}
          <label style={{ display: "grid", gap: 6 }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: "#0f172a" }}>Experiment end</span>
            <input
              type="datetime-local"
              value={endDT}
              onChange={(e) => setEndDT(e.target.value)}
              style={{ height: 40, padding: "0 12px", border: "1px solid #94a3b8", borderRadius: 10, background: "#f8fafc", color: "#0f172a" }}
            />
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

      {/* Standard parameter charts */}
      {results && results.standard.map((p) => renderParamChart(p))}

      {/* Rest / additional sheets */}
      {results && results.restSheets.length > 0 && (
        <SectionCard
          title="Additional Channels"
          subtitle="Optional: select extra sensor sheets to inspect. Sensor data only — no protocol comparison."
        >
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginBottom: 12 }}>
            {results.restSheets.map((name) => (
              <label key={name} style={{ display: "inline-flex", gap: 6, alignItems: "center", cursor: "pointer" }}>
                <input type="checkbox" checked={extraSheets.has(name)} onChange={() => toggleExtra(name)} />
                <span>{name}</span>
              </label>
            ))}
          </div>

          {Array.from(extraSheets).map((name) => {
            const ws = results.workbook.Sheets[name];
            if (!ws) return null;
            const sensorPts = parseSheetToSeries(ws);
            const chartData = Array.from(
              { length: Math.ceil((results.endMs - results.startMs) / STEP_MS) + 1 },
              (_, i) => {
                const tMs = results.startMs + i * STEP_MS;
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
                      <XAxis dataKey="xMs" type="number" scale="time" domain={[results.startMs, results.endMs]} ticks={xTicks} tickFormatter={fmtAbsTime} tick={{ fontSize: 10 }} />
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
      )}
    </div>
  );
}
