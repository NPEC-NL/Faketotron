import React, { useEffect, useMemo, useRef, useState } from "react";
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

import * as Store from "../state/store";
import { sampleGroup, XY } from "../utils/sampler";
import { formatDurationPreserveDays } from "../utils/time";

const useProto: any = (Store as any).useProto ?? (Store as any).useStore;
const DAY_SECONDS = 24 * 60 * 60;
const HOUR_SECONDS = 60 * 60;
const DAY_WINDOW_STEP_SECONDS = 60;
const HOURLY_AVG_STEP_SECONDS = 5 * 60;
const DIFFERENCE_EPSILON = 0.01;
const SHARED_AXIS_NOTE = "Shared y-axis: CO2 and temperature are divided by 10 so all parameters fit in one overview.";

const has = (s: string | undefined, sub: string) => (s || "").toLowerCase().includes(sub.toLowerCase());

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

function yAt(series: XY[], x: number): number | null {
  if (!series.length) return null;
  let lo = 0;
  let hi = series.length - 1;
  if (x <= series[0].x) return series[0].y;
  if (x >= series[hi].x) return series[hi].y;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (series[mid].x <= x) lo = mid + 1;
    else hi = mid - 1;
  }
  const i = Math.max(1, lo) - 1;
  const a = series[i];
  const b = series[i + 1] || a;
  if (b.x === a.x) return a.y;
  const t = (x - a.x) / (b.x - a.x);
  return a.y + t * (b.y - a.y);
}

function yAtStrict(series: XY[], x: number): number | null {
  if (!series.length) return null;
  if (x < series[0].x || x > series[series.length - 1].x) return null;
  return yAt(series, x);
}

function averageWithin(series: XY[], start: number, end: number, stepSeconds = HOURLY_AVG_STEP_SECONDS): number | null {
  if (!series.length || end <= start) return null;
  let sum = 0;
  let count = 0;
  const halfStep = stepSeconds / 2;
  for (let t = start + halfStep; t < end; t += stepSeconds) {
    const value = yAtStrict(series, t);
    if (value == null) continue;
    sum += value;
    count += 1;
  }
  return count ? sum / count : null;
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

function formatDayRange(startDay: number, endDay: number): string {
  return `${dayLabel(startDay)} to ${dayLabel(endDay)}`;
}

function pickSevenOrFewerDays(startDay: number, endDay: number): number[] {
  if (endDay < startDay) return [startDay];
  const total = endDay - startDay + 1;
  if (total <= 7) return Array.from({ length: total }, (_, idx) => startDay + idx);
  const picked = new Set<number>();
  for (let i = 0; i < 7; i++) {
    const pos = i * ((total - 1) / 6);
    picked.add(startDay + Math.round(pos));
  }
  return Array.from(picked).sort((a, b) => a - b);
}

type Row = { i: number; name: string; unit: string; series: XY[]; phaseStarts: number[]; xmax: number };
type MultiSeriesDaySlice = { dayIndex: number; label: string; valuesBySeriesKey: Record<string, Array<number | null>> };

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
  if (type === "csv-import") {
    return [
      { label: "Points", value: formatDetailValue(shaped.points) },
    ];
  }
  return [];
}

function seriesDifferAcrossDays(days: MultiSeriesDaySlice[], key: string, epsilon = DIFFERENCE_EPSILON): boolean {
  if (days.length <= 1) return true;
  const reference = days[0]?.valuesBySeriesKey[key] ?? [];
  for (let dayIndex = 1; dayIndex < days.length; dayIndex++) {
    const candidate = days[dayIndex]?.valuesBySeriesKey[key] ?? [];
    const count = Math.max(reference.length, candidate.length);
    for (let i = 0; i < count; i++) {
      const a = reference[i];
      const b = candidate[i];
      if (a == null && b == null) continue;
      if (a == null || b == null) return true;
      if (Math.abs(a - b) > epsilon) return true;
    }
  }
  return false;
}

function formatAxisTick(value: number): string {
  if (!Number.isFinite(value)) return "-";
  const abs = Math.abs(value);
  if (abs >= 1000) return Math.round(value).toLocaleString();
  if (abs >= 100) return String(Math.round(value));
  if (abs >= 10) return String(Math.round(value));
  const fixed = value.toFixed(1);
  return fixed.endsWith(".0") ? fixed.slice(0, -2) : fixed;
}

function SectionCard({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div style={{ border: "1px solid #dbe3ea", borderRadius: 12, background: "#ffffff", padding: 16, boxShadow: "0 4px 14px rgba(15, 23, 42, 0.04)" }}>
      <div style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 18, fontWeight: 700, color: "#0f172a" }}>{title}</div>
        {subtitle ? <div style={{ marginTop: 4, fontSize: 13, color: "#64748b" }}>{subtitle}</div> : null}
      </div>
      {children}
    </div>
  );
}

function Consistency3DChart({ rows, days }: { rows: Row[]; days: MultiSeriesDaySlice[] }) {
  const values = days.flatMap((day) =>
    rows.flatMap((row) => (day.valuesBySeriesKey[seriesKey(row.i)] ?? []).filter((value): value is number => value != null)),
  );
  const ymin = values.length ? niceFloor(Math.min(0, ...values)) : 0;
  const ymax = values.length ? niceCeil(Math.max(...values)) : 100;
  const span = Math.max(1, ymax - ymin);
  const vw = 1000;
  const vh = 430;
  const left = 96;
  const right = 120;
  const top = 26;
  const bottom = 64;
  const depthX = 16;
  const depthY = 12;
  const depthCount = Math.max(0, days.length - 1);
  const plotW = vw - left - right - depthCount * depthX;
  const plotH = vh - top - bottom - depthCount * depthY;
  const mapX = (hour: number, depth: number) => left + (hour / 23) * plotW + depth * depthX;
  const mapY = (value: number, depth: number) => top + plotH - ((value - ymin) / span) * plotH - depth * depthY;
  const baseY = (depth: number) => top + plotH - depth * depthY;
  const yTicks = ymin < 0 ? [ymin, 0, ymax] : [ymin, ymin + span / 2, ymax];
  const xTicks = [0, 4, 8, 12, 16, 20, 23];
  function linePath(valuesForDay: Array<number | null>, depth: number): string {
    let d = "";
    valuesForDay.forEach((value, hour) => {
      if (value == null) return;
      const x = mapX(hour, depth);
      const y = mapY(value, depth);
      d += d ? ` L ${x} ${y}` : `M ${x} ${y}`;
    });
    return d;
  }

  return (
    <div style={{ width: "100%", maxWidth: 1240, margin: "0 auto", background: "#fafcfe", border: "1px solid #e2e8f0", borderRadius: 10, overflow: "hidden" }}>
      <svg viewBox={`0 0 ${vw} ${vh}`} preserveAspectRatio="xMidYMid meet" style={{ display: "block", width: "100%", height: "auto" }}>
        {xTicks.map((tick) => <line key={`x-grid-${tick}`} x1={mapX(tick, 0)} y1={top} x2={mapX(tick, 0)} y2={baseY(depthCount)} stroke="#e2e8f0" strokeDasharray="4 4" />)}
        {yTicks.map((tick, idx) => {
          const y = mapY(tick, 0);
          return <g key={`y-grid-${idx}`}><line x1={left} y1={y} x2={left + plotW + depthCount * depthX} y2={y} stroke="#e2e8f0" /><text x={left - 12} y={y + 4} fontSize="11" fill="#64748b" textAnchor="end">{formatAxisTick(tick)}</text></g>;
        })}
        {days.map((day, idx) => {
          const depth = days.length - 1 - idx;
          const strokeOpacity = 0.25 + ((idx + 1) / Math.max(1, days.length)) * 0.45;
          const labelX = left + plotW + depth * depthX + 18;
          const labelY = baseY(depth) - 2;
          return (
            <g key={`day-slice-${day.dayIndex}`}>
              <line x1={left + depth * depthX} y1={baseY(depth)} x2={left + plotW + depth * depthX} y2={baseY(depth)} stroke="#dbe4ee" />
              {rows.map((row) => {
                const rowValues = day.valuesBySeriesKey[seriesKey(row.i)] ?? [];
                const line = linePath(rowValues, depth);
                if (!line) return null;
                const lineColor = colorFor(row.name);
                return (
                  <g key={`${day.dayIndex}-${row.i}`}>
                    <path d={line} fill="none" stroke="#ffffff" strokeOpacity={0.7} strokeWidth={3.5} />
                    <path d={line} fill="none" stroke={lineColor} strokeOpacity={strokeOpacity} strokeWidth={1.8} strokeDasharray={dashFor(row.name)} />
                  </g>
                );
              })}
              <text x={labelX} y={labelY} fontSize="11" fill="#0f172a">{day.label}</text>
            </g>
          );
        })}
        {xTicks.map((tick) => <g key={`x-tick-${tick}`}><line x1={mapX(tick, 0)} y1={baseY(depthCount)} x2={mapX(tick, 0)} y2={baseY(depthCount) + 6} stroke="#94a3b8" /><text x={mapX(tick, 0)} y={baseY(depthCount) + 20} fontSize="11" fill="#64748b" textAnchor="middle">{formatHourLabel(tick)}</text></g>)}
        <text x={left + plotW / 2} y={vh - 14} fontSize="12" fill="#475569" textAnchor="middle">Hour of day (hourly averages)</text>
        <text x={24} y={top + plotH / 2} fontSize="12" fill="#475569" textAnchor="middle" transform={`rotate(-90 24 ${top + plotH / 2})`}>Scaled value</text>
      </svg>
    </div>
  );
}

export default function GraphTab() {
  const protocol = useProto((s: any) => s.protocol);
  const protoRev = useProto((s: any) => s.protoRev ?? 0);
  const [visible, setVisible] = useState<Set<number>>(new Set());
  const [zoom, setZoom] = useState<number>(1);
  const [scroll, setScroll] = useState<number>(0);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const [selPhase, setSelPhase] = useState<{ gi: number; pi: number } | null>(null);
  const [dayIndex, setDayIndex] = useState(0);
  const [consistencyStartDay, setConsistencyStartDay] = useState(0);
  const [consistencyEndDay, setConsistencyEndDay] = useState(6);

  useEffect(() => { console.log("[GraphTab] protoRev =", protoRev); }, [protoRev]);

  const parts = protocol?.sections?.[0]?.parts || [];
  useEffect(() => {
    const all = new Set(parts.map((_: any, i: number) => i));
    setVisible((prev) => {
      const next = new Set<number>();
      all.forEach((i) => { if (prev.has(i)) next.add(i); });
      return next.size ? next : all;
    });
  }, [parts.length, protoRev]);
  useEffect(() => { setSelPhase(null); }, [protoRev]);

  const rows: Row[] = useMemo(() => parts.map((g: any, idx: number) => {
    const out = sampleGroup(g);
    const xmax = out.series.length ? out.series[out.series.length - 1].x : 1;
    const name = (g && (g["group-name"] ?? g.name)) || (Array.isArray(g?.vars) && g.vars.length ? `Group ${idx + 1} (${g.vars[0]})` : `Group ${idx + 1}`);
    const unit = g?.unit || "";
    return { i: idx, name, unit, series: out.series, phaseStarts: out.phaseStarts, xmax };
  }), [parts, protoRev]);

  const globalXMax = Math.max(1, ...rows.map((r) => r.xmax));
  const totalDays = Math.max(1, Math.ceil(globalXMax / DAY_SECONDS));
  const xWindow = globalXMax / Math.max(1, zoom);
  const xMin = Math.min(scroll, 1) * Math.max(0, globalXMax - xWindow);
  const xMax = xMin + xWindow;
  useEffect(() => {
    setDayIndex((prev) => clamp(prev, 0, Math.max(0, totalDays - 1)));
    setConsistencyStartDay((prev) => clamp(prev, 0, Math.max(0, totalDays - 1)));
    setConsistencyEndDay((prev) => clamp(Math.max(prev, 0), 0, Math.max(0, totalDays - 1)));
  }, [totalDays]);
  useEffect(() => { setConsistencyEndDay((prev) => Math.max(prev, consistencyStartDay)); }, [consistencyStartDay]);
  const frozenYRangeRef = useRef<{ ymin: number; ymax: number; span: number } | null>(null);
  useEffect(() => {
    let ymaxScaled = 0;
    let yminScaled = 0;
    rows.forEach((r) => r.series.forEach((p) => {
      const ys = scaleYByName(r.name, p.y);
      if (ys > ymaxScaled) ymaxScaled = ys;
      if (ys < yminScaled) yminScaled = ys;
    }));
    const ymin = niceFloor(yminScaled);
    const ymax = niceCeil(ymaxScaled);
    frozenYRangeRef.current = { ymin, ymax, span: Math.max(1, ymax - ymin) };
  }, [rows]);
  const yRange = frozenYRangeRef.current || { ymin: 0, ymax: 100, span: 100 };
  const vw = 1000;
  const vh = 380;
  const left = 92;
  const right = 24;
  const top = 18;
  const bottom = 46;
  const plotW = vw - left - right;
  const plotH = vh - top - bottom;
  const xTicks = useMemo(() => ticksNice(xWindow), [xWindow]);
  const mapX = (x: number) => left + ((x - xMin) / Math.max(1e-6, xMax - xMin)) * plotW;
  const mapY = (ys: number) => top + (plotH - ((ys - yRange.ymin) / Math.max(1e-6, yRange.span)) * plotH);
  const nudgePx = (idx: number) => ((idx % 3) - 1) * 1.2;

  function toggleVisible(i: number) {
    setVisible((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i); else next.add(i);
      return next.size ? next : new Set(parts.map((_: any, idx: number) => idx));
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

  const [hardKey, setHardKey] = useState(0);
  useEffect(() => {
    const onLoaded = () => setHardKey((k) => k + 1);
    window.addEventListener("protocol:loaded", onLoaded);
    return () => window.removeEventListener("protocol:loaded", onLoaded);
  }, []);

  const rowBySeriesKey = useMemo(() => {
    const map = new Map<string, Row>();
    rows.forEach((row) => map.set(seriesKey(row.i), row));
    return map;
  }, [rows]);
  const dayWindowData = useMemo(() => {
    const absoluteStart = dayIndex * DAY_SECONDS;
    const data: Array<Record<string, number | string | null>> = [];
    for (let offset = 0; offset <= DAY_SECONDS; offset += DAY_WINDOW_STEP_SECONDS) {
      const absolute = absoluteStart + Math.min(offset, DAY_SECONDS);
      const entry: Record<string, number | string | null> = { hour: offset / HOUR_SECONDS, label: fmtHM(offset) };
      rows.forEach((row) => {
        const value = yAtStrict(row.series, absolute);
        entry[seriesKey(row.i)] = value == null ? null : scaleYByName(row.name, value);
      });
      data.push(entry);
    }
    return data;
  }, [rows, dayIndex]);
  const safeConsistencyStart = clamp(consistencyStartDay, 0, Math.max(0, totalDays - 1));
  const safeConsistencyEnd = clamp(Math.max(consistencyEndDay, safeConsistencyStart), safeConsistencyStart, Math.max(0, totalDays - 1));
  const selectedConsistencyDays = useMemo(() => pickSevenOrFewerDays(safeConsistencyStart, safeConsistencyEnd), [safeConsistencyStart, safeConsistencyEnd]);
  const consistencySlices = useMemo(() => {
    return selectedConsistencyDays.map((selectedDay) => ({
      dayIndex: selectedDay,
      label: dayLabel(selectedDay),
      valuesBySeriesKey: Object.fromEntries(
        rows.map((row) => [
          seriesKey(row.i),
          Array.from({ length: 24 }, (_, hour) => {
            const avg = averageWithin(row.series, selectedDay * DAY_SECONDS + hour * HOUR_SECONDS, selectedDay * DAY_SECONDS + (hour + 1) * HOUR_SECONDS);
            return avg == null ? null : scaleYByName(row.name, avg);
          }),
        ]),
      ),
    }));
  }, [rows, selectedConsistencyDays]);
  const differingExperimentalRows = useMemo(() => {
    return rows.filter((row) => seriesDifferAcrossDays(consistencySlices, seriesKey(row.i)));
  }, [rows, consistencySlices]);
  const consistencySummary = useMemo(() => {
    const totalSelected = safeConsistencyEnd - safeConsistencyStart + 1;
    const sampledNote = totalSelected > selectedConsistencyDays.length ? ` Showing ${selectedConsistencyDays.length} sampled days from ${totalSelected} selected days.` : ` Showing ${selectedConsistencyDays.length} day${selectedConsistencyDays.length === 1 ? "" : "s"}.`;
    return `${formatDayRange(safeConsistencyStart, safeConsistencyEnd)}.${sampledNote}`;
  }, [safeConsistencyStart, safeConsistencyEnd, selectedConsistencyDays.length]);

  return (
    <div key={hardKey} style={{ display: "grid", gap: 20 }}>
      <SectionCard title="24-Hour Graph" subtitle={`Single-day view for all parameters. Protocol span: ${formatDurationPreserveDays(globalXMax)} (${totalDays} day${totalDays === 1 ? "" : "s"}).`}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center", marginBottom: 12 }}>
          <button className="btn" onClick={() => setDayIndex((prev) => clamp(prev - 1, 0, totalDays - 1))} disabled={dayIndex === 0}>Previous day</button>
          <button className="btn" onClick={() => setDayIndex((prev) => clamp(prev + 1, 0, totalDays - 1))} disabled={dayIndex >= totalDays - 1}>Next day</button>
          <div style={{ minWidth: 120, fontWeight: 600, color: "#0f172a" }}>{dayLabel(dayIndex)}</div>
          <input type="range" min={0} max={Math.max(0, totalDays - 1)} step={1} value={dayIndex} onChange={(event) => setDayIndex(Number(event.target.value))} style={{ flex: "1 1 320px" }} />
        </div>
        <div style={{ width: "100%", height: 360 }}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={dayWindowData} margin={{ top: 12, right: 24, left: 26, bottom: 12 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="hour" type="number" domain={[0, 24]} ticks={[0, 4, 8, 12, 16, 20, 24]} tickFormatter={formatHourLabel} label={{ value: "Time of day", position: "insideBottom", offset: -6 }} />
              <YAxis width={74} domain={["auto", "auto"]} tick={{ fontSize: 11 }} tickFormatter={(value) => formatAxisTick(Number(value))} label={{ value: "Scaled value", angle: -90, position: "insideLeft", dx: -10 }} />
              <Tooltip labelFormatter={(value) => formatHourLabel(Number(value))} formatter={(value: any, _name: any, item: any) => { const row = rowBySeriesKey.get(String(item?.dataKey ?? "")); const unit = row?.unit ? ` ${row.unit}` : ""; return [value == null ? "-" : `${Number(value).toFixed(2)}${unit}`, row?.name ?? item?.name ?? ""]; }} />
              <Legend />
              {rows.map((row) => <Line key={seriesKey(row.i)} type="monotone" dataKey={seriesKey(row.i)} name={row.name} stroke={colorFor(row.name)} strokeDasharray={dashFor(row.name)} dot={false} strokeWidth={2} connectNulls={false} isAnimationActive={false} />)}
            </LineChart>
          </ResponsiveContainer>
        </div>
        <div style={{ marginTop: 10, fontSize: 12, color: "#64748b" }}>{SHARED_AXIS_NOTE} This graph always shows one 24-hour window. Use the day scroller to move through long experiments such as 40-day schedules.</div>
      </SectionCard>

      <SectionCard title="Experimental Duration Graph" subtitle="Hourly averages across selected days, used as a cross-validation for experimental design so you can check that the full experiment remains correct over time. Only parameters that differ between the chosen days are shown.">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12, marginBottom: 12 }}>
          <label style={{ display: "grid", gap: 6 }}><span style={{ fontSize: 13, fontWeight: 600, color: "#334155" }}>Start day</span><input type="number" min={1} max={totalDays} value={safeConsistencyStart + 1} onChange={(event) => setConsistencyStartDay(clamp(Number(event.target.value || 1) - 1, 0, totalDays - 1))} /></label>
          <label style={{ display: "grid", gap: 6 }}><span style={{ fontSize: 13, fontWeight: 600, color: "#334155" }}>End day</span><input type="number" min={safeConsistencyStart + 1} max={totalDays} value={safeConsistencyEnd + 1} onChange={(event) => setConsistencyEndDay(clamp(Number(event.target.value || safeConsistencyStart + 1) - 1, safeConsistencyStart, totalDays - 1))} /></label>
        </div>
        <div style={{ marginBottom: 10, fontSize: 13, color: "#334155", fontWeight: 600 }}>{consistencySummary}</div>
        <div style={{ marginBottom: 12, fontSize: 12, color: "#64748b" }}>{SHARED_AXIS_NOTE} This graph compares the chosen days hour by hour and hides any parameter that is identical across all shown days, so only drifting or changed patterns remain visible for cross-validation.</div>
        {differingExperimentalRows.length ? <div className="hstack" style={{ gap: 16, flexWrap: "wrap", marginBottom: 10 }}>
          {differingExperimentalRows.map((row) => {
            const color = colorFor(row.name);
            const dash = dashFor(row.name);
            return <span key={`exp-legend-${row.i}`} style={{ display: "inline-flex", gap: 8, alignItems: "center" }}><span style={{ width: 18, height: 0, borderTop: `3px ${dash ? "dashed" : "solid"} ${color}`, display: "inline-block" }} /><span>{row.name}</span></span>;
          })}
        </div> : null}
        {differingExperimentalRows.length ? <Consistency3DChart rows={differingExperimentalRows} days={consistencySlices} /> : <div style={{ padding: 18, border: "1px dashed #cbd5e1", borderRadius: 10, background: "#f8fafc", color: "#475569", fontSize: 13 }}>No parameters differ across the selected days. The sampled days follow the same 24-hour pattern within the comparison resolution of this graph.</div>}
      </SectionCard>

      <SectionCard title="Flexible Graph" subtitle="Full-protocol graph with zoom, scroll, phase markers, and read-only phase inspection.">
        <div className="label" style={{ marginBottom: 8 }}><span><b>Flexible graph controls</b></span></div>
        <div className="hstack" style={{ gap: 16, alignItems: "center", flexWrap: "wrap", marginBottom: 10 }}>
          <div className="hstack" style={{ gap: 8 }}><label>Zoom:</label><input type="range" min={1} max={10} step={1} value={zoom} onChange={(e) => setZoom(parseInt(e.target.value, 10))} /><span className="mono">{zoom}x</span></div>
          <div className="hstack" style={{ gap: 8 }}><label>Scroll:</label><input type="range" min={0} max={1} step={0.01} value={scroll} onChange={(e) => setScroll(parseFloat(e.target.value))} /></div>
          <div className="muted small">Window: {fmtHM(xMin)} -&gt; {fmtHM(xMax)}</div>
        </div>
        <div className="hstack" style={{ gap: 16, flexWrap: "wrap", marginBottom: 10 }}>
          {rows.map((row, idx) => {
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
            {xTicks.map((tick, i) => { const xv = xMin + tick; const x = mapX(xv); return <g key={i}><line x1={x} y1={top} x2={x} y2={top + plotH} stroke="#f3f4f6" /><text x={x} y={top + plotH + 16} fontSize="10" fill="#6b7280" textAnchor="middle">{fmtHM(xv)}</text></g>; })}
            {(yRange.ymin < 0 ? [yRange.ymin, 0, yRange.ymax] : [yRange.ymin, yRange.ymin + yRange.span / 2, yRange.ymax]).map((v, i) => { const y = mapY(v); return <g key={i}><line x1={left} y1={y} x2={left + plotW} y2={y} stroke="#f3f4f6" /><text x={left - 10} y={y + 4} fontSize="10" fill="#6b7280" textAnchor="end">{formatAxisTick(v)}</text></g>; })}
            {rows.map((row, idx) => { if (!visible.has(idx)) return null; const color = colorFor(row.name); const dash = dashFor(row.name); const d = pathFrom(row.series, row.name, idx); const thick = hoverIdx === idx ? 3 : 2; return <g key={idx} onMouseEnter={() => setHoverIdx(idx)} onMouseLeave={() => setHoverIdx(null)}><path d={d} fill="none" stroke="#fff" strokeOpacity={0.9} strokeWidth={thick + 3} /><path d={d} fill="none" stroke={color} strokeWidth={thick} strokeDasharray={dash} /></g>; })}
            {rows.map((row, idx) => { if (!visible.has(idx)) return null; const color = colorFor(row.name); const offset = nudgePx(idx); return row.phaseStarts.map((px, pi) => { if (px < xMin || px > xMax) return null; const yRaw = yAt(row.series, px); if (yRaw == null) return null; const x = mapX(px); const y = mapY(scaleYByName(row.name, yRaw)) + offset; return <g key={`${idx}-${pi}`} style={{ cursor: "pointer" }} onClick={() => setSelPhase({ gi: idx, pi })}><circle cx={x} cy={y} r={4} fill="#fff" stroke={color} strokeWidth={2} /><text x={x + 6} y={y - 6} fontSize="11" fill={color} stroke="#fff" strokeWidth={3} paintOrder="stroke">{pi + 1}</text></g>; }); })}
            <text x={left + plotW} y={top + plotH + 24} fontSize="11" fill="#6b7280" textAnchor="end">Time (HH:MM)</text>
            <text x={24} y={top + plotH / 2} fontSize="11" fill="#6b7280" textAnchor="middle" transform={`rotate(-90 24 ${top + plotH / 2})`}>Scaled value</text>
          </svg>
          {selPhase && (() => {
            const { gi, pi } = selPhase;
            const row = rows[gi];
            const group = parts?.[gi];
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
    </div>
  );
}
