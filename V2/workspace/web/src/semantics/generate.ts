import type { Protocol, Group, Phase } from "../profiles";
import { RANGES } from "../ranges";
import { parseDurationToSeconds } from "../utils/time";
import {
  getDefaultPecoIdForGroupType,
  getSpectralHintForGroupType,
  isLightGroupType,
  getPecoOptionsForGroupType,
  maybeAddLightIntensityTerm,
  pecoLabel,
  type PecoOption,
  type SpectralHint
} from "./mappings";

export type SemanticsOverrides = {
  /** key: `${sectionIdx}:${partIdx}` */
  pecoByPartKey: Record<string, string>;
  /** key: machine var (e.g., CoolWhite1) -> calibration CSV filename */
  calibrationByVar: Record<string, string>;
};

export function emptyOverrides(): SemanticsOverrides {
  return { pecoByPartKey: {}, calibrationByVar: {} };
}

// --- Canonical math meaning for curve primitives (v0.1) ---
const CURVE_DEFINITIONS_V0_1 = {
  time_model: {
    description:
      "Each group's program is a sequence of phases. Let phase i start at absolute time t0 (seconds since protocol start) and have duration D>0. The phase applies on t ∈ [t0, t0 + D).",
    time_reference: "protocol start (t=0)",
    phase_domain: "[t0, t0 + D)"
  },

  const: {
    description: "Constant setpoint across the whole phase.",
    formula: "y(t) = v",
    parameters: { v: "phase.value" }
  },

  ramp: {
    description: "Linear interpolation from start to end across the phase duration.",
    formula: "y(t) = start + (end-start) * (t - t0) / D",
    parameters: {
      start: "phase.start",
      end: "phase.end",
      D: "phase.duration (seconds)",
      t0: "phase start time (seconds)",
      t: "time in seconds"
    },
    notes: [
      "This is the canonical target function. A device may approximate it by discrete updates.",
      "In protocol.json, phase.step indicates the actuator command interval (Δt)."
    ]
  },

  command_interval: {
    description:
      "When phase.step exists, it indicates command updates every Δt seconds. Devices typically hold the last commanded value between updates.",
    canonical_sampling: {
      description:
        "A canonical discretization is: at k=0..N, t_k = t0 + kΔt, command_k = y(t_k), and hold until next update.",
      variables: { Δt: "phase.step (seconds)" }
    }
  }
} as const;

function deepClone<T>(x: T): T {
  return typeof structuredClone === "function"
    ? structuredClone(x)
    : JSON.parse(JSON.stringify(x));
}

function groupDisplayName(g: any): string {
  return g?.["group-name"] ?? g?.name ?? "(unnamed group)";
}

function normalizeRangeKey(groupName: string): string {
  // e.g. "Cool White 2" -> "Cool White"
  return String(groupName || "").replace(/\s+\d+$/, "").trim();
}

function groupScale(g: any): number {
  const gn = normalizeRangeKey(groupDisplayName(g));
  const r = (RANGES as any)[gn];
  const scale = r?.scale;
  return typeof scale === "number" && scale > 0 ? scale : 1;
}

function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

function scalePhaseNumericFields(ph: any, scale: number): any {
  if (!ph || typeof ph !== "object" || !scale || scale === 1) return ph;

  const t = ph.type;
  const out = { ...ph };

  // Keys by phase type
  const keys: string[] =
    t === "const" ? ["value"]
    : t === "ramp" ? ["start", "end"]
    : t === "sin" ? ["min", "max"]
    : (t === "cloud" || t === "clouds") ? ["amplitude", "offset"]
    : t === "csv-import" ? []
    : [];

  for (const k of keys) {
    if (typeof out[k] === "number") out[k] = round6(out[k] / scale);
  }

  // csv-import points: [[time,value],...]
  if (t === "csv-import" && Array.isArray(out.points)) {
    out.points = out.points.map((pair: any) => {
      if (!Array.isArray(pair) || pair.length !== 2) return pair;
      const [time, val] = pair;
      return [time, typeof val === "number" ? round6(val / scale) : val];
    });
  }

  return out;
}

function canonicalizeProtocolValues(protocol: Protocol): Protocol {
  const p = deepClone(protocol) as any;
  const secs = Array.isArray(p.sections) ? p.sections : [];

  secs.forEach((sec: any) => {
    const parts = Array.isArray(sec.parts) ? sec.parts : [];
    parts.forEach((g: any) => {
      if (g["group-name"] == null && g.name != null) g["group-name"] = g.name;
      const scale = groupScale(g);
      if (Array.isArray(g.phases)) {
        g.phases = g.phases.map((ph: any) => scalePhaseNumericFields(ph, scale));
      }
    });
  });

  return p;
}

function scheduleFromLogic(logic: string): { start_mode: "manual_start" | "wall_clock"; logic_start_time?: string } {
  const s = String(logic || "").trim();
  if (!s) return { start_mode: "manual_start" };
  // allow HH:MM or HH:MM:SS; normalize to HH:MM:SS
  const parts = s.split(":").map(x => x.trim());
  if (parts.length === 2) return { start_mode: "wall_clock", logic_start_time: `${parts[0].padStart(2,"0")}:${parts[1].padStart(2,"0")}:00` };
  if (parts.length === 3) return { start_mode: "wall_clock", logic_start_time: `${parts[0].padStart(2,"0")}:${parts[1].padStart(2,"0")}:${parts[2].padStart(2,"0")}` };
  return { start_mode: "wall_clock", logic_start_time: s };
}

function repeatSemantics(repeatRaw: number): { mode: "forever" | "count"; count?: number } {
  if (repeatRaw === 2147483647) return { mode: "forever" };
  if (Number.isFinite(repeatRaw) && repeatRaw > 0) return { mode: "count", count: Math.floor(repeatRaw) };
  return { mode: "count", count: 1 };
}

function machineEncodingForGroup(g: any): { kind: "identity" | "linear"; scale: number; offset: number; raw_unit: string } {
  const name = groupDisplayName(g);
  const scale = groupScale(g);
  if (scale !== 1) {
    // Temperature in current app uses celsius_x10
    return { kind: "linear", scale, offset: 0, raw_unit: name.toLowerCase().includes("temp") ? "celsius_x10" : "scaled" };
  }
  return { kind: "identity", scale: 1, offset: 0, raw_unit: g?.unit ?? "" };
}

function partKey(sectionIdx: number, partIdx: number): string {
  return `${sectionIdx}:${partIdx}`;
}

function selectedPecoForPart(type: string, key: string, overrides: SemanticsOverrides): PecoOption {
  const chosen = overrides.pecoByPartKey[key] || getDefaultPecoIdForGroupType(type);
  const opts = getPecoOptionsForGroupType(type);
  const hit = opts.find(o => o.id === chosen);
  if (hit) return hit;
  // fallback to first option
  if (opts[0] && opts[0].id) return opts[0];
  return { id: chosen || "", label: pecoLabel(chosen || ""), relation: "broad" };
}

function sineStandardForm(ph: any): { A: number; omega: number; phi: number; C: number } | null {
  if (!ph || ph.type !== "sin") return null;
  const min = ph.min, max = ph.max;
  if (typeof min !== "number" || typeof max !== "number") return null;
  const periodSec = parseDurationToSeconds(ph.period);
  const offsetSec = parseDurationToSeconds(ph.phaseOffset);
  if (!periodSec) return null;
  const A = (max - min) / 2;
  const omega = (2 * Math.PI) / periodSec;
  const phi = (2 * Math.PI * offsetSec) / periodSec;
  const C = (max + min) / 2;
  return { A: round6(A), omega: round6(omega), phi: round6(phi), C: round6(C) };
}

export function buildProtocolSemantics(
  profileKey: string,
  protocolRaw: Protocol,
  overrides: SemanticsOverrides
): any {
  const protocol_canonical = canonicalizeProtocolValues(protocolRaw);
  const sched = scheduleFromLogic(protocolRaw.logic);
  const rep = repeatSemantics(protocolRaw.repeat);

  const partsSem: any[] = [];
  const cals: any[] = [];

  (protocolRaw.sections || []).forEach((sec: any, si: number) => {
    (sec.parts || []).forEach((g: any, pi: number) => {
      const key = partKey(si, pi);
      const pecoPrimary = selectedPecoForPart(g.type, key, overrides);
      const spectral: SpectralHint | undefined = isLightGroupType(g.type)
        ? getSpectralHintForGroupType(g.type)
        : undefined;

      const encoding = machineEncodingForGroup(g);

      const calibration_csv: Record<string, string> = {};
      if (isLightGroupType(g.type) && Array.isArray(g.vars)) {
        for (const v of g.vars) {
          const fn = overrides.calibrationByVar[v];
          if (fn) calibration_csv[v] = fn;
        }
      }

      // Optional registry entries for calibration files (light only)
      if (Object.keys(calibration_csv).length) {
        for (const [machine_var, file_ref] of Object.entries(calibration_csv)) {
          cals.push({
            id: `cal:${machine_var}`,
            kind: "spectrapen_regression_per_wavelength",
            source_device: "PSI SpectraPen",
            file_ref,
            wavelength_nm_range: { min: 315, max: 800 },
            applies_to_machine_var: machine_var
          });
        }
      }

      const extraLightTerms = isLightGroupType(g.type) ? maybeAddLightIntensityTerm(pecoPrimary.id) : [];

      partsSem.push({
        selector: {
          section_index: si,
          part_index: pi,
          type: g.type,
          vars: g.vars || [],
          group_name: groupDisplayName(g)
        },
        meaning: {
          peco_terms: [
            { id: pecoPrimary.id, label: pecoPrimary.label, relation: pecoPrimary.relation },
            ...extraLightTerms.map(t => ({ id: t.id, label: t.label, relation: t.relation }))
          ].filter(x => x.id),
          spectral_hint: spectral,
          calibration_csv: Object.keys(calibration_csv).length ? calibration_csv : undefined
        },
        encoding: {
          canonical_unit: g.unit,
          source_unit: g.unit,
          machine_encoding: encoding
        },
        program_hints: {
          sine_translation: "y(t)=A sin(ωt+φ)+C, A=(Max-Min)/2, ω=2π/Period, φ=2π*Offset/Period, C=(Max+Min)/2",
          derived_sine_params: Array.isArray(g.phases)
            ? g.phases
                .map((ph: any, idx: number) => ({ idx, params: sineStandardForm(ph) }))
                .filter(x => x.params)
            : []
        }
      });
    });
  });

  // De-duplicate calibration registry by id
  const seen = new Set<string>();
  const calibrations = cals.filter(c => {
    if (!c?.id) return false;
    if (seen.has(c.id)) return false;
    seen.add(c.id);
    return true;
  });

  return {
    schema: { name: "faketotron.protocol_semantics", version: "0.1.0" },
    generated_at: new Date().toISOString(),
    execution_context: { profile_key: profileKey },

    // Canonicalized protocol values (e.g., Temperature 210 -> 21.0)
    protocol_canonical,

    semantics: {
      schedule: { ...sched, timezone: "Europe/Amsterdam" },
      repeat_raw: protocolRaw.repeat,
      repeat_semantics: rep,
      curve_definitions: CURVE_DEFINITIONS_V0_1,
      parts: partsSem,
      calibrations: calibrations.length ? calibrations : undefined
    }
  };
}

function portableKindFromType(type: string): string {
  if (["temperature", "humidity", "co2"].includes(type)) return type;
  if (type === "hydroponie") return "hydroponics";
  if (isLightGroupType(type)) return "light";
  return type;
}

function portableLightChannelFromType(type: string): string {
  if (type === "white") return "cool-white";
  return type;
}

export function buildPortableSemantics(
  profileKey: string,
  protocolRaw: Protocol,
  overrides: SemanticsOverrides
): any {
  const protocol_canonical = canonicalizeProtocolValues(protocolRaw);
  const sched = scheduleFromLogic(protocolRaw.logic);
  const rep = repeatSemantics(protocolRaw.repeat);

  // Build channels (one per machine var), but IDs are vendor-neutral
  const channels: any[] = [];
  const lightCounters: Record<string, number> = {};

  (protocolRaw.sections || []).forEach((sec: any, si: number) => {
    (sec.parts || []).forEach((g: any, pi: number) => {
      const key = partKey(si, pi);
      const pecoPrimary = selectedPecoForPart(g.type, key, overrides);
      const extraLightTerms = isLightGroupType(g.type) ? maybeAddLightIntensityTerm(pecoPrimary.id) : [];
      const peco_terms = [pecoPrimary, ...extraLightTerms].filter(x => x.id);

      const spectral: SpectralHint | undefined = isLightGroupType(g.type)
        ? getSpectralHintForGroupType(g.type)
        : undefined;

      const kind = portableKindFromType(g.type);

      const vars: string[] = Array.isArray(g.vars) && g.vars.length ? g.vars : [groupDisplayName(g)];

      for (const mv of vars) {
        let id = "";
        if (kind === "temperature") id = "env.temperature";
        else if (kind === "humidity") id = "env.humidity";
        else if (kind === "co2") id = "env.co2";
        else if (kind === "hydroponics") id = "env.hydroponics";
        else if (kind === "light") {
          const ch = portableLightChannelFromType(g.type);
          lightCounters[ch] = (lightCounters[ch] || 0) + 1;
          id = `light.${ch}.${lightCounters[ch]}`;
        } else {
          id = `env.${kind}.${si}.${pi}`;
        }

        const calibration_csv = isLightGroupType(g.type) ? overrides.calibrationByVar[mv] : undefined;

        // Find the canonical phases for this group from protocol_canonical
        const canonicalGroup = protocol_canonical.sections?.[si]?.parts?.[pi] as any;
        const program = canonicalGroup?.phases ?? g.phases ?? [];

        channels.push({
          id,
          kind,
          light_channel: kind === "light" ? portableLightChannelFromType(g.type) : undefined,
          unit: g.unit,
          peco_terms: peco_terms.map(t => ({ id: t.id, label: t.label, relation: t.relation })),
          spectral_hint: spectral,
          calibration_csv: calibration_csv || undefined,
          program
        });
      }
    });
  });

  return {
    schema: { name: "faketotron.portable_semantics", version: "0.1.0" },
    generated_at: new Date().toISOString(),
    execution_context: { profile_key: profileKey },
    curve_definitions: CURVE_DEFINITIONS_V0_1,
    schedule: { ...sched, timezone: "Europe/Amsterdam" },
    repeat_semantics: rep,
    channels
  };
}
