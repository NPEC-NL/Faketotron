import React, { useEffect, useMemo, useRef, useState } from "react";
import * as Store from "../state/store";
const useProto: any = (Store as any).useProto ?? (Store as any).useStore;
import { sampleGroup, XY } from "../utils/sampler";

/* ───────────── Helpers ───────────── */

const has = (s: string | undefined, sub: string) =>
  (s || "").toLowerCase().includes(sub.toLowerCase());

// Color mapping by group name
function colorFor(name: string): string {
  const n = (name || "").toLowerCase();
  if (has(n, "cool white") || has(n, "cool-white")) return "#3BA7FF";    // cold blue
  if (has(n, "warm white") || has(n, "warm-white")) return "#FFB84D";    // amber
  if (has(n, "daylight")) return "#7DB3FF";
  if (has(n, "far") && has(n, "red")) return "#B00020";
  if (has(n, "red")) return "#E11D48";
  if (has(n, "blue")) return "#2563EB";
  if (has(n, "uv")) return "#7C3AED";
  if (has(n, "co2") || has(n, "co₂")) return "#9CA3AF";                  // grey
  if (has(n, "temperature") || has(n, "temp")) return "#F97316";         // orange
  if (has(n, "humidity") || has(n, "rh")) return "#22C55E";              // green
  if (has(n, "hydro") || has(n, "water") || has(n, "irrigation")) return "#14B8A6"; // aqua
  const FALLBACKS = ["#0EA5E9", "#10B981", "#EF4444", "#F59E0B", "#8B5CF6", "#22C55E", "#E11D48", "#7C3AED"];
  let h = 0; for (let i = 0; i < n.length; i++) h = (h * 31 + n.charCodeAt(i)) >>> 0;
  return FALLBACKS[h % FALLBACKS.length];
}

// Optional dash styles
function dashFor(name: string): string | undefined {
  const n = (name || "").toLowerCase();
  if (has(n, "co2") || has(n, "co₂")) return "6 4";
  if (has(n, "hydro") || has(n, "irrigation") || has(n, "water")) return "3 3";
  if (has(n, "humidity") || has(n, "rh")) return "8 3 2 3";
  return undefined; // solid
}

// Scale rule: CO₂ & Temperature stored ×10 → plot ÷10
function scaleYByName(name: string, y: number): number {
  const n = (name || "").toLowerCase();
  if (has(n, "co2") || has(n, "co₂")) return y / 10;
  if (has(n, "temperature") || has(n, "temp")) return y / 10;
  return y;
}

// y at x along series (linear interpolation)
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

// seconds -> "HH:MM"
function fmtHM(sec: number): string {
  const m = Math.max(0, Math.floor(sec / 60));
  const hh = Math.floor(m / 60);
  const mm = m % 60;
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

// ticks for a span (seconds), ~6 ticks
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

// round up to a “nice” Y upper bound (0..100 unless exceeded)
function niceCeil(y: number): number {
  if (y <= 100) return 100;
  const mag = Math.pow(10, Math.floor(Math.log10(y)));
  const unit = mag / 2;
  return Math.ceil(y / unit) * unit;
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
  const protocol = useProto((s: any) => s.protocol);
  const protoRev  = useProto((s: any) => s.protoRev ?? 0);

  // DEV sanity: confirm we see bumps
  useEffect(() => { console.log("[GraphTab] protoRev =", protoRev); }, [protoRev]);

  const parts = protocol?.sections?.[0]?.parts || [];

  // Legend visibility
  const [visible, setVisible] = useState<Set<number>>(
    () => new Set(parts.map((_, i) => i))
  );
  // X zoom & pan
  const [zoom, setZoom] = useState<number>(1);     // 1x..10x
  const [scroll, setScroll] = useState<number>(0); // 0..1
  // Hover/selection
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const [selPhase, setSelPhase] = useState<{ gi: number; pi: number } | null>(null);

  // Keep legend stable when groups change
  useEffect(() => {
    const all = new Set(parts.map((_: any, i: number) => i));
    setVisible((prev) => {
      const next = new Set<number>();
      all.forEach(i => { if (prev.has(i)) next.add(i); });
      return next.size ? next : all;
    });
  }, [parts.length, protoRev]);

  // Clear selected phase on protocol change
  useEffect(() => { setSelPhase(null); }, [protoRev]);

  // Build rows (re-sample) whenever protocol changes
  const rows: Row[] = useMemo(() => {
    return parts.map((g: any, idx: number) => {
      const out = sampleGroup(g);
      const xmax = out.series.length ? out.series[out.series.length - 1].x : 1;
      const name: string =
        (g && (g["group-name"] ?? g.name)) ||
        (Array.isArray(g?.vars) && g.vars.length ? `Group ${idx + 1} (${g.vars[0]})` : `Group ${idx + 1}`);
      const unit: string = g?.unit || "";
      return { i: idx, name, unit, series: out.series, phaseStarts: out.phaseStarts, xmax };
    });
  }, [protoRev, parts.length]);

  const globalXMax = Math.max(1, ...rows.map(r => r.xmax));

  // X window from zoom & scroll
  const xWindow = globalXMax / Math.max(1, zoom);
  const xMin = Math.min(scroll, 1) * Math.max(0, globalXMax - xWindow);
  const xMax = xMin + xWindow;

  // Frozen Y range (0..100 unless exceeded)
  const frozenYRangeRef = useRef<{ ymin: number; ymax: number; span: number } | null>(null);
  useEffect(() => {
    let ymaxScaled = 0;
    rows.forEach(r => {
      r.series.forEach(p => {
        const ys = scaleYByName(r.name, p.y);
        if (ys > ymaxScaled) ymaxScaled = ys;
      });
    });
    const ymin = 0;
    const ymax = niceCeil(ymaxScaled);
    const span = Math.max(1, ymax - ymin);
    frozenYRangeRef.current = { ymin, ymax, span };
  }, [protoRev, rows]);

  const yRange = frozenYRangeRef.current || { ymin: 0, ymax: 100, span: 100 };

  // SVG virtual size (responsive via viewBox)
  const VW = 1000;
  const VH = 380;
  // inner padding / plot rect
  const LEFT = 68, RIGHT = 24, TOP = 16, BOT = 36;
  const PLOT_W = VW - LEFT - RIGHT;
  const PLOT_H = VH - TOP - BOT;

  const xTicks = useMemo(() => ticksNice(xWindow), [xWindow]);

  const mapX = (x: number) => LEFT + ((x - xMin) / Math.max(1e-6, xMax - xMin)) * PLOT_W;
  const mapY = (ys: number) => TOP + (PLOT_H - ((ys - yRange.ymin) / Math.max(1e-6, yRange.span)) * PLOT_H);

  function toggleVisible(i: number) {
    setVisible(prev => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i); else next.add(i);
      return next.size ? next : new Set(parts.map((_: any, idx: number) => idx));
    });
  }

  // Small screen-space nudge per series to reduce perfect occlusion
  const nudgePx = (idx: number) => ((idx % 3) - 1) * 1.2; // -1.2, 0, +1.2 px pattern

  function pathFrom(points: XY[], name: string, idx: number): string {
    let d = "";
    const offset = nudgePx(idx);
    for (let i = 0; i < points.length; i++) {
      const p = points[i];
      if (p.x < xMin && (points[i + 1]?.x ?? p.x) < xMin) continue;
      if (p.x > xMax && (points[i - 1]?.x ?? p.x) > xMax) break;
      const X = mapX(Math.min(Math.max(p.x, xMin), xMax));
      const Y = mapY(scaleYByName(name, p.y)) + offset; // screen-space nudge
      d += (d ? ` L ${X} ${Y}` : `M ${X} ${Y}`);
    }
    return d || `M ${LEFT} ${TOP + PLOT_H} L ${LEFT + PLOT_W} ${TOP + PLOT_H}`;
  }

  function getPhase(gi: number, pi: number) {
    const g = protocol?.sections?.[0]?.parts?.[gi];
    const phase = g?.phases?.[pi];
    return { group: g, phase };
  }

  const [hardKey, setHardKey] = useState(0);

  useEffect(() => {
    const onLoaded = () => setHardKey(k => k + 1);
    window.addEventListener("protocol:loaded", onLoaded);
    return () => window.removeEventListener("protocol:loaded", onLoaded);
  }, []);


  return (
    <div className="card" style={{ overflow: "visible" }} key={hardKey}>
      <div className="label">Graph</div>

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
        <div className="muted small">
          Window: {fmtHM(xMin)} → {fmtHM(xMax)}
        </div>
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
                <span
                  style={{
                    width: 18,
                    height: 0,
                    borderTop: `3px ${dash ? "dashed" : "solid"} ${color}`,
                    display: "inline-block"
                  }}
                />
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
        <svg
          viewBox={`0 0 1000 380`}
          width="90%"
          height="90%"
          preserveAspectRatio="none"
          style={{ display: "block" }}
        >
          {/* Axes */}
          <line x1={LEFT} y1={TOP} x2={LEFT} y2={TOP + PLOT_H} stroke="#e5e7eb" />
          <line x1={LEFT} y1={TOP + PLOT_H} x2={LEFT + PLOT_W} y2={TOP + PLOT_H} stroke="#e5e7eb" />

          {/* X ticks (HH:MM) */}
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

          {/* Y ticks: 0, 50, max (frozen) */}
          {[yRange.ymin, yRange.ymin + yRange.span / 2, yRange.ymax].map((v, i) => {
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

          {/* Lines (halo + colored stroke, dash, hover thickness) */}
          {rows.map((r, idx) => {
            const on = visible.has(idx);
            if (!on) return null;
            const color = colorFor(r.name);
            const dash = dashFor(r.name);
            const pathD = pathFrom(r.series, r.name, idx);
            const thick = hoverIdx === idx ? 3 : 2;
            return (
              <g key={idx}
                 onMouseEnter={() => setHoverIdx(idx)}
                 onMouseLeave={() => setHoverIdx(null)}>
                {/* Halo underlay */}
                <path d={pathD} fill="none" stroke="#fff" strokeOpacity={0.9} strokeWidth={thick + 3}/>
                {/* Actual colored line */}
                <path d={pathD} fill="none" stroke={color} strokeWidth={thick} strokeDasharray={dash}/>
              </g>
            );
          })}

          {/* Phase markers on the line with numbers (clickable) */}
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

        {/* Phase panel (read-only for now) */}
        {selPhase && (() => {
          const { gi, pi } = selPhase;
          const row = rows[gi];
          const starts = row?.phaseStarts || [];
          const startSec = starts[pi] ?? 0;
          const endSec = starts[pi + 1] ?? row?.xmax ?? startSec;
          const { phase } = getPhase(gi, pi);
          const type = phase?.type ?? "fixed";
          return (
            <div
              className="card"
              style={{
                position: "absolute",
                right: 12,
                top: 12,
                width: 320,
                background: "white",
                boxShadow: "0 10px 30px rgba(0,0,0,0.12)",
                borderRadius: 12,
                padding: 12,
                zIndex: 10
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div className="label" style={{ margin: 0 }}>Phase {pi + 1}</div>
                <button className="btn" onClick={() => setSelPhase(null)}>Close</button>
              </div>
              <div className="rule" />
              <div style={{ fontSize: 13, lineHeight: 1.5 }}>
                <div><b>Group:</b> {row?.name}</div>
                <div><b>Type:</b> {type}</div>
                <div><b>Start:</b> {fmtHM(startSec)} &nbsp; <b>End:</b> {fmtHM(endSec)}</div>
                {type === "ramp" && phase && (
                  <>
                    <div><b>Start Value:</b> {phase.start}</div>
                    <div><b>End Value:</b> {phase.end}</div>
                    <div><b>Step:</b> {phase.step}</div>
                  </>
                )}
                {type === "clouds" && phase && (
                  <>
                    <div><b>Offset:</b> {phase.offset}</div>
                    <div><b>Amplitude:</b> {phase.amplitude}</div>
                    <div><b>Density:</b> {phase.cloud_density}</div>
                    <div><b>Position:</b> {phase.cloud_position}</div>
                    <div><b>Dur μ/σ:</b> {phase.cloud_duration_mean} / {phase.cloud_duration_var}</div>
                  </>
                )}
                {type === "sin" && phase && (
                  <>
                    <div><b>Min/Max:</b> {phase.min} / {phase.max}</div>
                    <div><b>Period:</b> {phase.period}</div>
                    <div><b>Phase Offset:</b> {phase.phaseOffset}</div>
                  </>
                )}
              </div>
            </div>
          );
        })()}
      </div>
    </div>
  );
}
