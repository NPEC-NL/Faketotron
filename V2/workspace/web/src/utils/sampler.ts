import { parseDurationToSeconds } from "./time";

export type XY = { x: number; y: number };

type AnyPhase = any; // tolerate both V1/V2 shapes

function sampleConst(ph: AnyPhase, t0: number): XY[] {
  // Accept both {type:'const', value, duration} and {type:'hold', ...}
  const dur = parseDurationToSeconds(ph.duration);
  const value = Number(ph.value ?? ph.start ?? ph.min ?? 0);
  return [{ x: t0, y: value }, { x: t0 + dur, y: value }];
}

function sampleRamp(ph: AnyPhase, t0: number): XY[] {
  const dur = parseDurationToSeconds(ph.duration);
  const start = Number(ph.start);
  const end = Number(ph.end);
  return [{ x: t0, y: start }, { x: t0 + dur, y: end }];
}

function sampleSin(ph: AnyPhase, t0: number): XY[] {
  const dur = parseDurationToSeconds(ph.duration);
  const step = Math.max(1, parseDurationToSeconds(ph.step ?? "00:00:01")); // seconds
  // Support both {offset, amplitude} and {min, max}
  const hasOffsetAmp = typeof ph.offset === "number" && typeof ph.amplitude === "number";
  const hasMinMax = typeof ph.min === "number" && typeof ph.max === "number";

  const offset = hasOffsetAmp ? Number(ph.offset) : (hasMinMax ? (Number(ph.min) + Number(ph.max)) / 2 : 0);
  const amplitude = hasOffsetAmp ? Number(ph.amplitude) : (hasMinMax ? Math.abs(Number(ph.max) - Number(ph.min)) / 2 : 0);

  const period = parseDurationToSeconds(ph.period);
  const phaseOffset = parseDurationToSeconds(ph.phaseOffset ?? "00:00:00") % period;
  const min = offset - amplitude;
  const max = offset + amplitude;

  const out: XY[] = [];
  for (let i = 0; i <= dur; i += step) {
    const t = (i + phaseOffset) % period;
    const theta = (2 * Math.PI * t) / period;
    const y = offset + amplitude * Math.sin(theta);
    const clamp = Math.max(min, Math.min(max, y));
    out.push({ x: t0 + i, y: clamp });
  }
  if (out[out.length - 1]?.x !== t0 + dur) {
    out.push({ x: t0 + dur, y: out[out.length - 1]?.y ?? offset });
  }
  return out;
}

// Cloud placeholder: just a grey box covering [offset-amplitude, offset+amplitude] across duration
function sampleCloud(ph: AnyPhase, t0: number) {
  const dur = parseDurationToSeconds(ph.duration);
  const offset = Number(ph.offset ?? 0);
  const amplitude = Math.abs(Number(ph.amplitude ?? 0));
  const y0 = offset - amplitude;
  const y1 = offset + amplitude;
  return { x0: t0, x1: t0 + dur, y0, y1 };
}

export function sampleGroup(g: any): {
  series: XY[];
  clouds: Array<{ x0: number; x1: number; y0: number; y1: number }>;
  phaseStarts: number[];
} {
  let t = 0;
  const series: XY[] = [];
  const clouds: Array<{ x0: number; x1: number; y0: number; y1: number }> = [];
  const phaseStarts: number[] = [];

  for (const ph of g.phases || []) {
    phaseStarts.push(t);

    const type = (ph?.type || "").toLowerCase();
    if (type === "const" || type === "hold") {
      const pts = sampleConst(ph, t); series.push(...pts); t = pts[pts.length - 1].x;
    } else if (type === "ramp") {
      const pts = sampleRamp(ph, t);  series.push(...pts); t = pts[pts.length - 1].x;
    } else if (type === "sin") {
      const pts = sampleSin(ph, t);   series.push(...pts); t = pts[pts.length - 1].x;
    } else if (type === "cloud" || type === "clouds") {
      const box = sampleCloud(ph, t); clouds.push(box); t = box.x1;
    } else {
      const pts = sampleConst(ph, t); series.push(...pts); t = pts[pts.length - 1].x;
    }
  }

  if (!series.length) series.push({ x: 0, y: 0 }, { x: 1, y: 0 });
  return { series, clouds, phaseStarts };

}
