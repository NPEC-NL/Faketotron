import React, { useEffect, useMemo, useState } from "react";
import * as Store from "../state/store";
import type { Protocol, Phase, PhaseConst, PhaseRamp } from "../profiles";
import { RANGES, type Range } from "../ranges";
import type { MetadataColumn } from "../state/store";
import { parseDurationToSeconds } from "../utils/time";

const useProto: any = (Store as any).useProto ?? (Store as any).useStore;

type PhaseKey = "night" | "dayAdapt" | "day" | "nightAdapt";

const PHASE_KEYS: PhaseKey[] = ["night", "dayAdapt", "day", "nightAdapt"];
const DAY_SECONDS = 24 * 60 * 60;

type CellValidation = {
  ok: boolean;
  message?: string;
};

type StandardDayPattern = {
  rampUpDuration: string;
  dayConstDuration: string;
  rampDownDuration: string;
  nightConstDuration: string;
  rampStep?: string;
};

type StandardDayDetection = {
  ok: boolean;
  reason?: string;
  pattern?: StandardDayPattern;
};

/**
 * Detects if the current protocol has at least one group with a
 * ramp→const→ramp→const pattern and longest duration = 1 day.
 * Returns an exemplar pattern we reuse when generating.
 */
function detectStandardDay(protocol: Protocol): StandardDayDetection {
  const parts = protocol.sections[0]?.parts || [];
  if (!parts.length) return { ok: false, reason: "Protocol has no groups" };

  let maxTotal = 0;
  let hasRampConstPattern = false;
  let chosenPattern: StandardDayPattern | undefined;

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
      if (p0.end === p1.value && p2.start === p1.value && p2.end === p3.value) {
        hasRampConstPattern = true;
        if (!chosenPattern) {
          chosenPattern = {
            rampUpDuration: p0.duration,
            dayConstDuration: p1.duration,
            rampDownDuration: p2.duration,
            nightConstDuration: p3.duration,
            rampStep: p0.step,
          };
        }
      }
    }
  }

  if (!hasRampConstPattern) {
    return { ok: false, reason: "No ramp→const→ramp→const day/night group found" };
  }

  if (Math.abs(maxTotal - DAY_SECONDS) > 1) {
    return {
      ok: false,
      reason: `Longest group duration is not 1 day (got ${maxTotal} seconds, expected ${DAY_SECONDS})`,
    };
  }

  return { ok: true, pattern: chosenPattern };
}

function getGroupName(g: any, index: number): string {
  // Works for both canonical (name) and legacy ("group-name") formats
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
  if (!raw.trim()) return { ok: true }; // empty is allowed; defaults handled later
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
 * Build initial metadata columns from the current protocol,
 * if it satisfies the “standard 1-day” constraints.
 */
function buildInitialColumnsFromProtocol(protocol: Protocol): MetadataColumn[] | null {
  const detection = detectStandardDay(protocol);
  if (!detection.ok || !detection.pattern) {
    alert(
      "Current protocol is not standard 1-day format: " +
        (detection.reason ?? "unknown reason")
    );
    return null;
  }

  const parts = protocol.sections[0]?.parts || [];
  if (!parts.length) {
    alert("Current protocol has no groups.");
    return null;
  }

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

    const values: Record<PhaseKey, string[]> = {
      night: [""],
      dayAdapt: [""],
      day: [""],
      nightAdapt: [""],
    };

    if (isFullDayConst) {
      const p = phases[0] as PhaseConst;
      const human = machineToHuman(name, p.value);
      const s = String(human);
      (Object.keys(values) as PhaseKey[]).forEach((k) => {
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

    // Try ramp→const→ramp→const (day/night pattern)
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
      // Fallback: use first const as both day & night if present
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
 * Reverse: take MetadataTab grid → new Protocol with:
 * - constant groups → single 1.00:00:00 const phase
 * - non-constant groups → ramp/const/ramp/const using the detected pattern
 *   (durations), values taken from metadata (first factor level only)
 */
function buildProtocolFromMetadata(protocol: Protocol, columns: MetadataColumn[]): Protocol {
  const detection = detectStandardDay(protocol);
  const pattern = detection.ok && detection.pattern
    ? detection.pattern
    : {
        rampUpDuration: "00:30:00",
        dayConstDuration: "15:30:00",
        rampDownDuration: "00:30:00",
        nightConstDuration: "07:30:00",
        rampStep: "00:00:05",
      };

  const parts = protocol.sections[0]?.parts || [];
  const newParts = parts.map((g: any, gi: number) => {
    const col =
      columns.find(
        (c) => c.groupIndex === gi || c.groupName === getGroupName(g, gi)
      ) ?? null;
    if (!col) return g;

    const name = col.groupName;
    const values = col.values;

    const firstNonEmpty = (phase: PhaseKey): number | null => {
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
        duration: "1.00:00:00", // D.HH:MM:SS for >= 24h
      };
      return { ...g, phases: [constPhase] };
    }

    // Non-constant: use first factor level only
    const dayHuman = firstNonEmpty("day") ?? 0;
    const nightHuman = firstNonEmpty("night") ?? dayHuman;
    const dayMachine = humanToMachine(name, dayHuman);
    const nightMachine = humanToMachine(name, nightHuman);

    const rampUp: PhaseRamp = {
      type: "ramp",
      start: nightMachine,
      end: dayMachine,
      duration: pattern.rampUpDuration,
      step: pattern.rampStep,
    };
    const constDay: PhaseConst = {
      type: "const",
      value: dayMachine,
      duration: pattern.dayConstDuration,
    };
    const rampDown: PhaseRamp = {
      type: "ramp",
      start: dayMachine,
      end: nightMachine,
      duration: pattern.rampDownDuration,
      step: pattern.rampStep,
    };
    const constNight: PhaseConst = {
      type: "const",
      value: nightMachine,
      duration: pattern.nightConstDuration,
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
  const blob = new Blob([text], { type: "text/csv;charset=utf-8" });
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

/** MIAPPE Environment CSV */
function buildEnvironmentCsv(columns: MetadataColumn[]): string {
  const lines: string[] = [];
  lines.push("Environment parameter,Environment parameter value");
  for (const col of columns) {
    if (col.isFactor) continue;
    if (col.constant) {
      const v = col.values.day[0] ?? col.values.night[0] ?? "";
      lines.push(`"${col.groupName}","${v}"`);
    } else {
      for (const phase of PHASE_KEYS) {
        const v = col.values[phase][0] ?? "";
        const label =
          phase === "night"
            ? "night"
            : phase === "dayAdapt"
            ? "day adapt"
            : phase === "day"
            ? "day"
            : "night adapt";
        lines.push(`"${col.groupName} ${label}","${v}"`);
      }
    }
  }
  return lines.join("\n");
}

/** MIAPPE Experimental Factor CSV */
function buildFactorCsv(columns: MetadataColumn[]): string | null {
  const factorCols = columns.filter((c) => c.isFactor);
  if (!factorCols.length) return null;

  const lines: string[] = [];
  lines.push("Experiment Factor type,Experiment Factor description,Experiment Factor values");

  for (const col of factorCols) {
    const levels = col.factorLevels || 1;
    const values: string[] = [];
    for (let i = 0; i < levels; i++) {
      const v = col.values.day[i] ?? "";
      values.push(v);
    }
    const valuesStr = values.join(";");
    const desc = `${col.groupName}_description`;
    lines.push(`"${col.groupName}","${desc}","${valuesStr}"`);
  }

  return lines.join("\n");
}

export default function MetadataTab() {
  const protocol: Protocol = useProto((s: any) => s.protocol);
  const colsFromStore: MetadataColumn[] | null = useProto(
    (s: any) => (s.metadataColumns as MetadataColumn[] | null) ?? null
  );
  const setMetadataColumns = useProto((s: any) => s.setMetadataColumns);
  const setProtocol = useProto((s: any) => s.setProtocol);

  const [hardKey, setHardKey] = useState(0);
  const [status, setStatus] = useState<string>("");

  // When a new protocol is loaded (from FilesTab etc.), clear metadata
  useEffect(() => {
    const onLoaded = () => {
      setMetadataColumns(null);
      setHardKey((k: number) => k + 1);
      setStatus("");
    };
    window.addEventListener("protocol:loaded", onLoaded);
    return () => window.removeEventListener("protocol:loaded", onLoaded);
  }, [setMetadataColumns]);

  const cols: MetadataColumn[] = useMemo(() => colsFromStore ?? [], [colsFromStore]);

  function handleReadCurrent() {
    const newCols = buildInitialColumnsFromProtocol(protocol);
    if (!newCols) return;
    setMetadataColumns(newCols);
    setStatus("Loaded from protocol");
    setTimeout(() => setStatus(""), 1500);
  }

  function handleGenerateProtocol() {
    if (!cols.length) {
      alert("No metadata defined to generate protocol from.");
      return;
    }

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

    // Validate ranges
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

    if (!window.confirm("This will overwrite the current protocol. Continue?")) return;

    const newProtocol = buildProtocolFromMetadata(protocol, cols);
    setProtocol(newProtocol);

    // Mirror GraphTab: notify others that a draft-like save happened
    window.dispatchEvent(
      new CustomEvent("protocol:save-draft", {
        detail: { protocol: newProtocol, reason: "metadata" },
      })
    );

    setStatus("Protocol generated");
    setTimeout(() => setStatus(""), 1500);
  }

  function handleDownload() {
    if (!cols.length) {
      alert("No metadata to download. Use 'Read current' first.");
      return;
    }
    const envCsv = buildEnvironmentCsv(cols);
    const facCsv = buildFactorCsv(cols);

    downloadText("environment.csv", envCsv);
    if (facCsv) {
      downloadText("experimental_factors.csv", facCsv);
    }
    setStatus("CSV downloaded");
    setTimeout(() => setStatus(""), 1500);
  }

  function toggleConstant(col: MetadataColumn) {
    const updated = cols.map((c) => {
      if (c.groupIndex !== col.groupIndex) return c;
      const constant = !c.constant;
      const values = { ...c.values };
      if (constant) {
        // collapse to single constant value (use day or night)
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
    const updated = cols.map((c) => {
      if (c.groupIndex !== col.groupIndex) return c;
      const isFactor = !c.isFactor;
      const factorLevels = isFactor ? Math.max(2, c.factorLevels || 2) : 1;
      const values: Record<PhaseKey, string[]> = {} as any;
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
    const factorLevels = n;
    const updated = cols.map((c) => {
      if (c.groupIndex !== col.groupIndex) return c;
      const values: Record<PhaseKey, string[]> = {} as any;
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
    phase: PhaseKey,
    levelIndex: number,
    value: string
  ) {
    const updated = cols.map((c) => {
      if (c.groupIndex !== col.groupIndex) return c;
      const values: Record<PhaseKey, string[]> = {} as any;
      PHASE_KEYS.forEach((k) => {
        const arr = [...(c.values[k] || [])];
        if (k === phase) {
          arr[levelIndex] = value;
        }
        (values as any)[k] = arr;
      });
      return { ...c, values };
    });
    setMetadataColumns(updated);
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

  function renderCell(col: MetadataColumn, phase: PhaseKey) {
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
          key={i}
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
      <div
        style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}
      >
        <div>
          <button onClick={handleReadCurrent}>Read current</button>{" "}
          <button onClick={handleGenerateProtocol}>Generate protocol</button>{" "}
          {status && (
            <span style={{ marginLeft: 8, fontSize: "0.85em", color: "#666" }}>
              {status}
            </span>
          )}
        </div>
        <div>
          <button onClick={handleDownload}>Download</button>
        </div>
      </div>

      <div style={{ marginTop: 16, overflowX: "auto" }}>
        {!cols.length ? (
          <p style={{ fontStyle: "italic", color: "#666" }}>
            No metadata loaded. Click &ldquo;Read current&rdquo; to populate from the current
            protocol.
          </p>
        ) : (
          <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 600 }}>
            <thead>
              <tr>
                <th style={{ padding: "4px", border: "1px solid #ddd" }}>
                  Phase / Time
                </th>
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
                  {cols.map((col) => renderCell(col, phase))}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
