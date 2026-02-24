import type { Protocol } from "../profiles";
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
import { PROTOCOL_SEMANTICS_SCHEMA, PORTABLE_SEMANTICS_SCHEMA } from "./schemaVersion";

export type SemanticsOverrides = {
  /** key: `${sectionIdx}:${partIdx}` */
  pecoByPartKey: Record<string, string>;
  /** key: machine var (e.g., CoolWhite1) -> SpectraPen regression calibration CSV filename */
  calibrationByVar: Record<string, string>;
  /** key: upper-shelf machine var (e.g., CoolWhite2) -> leakage calibration CSV filename (upper -> lower), optional */
  leakageCalibrationByUpperVar: Record<string, string>;
};

export function emptyOverrides(): SemanticsOverrides {
  return { pecoByPartKey: {}, calibrationByVar: {}, leakageCalibrationByUpperVar: {} };
}

// --- Canonical math meaning for curve primitives (v0.1) ---
// These definitions document the intended continuous-time meaning of phase primitives.
// Devices may approximate these targets via discrete command updates (phase.step).
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

  sine: {
    description:
      "Sine is specified using (min,max,period,phaseOffset) and is convertible to standard form y(t)=A sin(ωt+φ)+C.",
    standard_form: {
      formula: "y(t)=A sin(ωt+φ)+C",
      A: "(Max-Min)/2",
      omega: "2π/Period",
      phi: "2π*Offset/Period",
      C: "(Max+Min)/2"
    }
  },

  csv_import: {
    description: "Explicit (time,value) point series with declared interpolation in downstream tools."
  },

  command_interval: {
    description:
      "When phase.step exists, it indicates command updates every Δt seconds. Devices typically hold the last commanded value between updates.",
    canonical_sampling: {
      description:
        "A canonical discretization is: at k=0..N, t_k = t0 + kΔt, command_k = y(t_k), and hold until next update.",
      variables: { "Δt": "phase.step (seconds)" }
    }
  }
} as const;


function ucumFromSourceUnit(sourceUnit: string): string {
  const u = (sourceUnit || "").toLowerCase().trim();
  // protocol.json uses non-UCUM labels like "celsius"/"percent"/"ppm"
  if (u === "celsius") return "Cel";
  if (u === "percent") return "%";
  if (u === "ppm") return "ppm";
  // Fallback: assume it is already a UCUM code.
  return sourceUnit;
}

const SPECTRAL_REGRESSION_MODEL_V0_1 = {
  kind: "per_wavelength_linear_regression",
  regression_equation: "E(λ) = A(λ) * p + b(λ)",
  input_unit: "%",
  output_unit: "umol.m-2.s-1.nm-1",
  csv_columns: { wavelength_nm: "wavelength_nm", A: "A", b: "b" }
} as const;

const LEAKAGE_MODEL_CONSTANTS_V0_1 = {
  kind: "upper_to_lower_spectral_additive_regression",
  composition_equation: "E_low_actual(λ) = E_low_set(λ) + E_leak(λ)",
  leak_regression_equation: "E_leak(λ) = A(λ) * p_upper + b(λ)",
  wavelength_nm_range: { min: 315, max: 800 },
  output_unit: "umol.m-2.s-1.nm-1"
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

function shelfForMachineVar(machineVar: string): "lower" | "upper" {
  return /2$/.test(machineVar) ? "upper" : "lower";
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
      const shelf_by_var: Record<string, "lower" | "upper"> = {};
      const leakage_calibration_csv: Record<string, string> = {};

      if (Array.isArray(g.vars)) {
        for (const v of g.vars) {
          shelf_by_var[v] = shelfForMachineVar(v);

          const fn = overrides.calibrationByVar[v];
          if (isLightGroupType(g.type) && fn) calibration_csv[v] = fn;

          const leakFn = overrides.leakageCalibrationByUpperVar?.[v];
          if (isLightGroupType(g.type) && shelf_by_var[v] === "upper" && typeof leakFn === "string" && leakFn.trim()) {
            leakage_calibration_csv[v] = leakFn.trim();
          }
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
            model: SPECTRAL_REGRESSION_MODEL_V0_1,
            applies_to_machine_var: machine_var
          });
        }
      }

      
      // Optional registry entries for leakage calibration files (upper shelf -> lower shelf; light only)
      if (Object.keys(leakage_calibration_csv).length) {
        for (const [upper_machine_var, file_ref] of Object.entries(leakage_calibration_csv)) {
          cals.push({
            id: `cal:leakage:${upper_machine_var}`,
            kind: "upper_to_lower_light_leakage",
            source_device: "PSI SpectraPen",
            file_ref,
            wavelength_nm_range: { min: 315, max: 800 },
            composition_equation: LEAKAGE_MODEL_CONSTANTS_V0_1.composition_equation,
            model: SPECTRAL_REGRESSION_MODEL_V0_1,
            applies_to_machine_var: upper_machine_var
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
          shelf_by_var: Object.keys(shelf_by_var).length ? shelf_by_var : undefined,
          calibration_csv: Object.keys(calibration_csv).length ? calibration_csv : undefined,
          leakage_calibration_csv: Object.keys(leakage_calibration_csv).length ? leakage_calibration_csv : undefined,
          leakage_to_lower_by_upper_var: Object.keys(leakage_calibration_csv).length
            ? Object.fromEntries(
                Object.entries(leakage_calibration_csv).map(([upperVar, csv]) => {
                  const base = upperVar.replace(/2$/, "");
                  const candidates = Array.isArray(g.vars)
                    ? g.vars.filter((vv: string) => vv === base || vv === `${base}1`)
                    : [];
                  return [
                    upperVar,
                    {
                      ...LEAKAGE_MODEL_CONSTANTS_V0_1,
                      calibration_csv: csv,
                      target_lower_var_candidates: candidates
                    }
                  ];
                })
              )
            : undefined
        },
        encoding: {
          canonical_unit: ucumFromSourceUnit(g.unit),
          source_unit: ucumFromSourceUnit(g.unit),
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
    schema: PROTOCOL_SEMANTICS_SCHEMA,
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
          unit: ucumFromSourceUnit(g.unit),
          peco_terms: peco_terms.map(t => ({ id: t.id, label: t.label, relation: t.relation })),
          spectral_hint: spectral,
          calibration_csv: calibration_csv || undefined,
          shelf:
            kind === "light"
              ? (/2$/.test(mv) ? "upper" : "lower")
              : undefined,
          leakage_to_lower:
            kind === "light" && /2$/.test(mv)
              ? (() => {
                  const fn = overrides?.leakageCalibrationByUpperVar?.[mv];
                  return fn && fn.trim()
                    ? {
                        ...LEAKAGE_MODEL_CONSTANTS_V0_1,
                        calibration_csv: fn.trim()
                      }
                    : undefined;
                })()
              : undefined,
          program
        });
      }
    });
  });

  return {
    schema: PORTABLE_SEMANTICS_SCHEMA,
    generated_at: new Date().toISOString(),
    execution_context: { profile_key: profileKey },
    curve_definitions: CURVE_DEFINITIONS_V0_1,
    schedule: { ...sched, timezone: "Europe/Amsterdam" },
    repeat_semantics: rep,
    channels
  };
}
