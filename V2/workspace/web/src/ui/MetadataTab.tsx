import React, { useEffect, useMemo, useState } from "react";
import * as Store from "../state/store";
import type { Protocol, Phase, PhaseConst, PhaseRamp } from "../profiles";
import { RANGES, type Range } from "../ranges";
import {
  type MetadataColumn,
  type MetadataPhaseKey,
  type MetadataDurations,
  type MetadataTime,
} from "../state/store";
import { parseDurationToSeconds } from "../utils/time";

const useProto: any = (Store as any).useProto ?? (Store as any).useStore;

const PHASE_KEYS: MetadataPhaseKey[] = ["night", "dayAdapt", "day", "nightAdapt"];
const DAY_SECONDS = 24 * 60 * 60;

type CellValidation = {
  ok: boolean;
  message?: string;
};

type StandardDayPattern = {
  durations: Record<MetadataPhaseKey, string>;
};

type StandardDayDetection = {
  ok: boolean;
  reason?: string;
  pattern?: StandardDayPattern;
};

function getGroupName(g: any, index: number): string {
  return g.name ?? g["group-name"] ?? `group-${index}`;
}

function getRangeForGroup(name: string): Range | undefined {
  return (RANGES as any)[name];
}

function scaleFromRange(range: Range | undefined): number {
  return range?.scale ?? 1;
}

// machineValue is what the chamber stores (e.g. 212 for 21.2°C)
// humanValue is what we show in MetadataTab (e.g. 21.2)
function machineToHuman(name: string, machineValue: number): number {
  const r = getRangeForGroup(name);
  const scale = scaleFromRange(r);
  return machineValue / scale;
}

function humanToMachine(name: string, humanValue: number): number {
  const r = getRangeForGroup(name);
  const scale = scaleFromRange(r);
  const raw = humanValue * scale;
  return r?.int ? Math.round(raw) : raw;
}

function validateHumanValue(name: string, raw: string): CellValidation {
  const r = getRangeForGroup(name);
  if (!r) return { ok: true };
  if (!raw.trim()) return { ok: true }; // empty allowed, defaults handled later
  const v = Number(raw);
  if (!Number.isFinite(v)) return { ok: false, message: "Not a number" };
  const machine = v * (r.scale ?? 1);
  if (machine < r.min || machine > r.max) {
    const humanMin = r.min / (r.scale ?? 1);
    const humanMax = r.max / (r.scale ?? 1);
    return { ok: false, message: `Allowed ${humanMin}–${humanMax}` };
  }
  return { ok: true };
}

/**
 * Detection logic:
 * - Find at least one group with ramp→const→ramp→const and boundary equality:
 *   ramp1.end == constDay.value, ramp2.start == constDay.value, ramp2.end == constNight.value
 * - All such groups must share identical durations for those four phases
 *   (alignment across variable groups).
 * - Longest group total duration must be 24h.
 * Produces a StandardDayPattern with durations (night/dayAdapt/day/nightAdapt).
 */
function detectStandardDay(protocol: Protocol): StandardDayDetection {
  const parts = protocol.sections[0]?.parts || [];
  if (!parts.length) return { ok: false, reason: "Protocol has no groups" };

  let maxTotal = 0;
  let baselineDurations: [number, number, number, number] | null = null;
  let baselineStrings: Record<MetadataPhaseKey, string> | null = null;
  let foundPatternGroup = false;

  for (const g of parts as any[]) {
    const phases: Phase[] = g.phases || [];
    const total = phases.reduce(
      (acc, ph) => acc + parseDurationToSeconds((ph as any).duration),
      0
    );
    if (total > maxTotal) maxTotal = total;

    if (
      phases.length >= 4 &&
      phases[0].type === "ramp" &&
      phases[1].type === "const" &&
      phases[2].type === "ramp" &&
      phases[3].type === "const"
    ) {
      const p0 = phases[0] as PhaseRamp;
      const p1 = phases[1] as PhaseConst;
      const p2 = phases[2] as PhaseRamp;
      const p3 = phases[3] as PhaseConst;

      // Boundaries: ramp1.end == day, ramp2.start == day, ramp2.end == night
      if (p0.end === p1.value && p2.start === p1.value && p2.end === p3.value) {
        foundPatternGroup = true;

        const dNight = parseDurationToSeconds(p3.duration);
        const dDayAdapt = parseDurationToSeconds(p0.duration);
        const dDay = parseDurationToSeconds(p1.duration);
        const dNightAdapt = parseDurationToSeconds(p2.duration);

        const tuple: [number, number, number, number] = [
          dNight,
          dDayAdapt,
          dDay,
          dNightAdapt,
        ];

        if (!baselineDurations) {
          baselineDurations = tuple;
          baselineStrings = {
            night: p3.duration,
            dayAdapt: p0.duration,
            day: p1.duration,
            nightAdapt: p2.duration,
          };
        } else {
          const [bNight, bDayAdapt, bDay, bNightAdapt] = baselineDurations;
          const tol = 1; // 1 second tolerance per segment
          if (
            Math.abs(dNight - bNight) > tol ||
            Math.abs(dDayAdapt - bDayAdapt) > tol ||
            Math.abs(dDay - bDay) > tol ||
            Math.abs(dNightAdapt - bNightAdapt) > tol
          ) {
            return {
              ok: false,
              reason:
                "Ramp/const groups do not share the same 4-phase day structure (durations mismatch).",
            };
          }
        }
      }
    }
  }

  if (!foundPatternGroup || !baselineDurations || !baselineStrings) {
    return {
      ok: false,
      reason:
        "No ramp→const→ramp→const day/night group with matching boundaries was found.",
    };
  }

  if (Math.abs(maxTotal - DAY_SECONDS) > 1) {
    return {
      ok: false,
      reason: `Longest group duration is not 1 day (got ${maxTotal} seconds, expected ${DAY_SECONDS})`,
    };
  }

  return {
    ok: true,
    pattern: { durations: baselineStrings },
  };
}


/**
 * Build initial metadata columns (values only) from protocol,
 * given an already-detected standard pattern (durations).
 *
 * We *don't* store time here – that lives in metadataDurations.
 */
function buildInitialColumnsFromProtocol(
  protocol: Protocol,
  pattern: StandardDayPattern
): MetadataColumn[] {
  const parts = protocol.sections[0]?.parts || [];
  const cols: MetadataColumn[] = [];

  for (let gi = 0; gi < parts.length; gi++) {
    const g: any = parts[gi];
    const name = getGroupName(g, gi);
    const phases: Phase[] = g.phases || [];
    const total = phases.reduce(
      (acc, ph) => acc + parseDurationToSeconds((ph as any).duration),
      0
    );

    const isFullDayConst =
      phases.length === 1 &&
      phases[0].type === "const" &&
      Math.abs(total - DAY_SECONDS) <= 1;

    const values: Record<MetadataPhaseKey, string[]> = {
      night: [""],
      dayAdapt: [""],
      day: [""],
      nightAdapt: [""],
    };

    if (isFullDayConst) {
      const p = phases[0] as PhaseConst;
      const human = machineToHuman(name, p.value);
      const s = String(human);
      (Object.keys(values) as MetadataPhaseKey[]).forEach((k) => {
        values[k][0] = s;
      });
      cols.push({
        groupName: name,
        groupIndex: gi,
        constant: true,
        isFactor: false,
        factorLevels: 1,
        values,
      });
      continue;
    }

    // Non-constant group: derive day/night plateau values from const phases
    let dayMachine = 0;
    let nightMachine = 0;
    if (
      phases.length >= 4 &&
      phases[0].type === "ramp" &&
      phases[1].type === "const" &&
      phases[2].type === "ramp" &&
      phases[3].type === "const"
    ) {
      const p1 = phases[1] as PhaseConst;
      const p3 = phases[3] as PhaseConst;
      dayMachine = p1.value;
      nightMachine = p3.value;
    } else {
      const firstConst = phases.find((ph) => ph.type === "const") as
        | PhaseConst
        | undefined;
      if (firstConst) {
        dayMachine = firstConst.value;
        nightMachine = firstConst.value;
      }
    }

    const dayHuman = machineToHuman(name, dayMachine);
    const nightHuman = machineToHuman(name, nightMachine);
    const dayStr = String(dayHuman);
    const nightStr = String(nightHuman);

    values.night[0] = nightStr;
    values.dayAdapt[0] = dayStr;
    values.day[0] = dayStr;
    values.nightAdapt[0] = nightStr;

    cols.push({
      groupName: name,
      groupIndex: gi,
      constant: false,
      isFactor: false,
      factorLevels: 1,
      values,
    });
  }

  return cols;
}

/**
 * Build a new protocol from:
 * - metadataColumns: values (night/dayAdapt/day/nightAdapt)
 * - durations: the time structure for night/dayAdapt/day/nightAdapt
 *
 * Constant groups => single 1-day const phase.
 * Non-constant groups => ramp/const/ramp/const using durations.
 */
function buildProtocolFromMetadata(
  protocol: Protocol,
  columns: MetadataColumn[],
  time: MetadataTime
): Protocol {
  const parts = protocol.sections[0]?.parts || [];

  // For the single protocol instance, we use factor level 0 for Time.
  const dur: Record<MetadataPhaseKey, string> = {
    night: time.values.night[0] ?? "",
    dayAdapt: time.values.dayAdapt[0] ?? "",
    day: time.values.day[0] ?? "",
    nightAdapt: time.values.nightAdapt[0] ?? "",
  };

  const newParts = parts.map((g: any, gi: number) => {
    const col =
      columns.find(
        (c) => c.groupIndex === gi || c.groupName === getGroupName(g, gi)
      ) ?? null;
    if (!col) return g;

    const name = col.groupName;
    const values = col.values;

    const firstNonEmpty = (phase: MetadataPhaseKey): number | null => {
      const arr = values[phase] || [];
      for (const raw of arr) {
        if (raw && raw.trim()) {
          const v = Number(raw);
          if (Number.isFinite(v)) return v;
        }
      }
      return null;
    };

    if (col.constant) {
      const vHuman =
        firstNonEmpty("day") ??
        firstNonEmpty("night") ??
        0;
      const vMachine = humanToMachine(name, vHuman);
      const constPhase: PhaseConst = {
        type: "const",
        value: vMachine,
        duration: "1.00:00:00", // D.HH:MM:SS >= 24h
      };
      return { ...g, phases: [constPhase] };
    }

    // Non-constant: use first factor level for protocol generation
    const dayHuman = firstNonEmpty("day") ?? 0;
    const nightHuman = firstNonEmpty("night") ?? dayHuman;
    const dayMachine = humanToMachine(name, dayHuman);
    const nightMachine = humanToMachine(name, nightHuman);

    const rampUp: PhaseRamp = {
      type: "ramp",
      start: nightMachine,
      end: dayMachine,
      duration: dur.dayAdapt,
      step: (g.phases?.[0] as PhaseRamp | undefined)?.step ?? "00:00:05",
    };
    const constDay: PhaseConst = {
      type: "const",
      value: dayMachine,
      duration: dur.day,
    };
    const rampDown: PhaseRamp = {
      type: "ramp",
      start: dayMachine,
      end: nightMachine,
      duration: dur.nightAdapt,
      step: (g.phases?.[2] as PhaseRamp | undefined)?.step ?? "00:00:05",
    };
    const constNight: PhaseConst = {
      type: "const",
      value: nightMachine,
      duration: dur.night,
    };

    return { ...g, phases: [rampUp, constDay, rampDown, constNight] };
  });

  return {
    ...protocol,
    sections: [
      { ...(protocol.sections[0] || {}), parts: newParts },
      ...protocol.sections.slice(1),
    ],
  };
}

function downloadText(filename: string, text: string) {
  // Prepend UTF-8 BOM so Excel & others detect encoding correctly
  const BOM = "\uFEFF";
  const blob = new Blob([BOM + text], {
    type: "text/csv;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 0);
}


function getUnitForLabel(label: string): string | null {
  // Strip trailing " day"/" night" etc. for group-based units
  const base = label.replace(/\s+(day|night)$/, "");

  // CO2 → ppm
  if (base === "CO2" || base.startsWith("CO2 ")) return "ppm";

  // Temperature → ℃
  if (base === "Temperature" || base.startsWith("Temperature ")) return "°C";

  // Hydroponics has no unit
  if (base === "Hydroponics" || base.startsWith("Hydroponics ")) return null;

  // Time durations (Night duration, Day duration, etc.) → hh:mm:ss
  if (/duration$/i.test(label)) return "hh:mm:ss";

  // Everything else (light channels, humidity, etc.) → %
  return "%";
}

function withUnit(label: string): string {
  const unit = getUnitForLabel(label);
  if (!unit) return label;
  return `${label}; ${unit}`;
}


function buildEnvironmentCsv(
  columns: MetadataColumn[],
  time: MetadataTime | null
): string {
  const lines: string[] = [];
  lines.push("Environment parameter,Environment parameter value");

  for (const col of columns) {
    if (col.isFactor) continue; // Experimental Factors do NOT appear here

    if (col.constant) {
      // Single invariant value for the whole day
      const v =
        col.values.day[0] ??
        col.values.night[0] ??
        col.values.dayAdapt[0] ??
        col.values.nightAdapt[0] ??
        "";

      // If constant and the value is 0, skip this row
      const vTrim = String(v).trim();
      const vNum = vTrim === "" ? NaN : Number(vTrim);
      if (vTrim !== "" && Number.isFinite(vNum) && vNum === 0) {
        continue;
      }

      const label = withUnit(col.groupName);
      lines.push(`"${label}","${v}"`);
    } else {
      // Non-constant: two independent values per group (day & night)
      const day =
        col.values.day[0] ??
        col.values.dayAdapt[0] ??
        "";
      const night =
        col.values.night[0] ??
        col.values.nightAdapt[0] ??
        "";

      const dayLabel = withUnit(`${col.groupName} day`);
      const nightLabel = withUnit(`${col.groupName} night`);

      lines.push(`"${dayLabel}","${day}"`);
      lines.push(`"${nightLabel}","${night}"`);
    }
  }

  // Time as Environment (when not an experimental factor):
  // we keep the four segments separately; all with hh:mm:ss unit.
  if (time && (!time.isFactor || time.factorLevels <= 1)) {
    const night = time.values.night[0] ?? "";
    const dayAdapt = time.values.dayAdapt[0] ?? "";
    const day = time.values.day[0] ?? "";
    const nightAdapt = time.values.nightAdapt[0] ?? "";

    lines.push(`"${withUnit("Night duration")}","${night}"`);
    lines.push(`"${withUnit("Day adapt duration")}","${dayAdapt}"`);
    lines.push(`"${withUnit("Day duration")}","${day}"`);
    lines.push(`"${withUnit("Night adapt duration")}","${nightAdapt}"`);
  }

  return lines.join("\n");
}


/**
 * Experimental Factor CSV:
 * - retains existing factor columns
 * - also includes time durations, one row per phase
 *   (Night/Day adapt/Day/Night adapt duration) with their single level.
 */
function buildFactorCsv(
  columns: MetadataColumn[],
  time: MetadataTime | null
): string | null {
  const factorCols = columns.filter((c) => c.isFactor);
  const hasTimeFactor = time && time.isFactor && time.factorLevels > 1;
  if (!factorCols.length && !hasTimeFactor) return null;

  const lines: string[] = [];
  lines.push("Experiment Factor type,Experiment Factor description,Experiment Factor values");

  // Other variables as Experimental Factors
  for (const col of factorCols) {
    const levels = col.factorLevels || 1;
    const values: string[] = [];
    for (let i = 0; i < levels; i++) {
      // Use the DAY plateau per level as factor value
      const v =
        col.values.day[i] ??
        col.values.dayAdapt[i] ??
        "";
      values.push(v);
    }
    const valuesStr = values.join(";");
    const desc = `${col.groupName} level setpoint of growth chamber in this duration`;
    const typeLabel = withUnit(col.groupName);
    lines.push(`"${typeLabel}","${desc}","${valuesStr}"`);
  }

  // Time as Experimental Factor: multiple duration regimes
  if (hasTimeFactor && time) {
    const n = time.factorLevels;

    const buildValues = (phase: MetadataPhaseKey): string => {
      const arr = time.values[phase] || [];
      const vals: string[] = [];
      for (let i = 0; i < n; i++) {
        vals.push(arr[i] ?? "");
      }
      return vals.join(";");
    };

    lines.push(
      `"${withUnit("Night duration")}","Night duration_description","${buildValues(
        "night"
      )}"`
    );
    lines.push(
      `"${withUnit("Day adapt duration")}","Day adapt duration_description","${buildValues(
        "dayAdapt"
      )}"`
    );
    lines.push(
      `"${withUnit("Day duration")}","Day duration_description","${buildValues(
        "day"
      )}"`
    );
    lines.push(
      `"${withUnit("Night adapt duration")}","Night adapt duration_description","${buildValues(
        "nightAdapt"
      )}"`
    );
  }

  return lines.join("\n");
}



export default function MetadataTab() {
  const protocol: Protocol = useProto((s: any) => s.protocol);
  const colsFromStore: MetadataColumn[] | null = useProto(
    (s: any) => (s.metadataColumns as MetadataColumn[] | null) ?? null
  );
const timeFromStore: MetadataTime | null = useProto(
  (s: any) => (s.metadataTime as MetadataTime | null) ?? null
);

  const setMetadataColumns = useProto((s: any) => s.setMetadataColumns);
  const setMetadataTime = useProto((s: any) => s.setMetadataTime);
  const setProtocol = useProto((s: any) => s.setProtocol);

  const [hardKey, setHardKey] = useState(0);
  const [status, setStatus] = useState<string>("");

  useEffect(() => {
    const onLoaded = () => {
      setMetadataColumns(null);
      setMetadataTime(null);
      setHardKey((k: number) => k + 1);
      setStatus("");
    };
    window.addEventListener("protocol:loaded", onLoaded);
    return () => window.removeEventListener("protocol:loaded", onLoaded);
  }, [setMetadataColumns, setMetadataTime]);

  const cols: MetadataColumn[] = useMemo(() => colsFromStore ?? [], [colsFromStore]);
  const time: MetadataTime | null = timeFromStore;

function handleReadCurrent() {
  const detection = detectStandardDay(protocol);
  if (!detection.ok || !detection.pattern) {
    alert(
      "Current protocol is not standard 1-day format: " +
        (detection.reason ?? "unknown reason")
    );
    return;
  }

  const newCols = buildInitialColumnsFromProtocol(protocol, detection.pattern);

  // Seed Time column from detected durations; by default it's Environment (factorLevels=1)
  const baseDur = detection.pattern.durations;
  const newTime: MetadataTime = {
    isFactor: false,
    factorLevels: 1,
    values: {
      night: [baseDur.night],
      dayAdapt: [baseDur.dayAdapt],
      day: [baseDur.day],
      nightAdapt: [baseDur.nightAdapt],
    },
  };

  setMetadataColumns(newCols);
  setMetadataTime(newTime);
  setStatus("Loaded from protocol");
  setTimeout(() => setStatus(""), 1500);
}


function handleGenerateProtocol() {
  if (!cols.length) {
    alert("No metadata defined to generate protocol from.");
    return;
  }
  if (!time) {
    alert(
      "No Time column defined. Use 'Read current' first or fill the Time column."
    );
    return;
  }

  // For Time, we always use level 0 durations to build the single protocol instance.
  const durNight = time.values.night[0] ?? "";
  const durDayAdapt = time.values.dayAdapt[0] ?? "";
  const durDay = time.values.day[0] ?? "";
  const durNightAdapt = time.values.nightAdapt[0] ?? "";

  const dNight = parseDurationToSeconds(durNight);
  const dDayAdapt = parseDurationToSeconds(durDayAdapt);
  const dDay = parseDurationToSeconds(durDay);
  const dNightAdapt = parseDurationToSeconds(durNightAdapt);

  const durationFields: [string, number, string][] = [
    ["Night duration", dNight, durNight],
    ["Day adapt duration", dDayAdapt, durDayAdapt],
    ["Day duration", dDay, durDay],
    ["Night adapt duration", dNightAdapt, durNightAdapt],
  ];

  for (const [label, sec, raw] of durationFields) {
    if (!raw || !raw.trim() || sec <= 0) {
      alert(
        `${label} must be a valid positive duration string (e.g. HH:MM:SS or D.HH:MM:SS).`
      );
      return;
    }
  }

  const total = dNight + dDayAdapt + dDay + dNightAdapt;
  if (Math.abs(total - DAY_SECONDS) > 1) {
    alert(
      `Durations must sum to 24 hours (currently ${total} seconds). Please adjust Night / Day adapt / Day / Night adapt.`
    );
    return;
  }

  // Warn about multi-level experimental factors (we will use first level).
  const factorCols = cols.filter((c) => c.isFactor && c.factorLevels > 1);
  if (factorCols.length) {
    const msg = factorCols.map((c) => `- ${c.groupName}`).join("\n");
    alert(
      "Experimental factors with multiple values detected.\n" +
        "The generated protocol can only represent a single set of conditions.\n\n" +
        "For these groups, the FIRST value will be used:\n" +
        msg
    );
  }
  if (time.isFactor && time.factorLevels > 1) {
    alert(
      "Time is marked as an experimental factor with multiple levels.\n" +
        "The generated protocol will use only the FIRST set of durations."
    );
  }

  // Validate scalar ranges (CO2, light, etc.)
  const errors: string[] = [];
  for (const col of cols) {
    for (const phase of PHASE_KEYS) {
      const arr = col.values[phase] || [];
      for (let i = 0; i < (col.isFactor ? col.factorLevels : 1); i++) {
        const raw = arr[i] ?? "";
        const v = validateHumanValue(col.groupName, raw);
        if (!v.ok) {
          const label =
            phase === "night"
              ? "night"
              : phase === "dayAdapt"
              ? "day adapt"
              : phase === "day"
              ? "day"
              : "night adapt";
          errors.push(
            `${col.groupName} ${label}${
              col.isFactor ? ` (level ${i + 1})` : ""
            }: ${v.message}`
          );
        }
      }
    }
  }

  if (errors.length) {
    const proceed = window.confirm(
      "Some values are invalid or outside allowed ranges:\n\n" +
        errors.slice(0, 8).join("\n") +
        (errors.length > 8 ? `\n...and ${errors.length - 8} more` : "") +
        "\n\nContinue anyway?"
    );
    if (!proceed) return;
  }

  if (!window.confirm("This will overwrite the current protocol. Continue?")) {
    return;
  }

  const newProtocol = buildProtocolFromMetadata(protocol, cols, time);
  setProtocol(newProtocol);

  window.dispatchEvent(
    new CustomEvent("protocol:save-draft", {
      detail: { protocol: newProtocol, reason: "metadata" },
    })
  );

  setStatus("Protocol generated");
  setTimeout(() => setStatus(""), 1500);
}


function handleDownload() {
  // Read latest metadata from the store (includes anything committed on blur)
  const state = useProto.getState() as {
    metadataColumns: MetadataColumn[] | null;
    metadataTime: MetadataTime | null;
  };

  const cols = state.metadataColumns ?? [];
  const time = state.metadataTime ?? null;

  if (!cols.length) {
    alert("No metadata to download. Use 'Read current' first.");
    return;
  }

  const errors: string[] = [];

  // 1) Scalar range checks
  for (const col of cols) {
    for (const phase of PHASE_KEYS) {
      const arr = col.values[phase] || [];
      const maxLevels = col.isFactor ? col.factorLevels : 1;
      for (let i = 0; i < maxLevels; i++) {
        const raw = arr[i] ?? "";
        const v = validateHumanValue(col.groupName, raw);
        if (!v.ok) {
          const label =
            phase === "night"
              ? "night"
              : phase === "dayAdapt"
              ? "day adapt"
              : phase === "day"
              ? "day"
              : "night adapt";
          errors.push(
            `${col.groupName} ${label}${
              col.isFactor ? ` (level ${i + 1})` : ""
            }: ${v.message}`
          );
        }
      }
    }
  }

  // 2) Time / duration checks (all factor levels must be valid, sum to 24h)
  if (time) {
    const maxLevels = time.isFactor ? time.factorLevels : 1;
    for (let i = 0; i < maxLevels; i++) {
      const durNight = time.values.night[i] ?? "";
      const durDayAdapt = time.values.dayAdapt[i] ?? "";
      const durDay = time.values.day[i] ?? "";
      const durNightAdapt = time.values.nightAdapt[i] ?? "";

      const dNight = parseDurationToSeconds(durNight);
      const dDayAdapt = parseDurationToSeconds(durDayAdapt);
      const dDay = parseDurationToSeconds(durDay);
      const dNightAdapt = parseDurationToSeconds(durNightAdapt);

      const levelSuffix = maxLevels > 1 ? ` (level ${i + 1})` : "";

      const durationFields: [string, number, string][] = [
        ["Night duration", dNight, durNight],
        ["Day adapt duration", dDayAdapt, durDayAdapt],
        ["Day duration", dDay, durDay],
        ["Night adapt duration", dNightAdapt, durNightAdapt],
      ];

      for (const [label, sec, raw] of durationFields) {
        if (!raw || !raw.trim() || sec <= 0) {
          errors.push(
            `${label}${levelSuffix}: must be a valid positive duration (HH:MM:SS or D.HH:MM:SS)`
          );
        }
      }

      const total = dNight + dDayAdapt + dDay + dNightAdapt;
      if (Math.abs(total - DAY_SECONDS) > 1) {
        errors.push(
          `Durations${levelSuffix} must sum to 24 hours (currently ${total} seconds).`
        );
      }
    }
  }

  // 3) Let the user choose whether to proceed despite issues
  if (errors.length) {
    const proceed = window.confirm(
      "Some values are invalid, out of range, or durations do not sum to 24 hours:\n\n" +
        errors.slice(0, 10).join("\n") +
        (errors.length > 10 ? `\n...and ${errors.length - 10} more` : "") +
        "\n\nContinue and download CSV anyway?"
    );
    if (!proceed) return;
  }

  // 4) Generate CSVs from the latest metadata
  const envCsv = buildEnvironmentCsv(cols, time);
  const facCsv = buildFactorCsv(cols, time);

  downloadText("environment.csv", envCsv);
  if (facCsv) {
    downloadText("experimental_factors.csv", facCsv);
  }

  setStatus("CSV downloaded");
  setTimeout(() => setStatus(""), 1500);
}



  // --- grid editing helpers ---

  function toggleConstant(col: MetadataColumn) {
    const state = useProto.getState() as {
      metadataColumns: MetadataColumn[] | null;
    };
    const liveCols = state.metadataColumns ?? [];

    const updated = liveCols.map((c) => {
      if (c.groupIndex !== col.groupIndex) return c;
      const constant = !c.constant;
      const values = { ...c.values };
      if (constant) {
        const base = c.values.day[0] || c.values.night[0] || "";
        PHASE_KEYS.forEach((k) => {
          (values as any)[k] = [base];
        });
      }
      return { ...c, constant, values };
    });
    setMetadataColumns(updated);
  }

  function toggleFactor(col: MetadataColumn) {
    const state = useProto.getState() as {
      metadataColumns: MetadataColumn[] | null;
    };
    const liveCols = state.metadataColumns ?? [];

    const updated = liveCols.map((c) => {
      if (c.groupIndex !== col.groupIndex) return c;
      const isFactor = !c.isFactor;
      const factorLevels = isFactor ? Math.max(2, c.factorLevels || 2) : 1;
      const values: Record<MetadataPhaseKey, string[]> = {} as any;
      PHASE_KEYS.forEach((k) => {
        const arr = [...(c.values[k] || [])];
        const base = arr[0] ?? "";
        const next: string[] = [];
        for (let i = 0; i < factorLevels; i++) {
          next[i] = arr[i] ?? base;
        }
        (values as any)[k] = next;
      });
      return { ...c, isFactor, factorLevels, values };
    });
    setMetadataColumns(updated);
  }

  function updateFactorLevels(col: MetadataColumn, levelsRaw: string) {
    const n = Math.max(1, Number(levelsRaw) || 1);

    const state = useProto.getState() as {
      metadataColumns: MetadataColumn[] | null;
    };
    const liveCols = state.metadataColumns ?? [];

    const updated = liveCols.map((c) => {
      if (c.groupIndex !== col.groupIndex) return c;
      const factorLevels = n;
      const values: Record<MetadataPhaseKey, string[]> = {} as any;
      PHASE_KEYS.forEach((k) => {
        const arr = [...(c.values[k] || [])];
        const base = arr[0] ?? "";
        const next: string[] = [];
        for (let i = 0; i < factorLevels; i++) {
          next[i] = arr[i] ?? base;
        }
        (values as any)[k] = next;
      });
      return { ...c, isFactor: factorLevels > 1, factorLevels, values };
    });
    setMetadataColumns(updated);
  }

  function updateCell(
    col: MetadataColumn,
    phase: MetadataPhaseKey,
    levelIndex: number,
    value: string
  ) {
    const updated = cols.map((c) => {
      if (c.groupIndex !== col.groupIndex) return c;

      // Clone all phase arrays so we never mutate in-place
      const nextValues: Record<MetadataPhaseKey, string[]> = {
        night: [...(c.values.night || [])],
        dayAdapt: [...(c.values.dayAdapt || [])],
        day: [...(c.values.day || [])],
        nightAdapt: [...(c.values.nightAdapt || [])],
      };

      if (c.constant) {
        // Constant columns: single full-day value per factor level.
        // Any edit (night/day/...) must propagate to ALL 4 phases so
        // day, dayAdapt, night and nightAdapt stay identical.
        PHASE_KEYS.forEach((k) => {
          nextValues[k][levelIndex] = value;
        });
      } else {
        // Non-constant groups: only 2 independent values per level.
        // Enforce: dayAdapt == day, nightAdapt == night.
        if (phase === "day" || phase === "dayAdapt") {
          nextValues.day[levelIndex] = value;
          nextValues.dayAdapt[levelIndex] = value;
        } else if (phase === "night" || phase === "nightAdapt") {
          nextValues.night[levelIndex] = value;
          nextValues.nightAdapt[levelIndex] = value;
        }
      }

      return { ...c, values: nextValues };
    });

    setMetadataColumns(updated);
  }


  function toggleTimeFactor() {
    const state = useProto.getState() as {
      metadataTime: MetadataTime | null;
    };
    const liveTime = state.metadataTime;
    if (!liveTime) return;

    const isFactor = !liveTime.isFactor;
    const factorLevels = isFactor ? Math.max(2, liveTime.factorLevels || 2) : 1;
    const values: Record<MetadataPhaseKey, string[]> = {} as any;
    PHASE_KEYS.forEach((k) => {
      const arr = [...(liveTime.values[k] || [])];
      const base = arr[0] ?? "";
      const next: string[] = [];
      for (let i = 0; i < factorLevels; i++) {
        next[i] = arr[i] ?? base;
      }
      (values as any)[k] = next;
    });
    setMetadataTime({ ...liveTime, isFactor, factorLevels, values });
  }

  function updateTimeFactorLevels(levelsRaw: string) {
    const n = Math.max(1, Number(levelsRaw) || 1);

    const state = useProto.getState() as {
      metadataTime: MetadataTime | null;
    };
    const liveTime = state.metadataTime;
    if (!liveTime) return;

    const factorLevels = n;
    const values: Record<MetadataPhaseKey, string[]> = {} as any;
    PHASE_KEYS.forEach((k) => {
      const arr = [...(liveTime.values[k] || [])];
      const base = arr[0] ?? "";
      const next: string[] = [];
      for (let i = 0; i < factorLevels; i++) {
        next[i] = arr[i] ?? base;
      }
      (values as any)[k] = next;
    });
    setMetadataTime({
      ...liveTime,
      isFactor: factorLevels > 1,
      factorLevels,
      values,
    });
  }

  function updateTimeCell(phase: MetadataPhaseKey, levelIndex: number, value: string) {
    const state = useProto.getState() as {
      metadataTime: MetadataTime | null;
    };
    const liveTime = state.metadataTime;
    if (!liveTime) return;

    const values: Record<MetadataPhaseKey, string[]> = {} as any;
    PHASE_KEYS.forEach((k) => {
      const arr = [...(liveTime.values[k] || [])];
      if (k === phase) {
        arr[levelIndex] = value;
      }
      (values as any)[k] = arr;
    });
    setMetadataTime({ ...liveTime, values });
  }
  
  function renderTimeHeader() {
    if (!time) {
      // When Time isn't initialised yet (before Read current)
      return (
        <th style={{ padding: "4px", border: "1px solid #ddd", verticalAlign: "top" }}>
          <div style={{ fontWeight: "bold" }}>Time</div>
        </th>
      );
    }

  return (
    <th style={{ padding: "4px", border: "1px solid #ddd", verticalAlign: "top" }}>
      <div style={{ fontSize: "0.8em" }}>
        {/* no Constant checkbox for Time */}
        <label style={{ display: "block" }}>
          <input
            type="checkbox"
            checked={time.isFactor}
            onChange={toggleTimeFactor}
          />{" "}
          Exp. Factor, Num:{" "}
          <input
            type="number"
            min={1}
            value={time.factorLevels}
            onChange={(e) => updateTimeFactorLevels(e.target.value)}
            style={{ width: 50 }}
          />
        </label>
      </div>
      <div style={{ marginTop: 4, fontWeight: "bold" }}>Time</div>
    </th>
  );
}

  function renderTimeCell(phase: MetadataPhaseKey) {
    if (!time) {
      return (
        <td
          key={`time-${phase}`}
          style={{ padding: "4px", border: "1px solid #ddd", minWidth: 120 }}
        >
          {/* empty until Read current */}
        </td>
      );
    }

    const arr = time.values[phase] || [];
    const levels = time.isFactor ? time.factorLevels : 1;
    const inputs = [];

    for (let i = 0; i < levels; i++) {
      const raw = arr[i] ?? "";
      inputs.push(
        <input
          key={`time-${phase}-${i}`}
          type="text"
          value={raw}
          placeholder={
            phase === "night"
              ? "e.g. 07:30:00"
              : phase === "day"
              ? "e.g. 15:30:00"
              : ""
          }
          onChange={(e) => updateTimeCell(phase, i, e.target.value)}
          title="Duration (HH:MM:SS or D.HH:MM:SS)"
          style={{ width: 100, marginRight: 4 }}
        />
      );
    }

    return (
      <td
        key={`time-${phase}`}
        style={{ padding: "4px", border: "1px solid #ddd", minWidth: 120 }}
      >
        {inputs}
      </td>
    );
  }


  function renderHeaderCell(col: MetadataColumn) {
    const range = getRangeForGroup(col.groupName);
    const rangeLabel = range
      ? (() => {
          const scale = range.scale ?? 1;
          const min = range.min / scale;
          const max = range.max / scale;
          return `${min} – ${max}`;
        })()
      : "";

    return (
      <th
        key={col.groupIndex}
        style={{ padding: "4px", border: "1px solid #ddd", verticalAlign: "top" }}
      >
        <div style={{ fontSize: "0.8em" }}>
          <label style={{ display: "block" }}>
            <input
              type="checkbox"
              checked={col.constant}
              onChange={() => toggleConstant(col)}
            />{" "}
            Constant
          </label>
          <label style={{ display: "block", marginTop: 4 }}>
            <input
              type="checkbox"
              checked={col.isFactor}
              onChange={() => toggleFactor(col)}
            />{" "}
            Exp. Factor, Num:{" "}
            <input
              type="number"
              min={1}
              value={col.factorLevels}
              onChange={(e) => updateFactorLevels(col, e.target.value)}
              style={{ width: 50 }}
            />
          </label>
        </div>
        <div style={{ marginTop: 4, fontWeight: "bold" }}>{col.groupName}</div>
        {rangeLabel && (
          <div style={{ fontSize: "0.75em", color: "#666" }}>Range: {rangeLabel}</div>
        )}
      </th>
    );
  }

  function renderValueCell(col: MetadataColumn, phase: MetadataPhaseKey) {
    const arr = col.values[phase] || [];
    const levels = col.isFactor ? col.factorLevels : 1;

    // For constant columns, only show input on first row, ghost on others
    const isFirstRow = phase === "night";
    if (col.constant && !isFirstRow) {
      return (
        <td
          key={col.groupIndex}
          style={{
            padding: "4px",
            border: "1px solid #eee",
            textAlign: "center",
            color: "#888",
          }}
        >
          same
        </td>
      );
    }

    const inputs = [];
    for (let i = 0; i < levels; i++) {
      const raw = arr[i] ?? "";
      const validation = validateHumanValue(col.groupName, raw);

      inputs.push(
        <input
          key={`${col.groupIndex}-${phase}-${i}`}
          type="number"
          step="any"
          value={raw}
          onChange={(e) => updateCell(col, phase, i, e.target.value)}
          title={validation.ok ? "" : validation.message}
          style={{
            width: 70,
            marginRight: 4,
            border: validation.ok ? "1px solid #ccc" : "1px solid #d33",
            backgroundColor: validation.ok ? "white" : "#ffecec",
          }}
        />
      );
    }

    return (
      <td key={col.groupIndex} style={{ padding: "4px", border: "1px solid #ddd" }}>
        {inputs}
      </td>
    );
  }




  return (
    <div key={hardKey}>
      <div>
          <p><b>Note:</b> Use this page <b>only if</b> you're using (or want to create) a <b><i>standard 1-day style protocol</i></b>.</p>
          <p className="text-sm text-slate-500">A <i>standard 1-day style protocol</i> is a 24-hour protocol that has time 4 periods: Night (Const, dark and/or low temp), Day adapt (Ramp, moving condition to Day), Day (Const, bright and/or high temp), Night adapt (Ramp, moving to Night). It's of a /‾‾‾‾\___ shape. Most protocols in Reference Protocols are of this type. </p>
          <br />
          <p>This tab is for generating <b>MIAPPE-style</b> <i>Environment</i> or <i>Experimental Factor</i> list.
          <br /><i>Environment</i> is defined as what's being kept constant throughout the experiment across all different groups.
          <br /><i>Experimental Factor</i> is the controlled variables (and thus will have at least 2 groups, e.g. normal temperature versus cold exposure).</p>
          <br />
      </div>
          <div className="text-sm text-slate-500">
          <p>Click <b>Read current</b> to automatically parse current protocol from Editor (this will only work if the current protocol contains at least ramp-const-ramp-const structure, and the time period must match if there's multiple). Click <b>Generate protocol</b> to translate this table into protocol, and load to Editor. ⚠️Be careful that these 2 buttons will overwrite your current metadata table or current protocol in Editor.</p>
          <p>Check <b>Constant</b> if the field will not change over time. Check <b>Exp. Factor</b> box if you are using this condition as a controlled variable. Adjust the <b>Num</b> of groups based on your experiment design (e.g. 3 if you have 3 temperature groups). <b>Note:</b> when generating protocol with Exp. Factor fields, the first value will be used.</p>
          <br />
      </div>
      <div
        style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}
      >
        <div>
          <button onClick={handleReadCurrent} className="px-3 py-1.5 text-sm border rounded">Read current</button>{" "}
          <button onClick={handleGenerateProtocol} className="px-3 py-1.5 text-sm border rounded">Generate protocol</button>{" "}
          {status && (
            <span style={{ marginLeft: 8, fontSize: "0.85em", color: "#666" }}>
              {status}
            </span>
          )}
        </div>
        <div>
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
        onClick={handleDownload}>Download csv</button>
        </div>
      </div>

      <div style={{ marginTop: 16, overflowX: "auto" }}>
        {!cols.length ? (
          <p style={{ fontStyle: "italic", color: "#666" }}>
            No metadata loaded. Click &ldquo;Read current&rdquo; to populate from the current
            protocol.
          </p>
        ) : (
          <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 700 }}>
            <thead>
              <tr>
                <th style={{ padding: "4px", border: "1px solid #ddd" }}>Phase</th>
                {renderTimeHeader()}
                {cols.map((col) => renderHeaderCell(col))}
              </tr>
            </thead>
            <tbody>
              {PHASE_KEYS.map((phase) => (
                <tr key={phase}>
                  <td
                    style={{
                      padding: "4px",
                      border: "1px solid #ddd",
                      fontWeight: "bold",
                      minWidth: 110,
                    }}
                  >
                    {phase === "night"
                      ? "Night"
                      : phase === "dayAdapt"
                      ? "Day adapt"
                      : phase === "day"
                      ? "Day"
                      : "Night adapt"}
                  </td>
                  {renderTimeCell(phase)}
                  {cols.map((col) => renderValueCell(col, phase))}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
