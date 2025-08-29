export function canonicalizeProtocol(proto: any) {
  if (!proto || !proto.sections) return proto;

  const norm = JSON.parse(JSON.stringify(proto)); // deep clone safe enough for our shapes

  const secs = Array.isArray(norm.sections) ? norm.sections : [];
  secs.forEach((sec: any) => {
    const parts = Array.isArray(sec.parts) ? sec.parts : [];
    sec.parts = parts.map((g: any) => canonicalizeGroup(g));
  });

  // V1 wire: description must be string (host still keeps real desc elsewhere)
  if (typeof norm.description !== "string") norm.description = "";

  return norm;
}

function canonicalizeGroup(g: any) {
  const out = { ...g };

  // Normalize "group-name" vs "name"
  if (out["group-name"] == null && out.name != null) {
    out["group-name"] = out.name;
  }

  // Ensure phases[]
  const phases = Array.isArray(out.phases) ? out.phases : [];
  out.phases = phases.map(canonicalizePhase);

  return out;
}

// canonicalize.ts (inside canonicalizeProtocol or helpers)
import { parseDurationToSeconds, formatDurationPreserveDays } from "./time";

function canonTimeStr(raw: any): string {
  // Accept numbers or strings; return a trimmed string with day preserved.
  if (raw == null) return "00:00:00";
  const sec = parseDurationToSeconds(raw);
  return formatDurationPreserveDays(sec);
}

// Example per phase type:
function canonicalizePhase(p: any): any {
  if (!p || !p.type) return p;

  if (p.type === "fixed") {
    return {
      ...p,
      duration: canonTimeStr(p.duration),
    };
  }

  if (p.type === "ramp") {
    return {
      ...p,
      duration: canonTimeStr(p.duration),
      step:     canonTimeStr(p.step),
    };
  }

  if (p.type === "sin") {
    return {
      ...p,
      duration:     canonTimeStr(p.duration),
      step:         canonTimeStr(p.step),
      period:       canonTimeStr(p.period),
      phaseOffset:  canonTimeStr(p.phaseOffset),
    };
  }

  if (p.type === "clouds" || p.type === "cloud") {
    return {
      ...p,
      duration: canonTimeStr(p.duration),
      step:     canonTimeStr(p.step),
      // The remaining cloud_* fields are amplitudes/ratios; don't touch here.
    };
  }

  return p;
}

function round2(n: number) { return Math.round(n * 100) / 100; }
