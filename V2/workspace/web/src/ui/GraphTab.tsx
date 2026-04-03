// web/src/ui/GraphTab.tsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import * as Store from "../state/store";
import { sampleGroup, XY } from "../utils/sampler";
import { parseDurationToSeconds, formatDurationPreserveDays } from "../utils/time";

const useProto: any = (Store as any).useProto ?? (Store as any).useStore;

/* ───────────── Helpers ───────────── */

const has = (s: string | undefined, sub: string) =>
  (s || "").toLowerCase().includes(sub.toLowerCase());

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
  if (has(n, "co2") || has(n, "co₂")) return "#9CA3AF";
  if (has(n, "temperature") || has(n, "temp")) return "#F97316";
  if (has(n, "humidity") || has(n, "rh")) return "#22C55E";
  if (has(n, "hydro") || has(n, "water") || has(n, "irrigation")) return "#14B8A6";
  const FALLBACKS = ["#0EA5E9", "#10B981", "#EF4444", "#F59E0B", "#8B5CF6", "#22C55E", "#E11D48", "#7C3AED"];
  let h = 0; for (let i = 0; i < n.length; i++) h = (h * 31 + n.charCodeAt(i)) >>> 0;
  return FALLBACKS[h % FALLBACKS.length];
}
function dashFor(name: string): string | undefined {
  const n = (name || "").toLowerCase();
  if (has(n, "co2") || has(n, "co₂")) return "6 4";
  if (has(n, "temperature") || has(n, "temp")) return "10 6";
  if (has(n, "hydro") || has(n, "irrigation") || has(n, "water")) return "3 3";
  if (has(n, "humidity") || has(n, "rh")) return "8 3 2 3";
  return undefined;
}
function scaleYByName(name: string, y: number): number {
  const n = (name || "").toLowerCase();
  if (has(n, "co2") || has(n, "co₂")) return y / 10;
  if (has(n, "temperature") || has(n, "temp")) return y / 10;
  return y;
}
function yAt(series: XY[], x: number): number | null {
  if (!series.length) return null;
  let lo = 0, hi = series.length - 1;
  if (x <= series[0].x) return series[0].y;
  if (x >= series[hi].x) return series[hi].y;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (series[mid].x <= x) lo = mid + 1; else hi = mid - 1;
  }
  const i = Math.max(1, lo) - 1;
  const a = series[i], b = series[i + 1] || a;
  if (b.x === a.x) return a.y;
  const t = (x - a.x) / (b.x - a.x);
  return a.y + t * (b.y - a.y);
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
  let best = mag, bestN = Math.ceil(maxSpan / mag);
  for (const s of steps) {
    const step = s * mag;
    const n = Math.ceil(maxSpan / step);
    if (Math.abs(n - target) < Math.abs(bestN - target)) {
      best = step; bestN = n;
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
/** Mirror of niceCeil for negative values. Returns 0 when y >= 0. */
function niceFloor(y: number): number {
  if (y >= 0) return 0;
  // Add 15 % breathing room so the line isn’t flush with the axis edge.
  const padded = y * 1.15;
  const abs = Math.abs(padded);
  const mag = Math.pow(10, Math.floor(Math.log10(Math.max(abs, 1e-9))));
  const unit = Math.max(mag / 2, 1);
  return Math.floor(padded / unit) * unit;
}

/* ───────────── Draft overlay & editors ───────────── */

type DraftPatch = Record<string, any>;
const phaseKey = (gi: number, pi: number) => `${gi}:${pi}`;

function defaultsForType(nextType: string, prev: any) {
  const duration = prev?.duration ?? "01:00:00";
  const step     = prev?.step     ?? "00:05:00";
  if (nextType === "fixed") {
    return {
      __keepKeys: ["type", "duration", "value"],
      type: "fixed",
      duration,
      value: prev?.value ?? 0,
    };
  }
  if (nextType === "ramp") {
    return {
      __keepKeys: ["type", "duration", "step", "start", "end"],
      type: "ramp",
      duration,
      step,
      start: prev?.start ?? 0,
      end:   prev?.end   ?? 0,
    };
  }
  if (nextType === "sin") {
    return {
      __keepKeys: ["type", "duration", "step", "min", "max", "period", "phaseOffset"],
      type: "sin",
      duration,
      step,
      min:         prev?.min ?? 0,
      max:         prev?.max ?? 0,
      period:      prev?.period      ?? "01:00:00",
      phaseOffset: prev?.phaseOffset ?? "00:00:00",
    };
  }
  if (nextType === "clouds") {
    return {
      __keepKeys: [
        "type","duration","step",
        "offset","amplitude",
        "cloud_density","cloud_position",
        "cloud_duration_mean","cloud_duration_var",
        "fluctuation_mean_ratio","fluctuation_var",
        "cloud_drop_coeff"
      ],
      type: "clouds",
      duration,
      step,
      offset:  prev?.offset    ?? 0,
      amplitude: prev?.amplitude ?? 0,
      cloud_density: prev?.cloud_density ?? 0,
      cloud_position: prev?.cloud_position ?? 0,
      cloud_duration_mean: prev?.cloud_duration_mean ?? 0,
      cloud_duration_var:  prev?.cloud_duration_var  ?? 0,
      fluctuation_mean_ratio: prev?.fluctuation_mean_ratio ?? 0,
      fluctuation_var: prev?.fluctuation_var ?? 0,
      cloud_drop_coeff: prev?.cloud_drop_coeff ?? 0,
    };
  }
  return defaultsForType("fixed", prev);
}

function applyDrafts(proto: any, draftsMap: Map<string, DraftPatch>) {
  if (!draftsMap.size) return proto;
  const out = typeof structuredClone === "function" ? structuredClone(proto) : JSON.parse(JSON.stringify(proto));
  const parts = out?.sections?.[0]?.parts || [];
  draftsMap.forEach((patch, key) => {
    const [giStr, piStr] = key.split(":");
    const gi = +giStr, pi = +piStr;
    const grp = parts[gi]; if (!grp || !grp.phases || !grp.phases[pi]) return;
    let base = grp.phases[pi];

    if (Array.isArray((patch as any).__keepKeys)) {
      const keep = new Set<string>((patch as any).__keepKeys);
      const trimmed: any = {};
      Object.keys(base).forEach((k) => { if (keep.has(k)) trimmed[k] = base[k]; });
      base = trimmed;
    }
    grp.phases[pi] = { ...base, ...patch };
    delete grp.phases[pi].__keepKeys;
  });
  return out;
}

function normalizeType(t: any): "fixed"|"ramp"|"sin"|"clouds"|"csv-import" {
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
  if (t === "ramp")  return { duration: "01:00:00", step: "00:05:00", start: 0, end: 0, ...base };
  if (t === "sin")   return { duration: "01:00:00", step: "00:05:00", min: 0, max: 0, period: "01:00:00", phaseOffset:"00:00:00", ...base };
  if (t === "clouds")return { duration: "01:00:00", step: "00:05:00", offset:0, amplitude:0,
                               cloud_density:0, cloud_position:0, cloud_duration_mean:0, cloud_duration_var:0,
                               fluctuation_mean_ratio:0, fluctuation_var:0, cloud_drop_coeff:0, ...base };
  if (t === "csv-import") return { points: Array.isArray(raw?.points) ? raw.points : [], ...base };
  return base;
}


/* ───────────── Temperature helpers ───────────── */

/** Returns true when the group represents a temperature channel. */
function isTemperatureGroup(g: any): boolean {
  const name = ((g && (g["group-name"] ?? g.name)) || "").toLowerCase();
  const type = (g?.type || "").toLowerCase();
  const unit = (g?.unit || "").toLowerCase();
  return type === "temperature" || unit === "celsius" || name.includes("temp");
}

/**
 * Returns allowed temperature bounds in raw protocol units (tenths of a degree).
 *
 * G7: −4 °C – 42 °C  (−40 – 420 raw)
 * All other rooms: 4 °C – 42 °C (40 – 420 raw)
 */
function getTempBoundsRaw(room: string): { min: number; max: number } {
  return room === "G7" ? { min: -40, max: 420 } : { min: 40, max: 420 };
}

/* ───────────── Component ───────────── */

type Row = {
  i: number;
  name: string;
  unit: string;
  series: XY[];
  phaseStarts: number[];
  xmax: number;
};

export default function GraphTab() {
  // Store selectors
  const protocol   = useProto((s: any) => s.protocol);
  const protoRev   = useProto((s: any) => s.protoRev ?? 0);
  const setProtocol = useProto((s: any) => s.setProtocol);
  const profile    = useProto((s: any) => s.profile) as string;

  // Local UI state
  const [visible, setVisible] = useState<Set<number>>(new Set());
  const [zoom, setZoom] = useState<number>(1);
  const [scroll, setScroll] = useState<number>(0);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const [selPhase, setSelPhase] = useState<{ gi: number; pi: number } | null>(null);
  const [tempWarning, setTempWarning] = useState<string | null>(null);

  // Local drafts
  const [drafts, setDrafts] = useState<Map<string, DraftPatch>>(new Map());

  useEffect(() => { console.log("[GraphTab] protoRev =", protoRev); }, [protoRev]);

  const parts = protocol?.sections?.[0]?.parts || [];
  useEffect(() => {
    const all = new Set(parts.map((_: any, i: number) => i));
    setVisible(prev => {
      const next = new Set<number>();
      all.forEach(i => { if (prev.has(i)) next.add(i); });
      return next.size ? next : all;
    });
  }, [parts.length, protoRev]);

  useEffect(() => {
    setSelPhase(null);
    setDrafts(new Map());
    setTempWarning(null);
  }, [protoRev]);

  // Clear temperature warning whenever the selected phase changes.
  useEffect(() => {
    setTempWarning(null);
  }, [selPhase]);

  const overlayProtocol = useMemo(() => applyDrafts(protocol, drafts), [protocol, drafts]);
  const overlayParts = overlayProtocol?.sections?.[0]?.parts || [];

  const rows: Row[] = useMemo(() => {
    return overlayParts.map((g: any, idx: number) => {
      const out = sampleGroup(g);
      const xmax = out.series.length ? out.series[out.series.length - 1].x : 1;
      const name: string =
        (g && (g["group-name"] ?? g.name)) ||
        (Array.isArray(g?.vars) && g.vars.length ? `Group ${idx + 1} (${g.vars[0]})` : `Group ${idx + 1}`);
      const unit: string = g?.unit || "";
      return { i: idx, name, unit, series: out.series, phaseStarts: out.phaseStarts, xmax };
    });
  }, [overlayParts, protoRev, drafts]);

  const globalXMax = Math.max(1, ...rows.map(r => r.xmax));
  const xWindow = globalXMax / Math.max(1, zoom);
  const xMin = Math.min(scroll, 1) * Math.max(0, globalXMax - xWindow);
  const xMax = xMin + xWindow;

  const frozenYRangeRef = useRef<{ ymin: number; ymax: number; span: number } | null>(null);
  useEffect(() => {
    let ymaxScaled = 0;
    let yminScaled = 0;
    rows.forEach(r => {
      r.series.forEach(p => {
        const ys = scaleYByName(r.name, p.y);
        if (ys > ymaxScaled) ymaxScaled = ys;
        if (ys < yminScaled) yminScaled = ys;
      });
    });
    const ymin = niceFloor(yminScaled);
    const ymax = niceCeil(ymaxScaled);
    const span = Math.max(1, ymax - ymin);
    frozenYRangeRef.current = { ymin, ymax, span };
  }, [rows]);
  const yRange = frozenYRangeRef.current || { ymin: 0, ymax: 100, span: 100 };

  const VW = 1000, VH = 380;
  const LEFT = 68, RIGHT = 24, TOP = 16, BOT = 36;
  const PLOT_W = VW - LEFT - RIGHT;
  const PLOT_H = VH - TOP - BOT;

  const xTicks = useMemo(() => ticksNice(xWindow), [xWindow]);
  const mapX = (x: number) => LEFT + ((x - xMin) / Math.max(1e-6, xMax - xMin)) * PLOT_W;
  const mapY = (ys: number) => TOP + (PLOT_H - ((ys - yRange.ymin) / Math.max(1e-6, yRange.span)) * PLOT_H);
  const nudgePx = (idx: number) => ((idx % 3) - 1) * 1.2;

  function toggleVisible(i: number) {
    setVisible(prev => {
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
      const X = mapX(Math.min(Math.max(p.x, xMin), xMax));
      const Y = mapY(scaleYByName(name, p.y)) + offset;
      d += (d ? ` L ${X} ${Y}` : `M ${X} ${Y}`);
    }
    return d || `M ${LEFT} ${TOP + PLOT_H} L ${LEFT + PLOT_W} ${TOP + PLOT_H}`;
  }
  function getPhase(gi: number, pi: number) {
    const g = overlayParts?.[gi];
    const phase = g?.phases?.[pi];
    return { group: g, phase };
  }

  const [hardKey, setHardKey] = useState(0);
  useEffect(() => {
    const onLoaded = () => setHardKey(k => k + 1);
    window.addEventListener("protocol:loaded", onLoaded);
    return () => window.removeEventListener("protocol:loaded", onLoaded);
  }, []);

  function saveDraftsToEditor() {
    if (!drafts.size) return;
    const merged = applyDrafts(protocol, drafts);
    console.log("[GraphTab] saving", drafts.size, "draft patch(es) → store + protocol:save-draft");
    setProtocol(merged);
    window.dispatchEvent(new CustomEvent("protocol:save-draft", { detail: { protocol: merged } }));
    setDrafts(new Map());
  }

  // Draft updaters used by the panel
  function draftKV(gi: number, pi: number, key: string, value: any) {
    const k = phaseKey(gi, pi);
    setDrafts(prev => {
      const next = new Map(prev);
      const cur = next.get(k) || {};
      next.set(k, { ...cur, [key]: value });
      return next;
    });
  }
  /** Numeric fields that carry temperature values in fixed/ramp/sin phases. */
  const TEMP_NUMERIC_KEYS = new Set(["value", "start", "end", "min", "max", "offset"]);

  function onNum(gi: number, pi: number, key: string, n: number) {
    if (!Number.isFinite(n)) return;
    draftKV(gi, pi, key, n);
    // Temperature range check
    const g = overlayParts?.[gi];
    if (isTemperatureGroup(g) && TEMP_NUMERIC_KEYS.has(key)) {
      const bounds = getTempBoundsRaw(profile);
      if (n < bounds.min || n > bounds.max) {
        const deg    = (n / 10).toFixed(1);
        const minDeg = (bounds.min / 10).toFixed(0);
        const maxDeg = (bounds.max / 10).toFixed(0);
        setTempWarning(`${deg} °C is outside the allowed range of ${minDeg} °C to ${maxDeg} °C for ${profile}.`);
      } else {
        setTempWarning(null);
      }
    }
  }
  function onTime(gi: number, pi: number, key: string, raw: string) {
    const sec = parseDurationToSeconds(raw);
    draftKV(gi, pi, key, formatDurationPreserveDays(sec));
  }
  function onType(gi: number, pi: number, nextType: string) {
    const g = protocol?.sections?.[0]?.parts?.[gi];
    const prev = g?.phases?.[pi] || {};
    const shaped = defaultsForType(nextType, prev);
    setDrafts((prevMap) => {
      const k = phaseKey(gi, pi);
      const next = new Map(prevMap);
      next.set(k, shaped);
      return next;
    });
  }


function MyButtons({ setDrafts, saveDraftsToEditor }) {
  const [status, setStatus] = useState("");

  const handleDiscard = () => {
    setDrafts(new Map());
    setStatus("discarded");
    setTimeout(() => setStatus(""), 1500);
  };

  const handleSave = () => {
    saveDraftsToEditor();
    setStatus("saved");
    setTimeout(() => setStatus(""), 1500);
  };

  return (
    <div className="hstack" style={{ display: "flex", gap: 15 }}>
      <button
        style={{
          padding: "6px 12px",
          border: "1px solid grey",
          borderRadius: "4px",
          background: "grey",
          color: "white",
          cursor: "pointer",
          fontWeight: 600,
        }}
        onClick={handleDiscard}
        title="Discard all unsaved edits"
      >
        {status === "discarded" ? "Discarded!" : "Discard"}
      </button>

      <button
        style={{
          padding: "6px 12px",
          border: "1px solid lightgreen",
          borderRadius: "4px",
          background: "lightgreen",
          color: "black",
          cursor: "pointer",
          fontWeight: 600,
        }}
        onClick={handleSave}
        title="Apply to Editor + Legacy"
      >
        {status === "saved" ? "Saved!" : "Save to Editor"}
      </button>
    </div>
  );
}


  return (
    <div className="card" style={{ overflow: "visible" }} key={hardKey}>
      <div className="label" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span><b>Graph Controls:</b></span>
        <MyButtons setDrafts={setDrafts} saveDraftsToEditor={saveDraftsToEditor} />
      </div>

      {/* Controls */}
      <div className="hstack" style={{ gap: 16, alignItems: "center", flexWrap: "wrap", marginBottom: 6 }}>
        <div className="hstack" style={{ gap: 8 }}>
          <label>Zoom:</label>
          <input type="range" min={1} max={10} step={1} value={zoom} onChange={(e) => setZoom(parseInt(e.target.value, 10))} />
          <span className="mono">{zoom}×</span>
        </div>
        <div className="hstack" style={{ gap: 8 }}>
          <label>Scroll:</label>
          <input type="range" min={0} max={1} step={0.01} value={scroll} onChange={(e) => setScroll(parseFloat(e.target.value))} />
        </div>
        <div className="muted small">Window: {fmtHM(xMin)} → {fmtHM(xMax)}</div>
      </div>

      {/* Legend */}
      <div className="hstack" style={{ gap: 16, flexWrap: "wrap", marginBottom: 8 }}>
        {rows.map((r, idx) => {
          const color = colorFor(r.name);
          const on = visible.has(idx);
          const dash = dashFor(r.name);
          return (
            <label key={idx} style={{ display: "inline-flex", gap: 8, alignItems: "center", cursor: "pointer" }}>
              <input type="checkbox" checked={on} onChange={() => toggleVisible(idx)} />
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                <span style={{ width: 18, height: 0, borderTop: `3px ${dash ? "dashed" : "solid"} ${color}`, display: "inline-block" }} />
                <span>{r.name}</span>
              </span>
            </label>
          );
        })}
      </div>

      {/* Plot */}
      <div
        style={{
          width: "100%",
          height: "100%",
          background: "#fafafa",
          border: "1px solid #eee",
          borderRadius: 8,
          padding: 8,
          boxSizing: "border-box",
          overflow: "visible",
          position: "relative",
        }}
      >
        <svg viewBox="0 0 1000 380" width="100%" height="100%" preserveAspectRatio="none" style={{ display: "block" }}>
          {/* Axes */}
          <line x1={LEFT} y1={TOP} x2={LEFT} y2={TOP + PLOT_H} stroke="#e5e7eb" />
          <line x1={LEFT} y1={TOP + PLOT_H} x2={LEFT + PLOT_W} y2={TOP + PLOT_H} stroke="#e5e7eb" />
          {/* Zero baseline (only visible when ymin < 0) */}
          {yRange.ymin < 0 && (
            <line x1={LEFT} y1={mapY(0)} x2={LEFT + PLOT_W} y2={mapY(0)} stroke="#d1d5db" strokeDasharray="4 2" />
          )}

          {/* X ticks */}
          {xTicks.map((t, i) => {
            const xv = xMin + t;
            const x = mapX(xv);
            return (
              <g key={i}>
                <line x1={x} y1={TOP} x2={x} y2={TOP + PLOT_H} stroke="#f3f4f6" />
                <text x={x} y={TOP + PLOT_H + 16} fontSize="10" fill="#6b7280" textAnchor="middle">
                  {fmtHM(xv)}
                </text>
              </g>
            );
          })}

          {/* Y ticks */}
          {(yRange.ymin < 0
            ? [yRange.ymin, 0, yRange.ymax]          // negative range: min / zero / max
            : [yRange.ymin, yRange.ymin + yRange.span / 2, yRange.ymax] // normal: min / mid / max
          ).map((v, i) => {
            const y = mapY(v);
            return (
              <g key={i}>
                <line x1={LEFT} y1={y} x2={LEFT + PLOT_W} y2={y} stroke="#f3f4f6" />
                <text x={LEFT - 8} y={y + 4} fontSize="10" fill="#6b7280" textAnchor="end">
                  {Math.round(v)}
                </text>
              </g>
            );
          })}

          {/* Series */}
          {rows.map((r, idx) => {
            if (!visible.has(idx)) return null;
            const color = colorFor(r.name);
            const dash = dashFor(r.name);
            const d = pathFrom(r.series, r.name, idx);
            const thick = hoverIdx === idx ? 3 : 2;
            return (
              <g key={idx} onMouseEnter={() => setHoverIdx(idx)} onMouseLeave={() => setHoverIdx(null)}>
                <path d={d} fill="none" stroke="#fff" strokeOpacity={0.9} strokeWidth={thick + 3} />
                <path d={d} fill="none" stroke={color} strokeWidth={thick} strokeDasharray={dash} />
              </g>
            );
          })}

          {/* Phase markers (clickable) */}
          {rows.map((r, idx) => {
            if (!visible.has(idx)) return null;
            const color = colorFor(r.name);
            const offset = nudgePx(idx);
            return r.phaseStarts.map((px, pi) => {
              if (px < xMin || px > xMax) return null;
              const yRaw = yAt(r.series, px);
              if (yRaw == null) return null;
              const ys = scaleYByName(r.name, yRaw);
              const X = mapX(px);
              const Y = mapY(ys) + offset;
              return (
                <g key={`${idx}-${pi}`} style={{ cursor: "pointer" }} onClick={() => setSelPhase({ gi: idx, pi })}>
                  <circle cx={X} cy={Y} r={4} fill="#fff" stroke={color} strokeWidth={2} />
                  <text x={X + 6} y={Y - 6} fontSize="11" fill={color} stroke="#fff" strokeWidth={3} paintOrder="stroke">
                    {pi + 1}
                  </text>
                </g>
              );
            });
          })}

          {/* Axis labels */}
          <text x={LEFT + PLOT_W} y={TOP + PLOT_H + 24} fontSize="11" fill="#6b7280" textAnchor="end">
            Time (HH:MM)
          </text>
          <text x={LEFT + 2} y={TOP + 12} fontSize="11" fill="#6b7280">
            Value (CO₂ & Temp ÷ 10)
          </text>
        </svg>

        {/* Phase panel (editable, writes back to editor) */}
        {selPhase && (() => {
          const { gi, pi } = selPhase;
          const row = rows[gi];
          const starts = row?.phaseStarts || [];
          const startSec = starts[pi] ?? 0;
          const endSec = starts[pi + 1] ?? row?.xmax ?? startSec;

          const rawPhase = overlayParts?.[gi]?.phases?.[pi] || {};
          const asAny = ensurePhaseShape(rawPhase);        // normalize
          const type  = asAny.type as string;


          const Input = (props: React.InputHTMLAttributes<HTMLInputElement>) => (
            <input {...props} className="input" style={{ width: "100%" }} />
          );

          return (
            <div
              className="card"
              style={{
                position: "absolute",
                right: 12,
                top: 12,
                width: 360,
                background: "white",
                boxShadow: "0 10px 30px rgba(0,0,0,0.12)",
                borderRadius: 12,
                padding: 12,
                zIndex: 10
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div className="label" style={{ margin: 0 }}>Phase {pi + 1}</div>
                <div className="hstack" style={{ gap: 8 }}>
                  <button className="btn" onClick={() => setSelPhase(null)}>Close</button>
                </div>
              </div>
              <div className="rule" />

              {tempWarning && (
                <div style={{
                  background: "#fef3c7",
                  border: "1px solid #f59e0b",
                  borderRadius: 6,
                  padding: "8px 10px",
                  fontSize: 12,
                  color: "#92400e",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "flex-start",
                  gap: 8,
                  marginBottom: 4,
                }}>
                  <span>⚠️ {tempWarning}</span>
                  <button
                    onClick={() => setTempWarning(null)}
                    style={{ background: "none", border: "none", cursor: "pointer", fontSize: 14, lineHeight: 1, padding: 0, color: "#92400e", flexShrink: 0 }}
                    title="Dismiss"
                  >×</button>
                </div>
              )}

              <div style={{ fontSize: 13, lineHeight: 1.5, display: "grid", gap: 8 }}>
                <div><b>Group:</b> {row?.name}</div>

                {/* Type */}
                <label className="hstack" style={{ gap: 8 }}>
                  <span style={{ width: 110 }}>Type</span>
                  <select
                    value={type}
                    onChange={(e) => onType(gi, pi, e.target.value)}
                    style={{ flex: 1 }}
                  >
                    <option value="fixed">fixed</option>
                    <option value="ramp">ramp</option>
                    <option value="sin">sin</option>
                    <option value="clouds">clouds</option>
                  </select>
                </label>

                {/* Duration */}
                <label className="hstack" style={{ gap: 8 }}>
                  <span style={{ width: 110 }}>Duration</span>
                  <Input
                    placeholder="D.HH:MM:SS"
                    value={asAny.duration ?? ""}
                    onChange={(e) => onTime(gi, pi, "duration", e.target.value)}
                  />
                </label>

                {/* step if present */}
                {"step" in asAny && (
                  <label className="hstack" style={{ gap: 8 }}>
                    <span style={{ width: 110 }}>Step</span>
                    <Input
                      placeholder="D.HH:MM:SS"
                      value={asAny.step ?? ""}
                      onChange={(e) => onTime(gi, pi, "step", e.target.value)}
                    />
                  </label>
                )}

                {/* Type-specific fields */}
                {type === "fixed" && (
                  <label className="hstack" style={{ gap: 8 }}>
                    <span style={{ width: 110 }}>Value</span>
                    <Input
                      type="number"
                      value={asAny.value ?? 0}
                      onChange={(e) => onNum(gi, pi, "value", Number(e.target.value))}
                    />
                  </label>
                )}

                {type === "ramp" && (
                  <>
                    <label className="hstack" style={{ gap: 8 }}>
                      <span style={{ width: 110 }}>Start</span>
                      <Input
                        type="number"
                        value={asAny.start ?? 0}
                        onChange={(e) => onNum(gi, pi, "start", Number(e.target.value))}
                      />
                    </label>
                    <label className="hstack" style={{ gap: 8 }}>
                      <span style={{ width: 110 }}>End</span>
                      <Input
                        type="number"
                        value={asAny.end ?? 0}
                        onChange={(e) => onNum(gi, pi, "end", Number(e.target.value))}
                      />
                    </label>
                  </>
                )}

                {type === "sin" && (
                  <>
                    <label className="hstack" style={{ gap: 8 }}>
                      <span style={{ width: 110 }}>Min</span>
                      <Input
                        type="number"
                        value={asAny.min ?? 0}
                        onChange={(e) => onNum(gi, pi, "min", Number(e.target.value))}
                      />
                    </label>
                    <label className="hstack" style={{ gap: 8 }}>
                      <span style={{ width: 110 }}>Max</span>
                      <Input
                        type="number"
                        value={asAny.max ?? 0}
                        onChange={(e) => onNum(gi, pi, "max", Number(e.target.value))}
                      />
                    </label>
                    <label className="hstack" style={{ gap: 8 }}>
                      <span style={{ width: 110 }}>Period</span>
                      <Input
                        placeholder="D.HH:MM:SS"
                        value={asAny.period ?? ""}
                        onChange={(e) => onTime(gi, pi, "period", e.target.value)}
                      />
                    </label>
                    <label className="hstack" style={{ gap: 8 }}>
                      <span style={{ width: 110 }}>Phase Offset</span>
                      <Input
                        placeholder="D.HH:MM:SS"
                        value={asAny.phaseOffset ?? ""}
                        onChange={(e) => onTime(gi, pi, "phaseOffset", e.target.value)}
                      />
                    </label>
                  </>
                )}

                {type === "clouds" && (
                  <>
                    <label className="hstack" style={{ gap: 8 }}>
                      <span style={{ width: 110 }}>Offset</span>
                      <Input
                        type="number"
                        value={asAny.offset ?? 0}
                        onChange={(e) => onNum(gi, pi, "offset", Number(e.target.value))}
                      />
                    </label>
                    <label className="hstack" style={{ gap: 8 }}>
                      <span style={{ width: 110 }}>Amplitude</span>
                      <Input
                        type="number"
                        value={asAny.amplitude ?? 0}
                        onChange={(e) => onNum(gi, pi, "amplitude", Number(e.target.value))}
                      />
                    </label>
                    <label className="hstack" style={{ gap: 8 }}>
                      <span style={{ width: 110 }}>Density</span>
                      <Input
                        type="number"
                        value={asAny.cloud_density ?? 0}
                        onChange={(e) => onNum(gi, pi, "cloud_density", Number(e.target.value))}
                      />
                    </label>
                    <label className="hstack" style={{ gap: 8 }}>
                      <span style={{ width: 110 }}>Position</span>
                      <Input
                        type="number"
                        value={asAny.cloud_position ?? 0}
                        onChange={(e) => onNum(gi, pi, "cloud_position", Number(e.target.value))}
                      />
                    </label>
                    <label className="hstack" style={{ gap: 8 }}>
                      <span style={{ width: 110 }}>Cloud μ (min)</span>
                      <Input
                        type="number"
                        value={asAny.cloud_duration_mean ?? 0}
                        onChange={(e) => onNum(gi, pi, "cloud_duration_mean", Number(e.target.value))}
                      />
                    </label>
                    <label className="hstack" style={{ gap: 8 }}>
                      <span style={{ width: 110 }}>Cloud σ</span>
                      <Input
                        type="number"
                        value={asAny.cloud_duration_var ?? 0}
                        onChange={(e) => onNum(gi, pi, "cloud_duration_var", Number(e.target.value))}
                      />
                    </label>
                    <label className="hstack" style={{ gap: 8 }}>
                      <span style={{ width: 110 }}>Fluct. μ</span>
                      <Input
                        type="number"
                        value={asAny.fluctuation_mean_ratio ?? 0}
                        onChange={(e) => onNum(gi, pi, "fluctuation_mean_ratio", Number(e.target.value))}
                      />
                    </label>
                    <label className="hstack" style={{ gap: 8 }}>
                      <span style={{ width: 110 }}>Fluct. σ</span>
                      <Input
                        type="number"
                        value={asAny.fluctuation_var ?? 0}
                        onChange={(e) => onNum(gi, pi, "fluctuation_var", Number(e.target.value))}
                      />
                    </label>
                    <label className="hstack" style={{ gap: 8 }}>
                      <span style={{ width: 110 }}>Drop coeff</span>
                      <Input
                        type="number"
                        value={asAny.cloud_drop_coeff ?? 0}
                        onChange={(e) => onNum(gi, pi, "cloud_drop_coeff", Number(e.target.value))}
                      />
                    </label>
                  </>
                )}

                <div className="muted small">
                  Temperature is checked here (4–42 °C; G7 allows −4–42 °C).
                </div>
              </div>
            </div>
          );
        })()}
      </div>
    </div>
  );
}
