import React, { useEffect, useMemo, useRef, useState } from "react";
import * as Store from "../state/store";
import { PROFILES, type ProfileKey } from "../profiles";
import { RANGES } from "../ranges";
import { formatDurationPreserveDays } from "../utils/time";
import { ROOM_CONFIGS } from "../utils/rooms";

const useProto: any = (Store as any).useProto ?? (Store as any).useStore;

/**
 * React version of the Python script:
 * - Reads a CSV of rows shaped like [seconds, value] (index-based, no headers).
 * - Groups consecutive identical values and sums seconds per run.
 * - Rounds numeric values to 1 decimal.
 * - Auto-detects delimiter (",", ";", "\t", "|") unless user specifies one.
 * - Skips rows with invalid seconds or insufficient columns.
 * - Emits: { phases: [{ type: "csv-import", points: [[HH:MM:SS, value], ...] }] }
 */

/* ===================== Helpers ===================== */

type AnalyzeOptions = {
  secondsIndex: number;
  valueIndex: number;
  delimiter?: string | null;
  verbose?: boolean;
};

type Phase = { value: any; duration_seconds: number };
type ImportMode = "single" | "combined";

type CsvTargetOption = {
  name: string;
  unit: string;
  rangeKey: string;
  isLamp: boolean;
};

type ParsedEntry = {
  target: CsvTargetOption;
  header: string;
  phases: Phase[];
  points: [string, any][];
  out: { phases: Array<{ type: "csv-import"; points: [string, any][] }> };
};

type ParseResult =
  | { kind: "single"; phases: Phase[]; points: [string, any][]; out: { phases: Array<{ type: "csv-import"; points: [string, any][] }> } }
  | { kind: "combined"; secondsHeader: string; entries: ParsedEntry[]; unmatchedHeaders: string[] };

function formatHHMMSS(totalSec: number): string {
  const sec = Math.trunc(Number(totalSec) || 0);
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}

function tryParseNumber(v: any): number | string | "" {
  if (v === null || v === undefined) return "";
  const s = String(v).trim();
  if (!s) return "";
  const f = Number(s);
  if (!Number.isFinite(f)) return s;
  return Number.isInteger(f) ? parseInt(String(f), 10) : f;
}

function sniffDelimiter(sample: string): string {
  const candidates = [",", ";", "\t", "|"];
  let best = ",";
  let bestCount = -1;
  for (const d of candidates) {
    const re = new RegExp(`\\${d}`, "g");
    const count = (sample.match(re) || []).length;
    if (count > bestCount) {
      bestCount = count;
      best = d;
    }
  }
  return best;
}

function splitCSVLine(line: string, delimiter: string): string[] {
  const cells: string[] = [];
  let cur = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === delimiter) {
        cells.push(cur);
        cur = "";
      } else {
        cur += ch;
      }
    }
  }

  cells.push(cur);
  return cells;
}

function analyzeSimpleRows(
  rows: string[][],
  { secondsIndex, valueIndex, verbose }: Omit<AnalyzeOptions, "delimiter">,
): { phases: Phase[]; durMap: Record<number, any> } {
  const phases: Phase[] = [];
  let totalRows = 0;
  let prevValue: any = null;
  let runDuration = 0;

  for (const cells of rows) {
    const allBlank = cells.every((c) =>
      (typeof c === "string" ? c : String(c)).trim() === "",
    );
    if (allBlank) continue;

    totalRows += 1;
    const needed = Math.max(secondsIndex, valueIndex) + 1;
    if (cells.length < needed) {
      if (verbose) {
        console.warn(
          `[WARN] Row ${totalRows}: expected >= ${needed} columns, got ${cells.length} -> skipping`,
        );
      }
      continue;
    }

    const rawSec = cells[secondsIndex];
    const rawVal = cells[valueIndex];

    const sec = tryParseNumber(rawSec);
    let val = tryParseNumber(rawVal);

    if (typeof val === "number" && Number.isFinite(val)) {
      val = Math.round((val + Number.EPSILON) * 10) / 10;
    }

    if (!(typeof sec === "number" && Number.isFinite(sec))) {
      if (verbose) {
        console.warn(
          `[WARN] Row ${totalRows}: invalid seconds=${JSON.stringify(rawSec)} -> skipping`,
        );
      }
      continue;
    }

    if (verbose) {
      console.log(`[ROW ${totalRows}] cells=`, cells);
      console.log(`  -> seconds=${sec}, value=${JSON.stringify(val)}`);
    }

    if (totalRows === 1) {
      prevValue = val;
      runDuration = Number(sec);
      if (verbose) {
        console.log(
          `  -> Start new run: value=${JSON.stringify(prevValue)}, duration=${runDuration}`,
        );
      }
      continue;
    }

    if (val === prevValue) {
      runDuration += Number(sec);
      if (verbose) console.log(`  -> Same value; extend duration to ${runDuration}`);
    } else {
      phases.push({
        value: prevValue,
        duration_seconds: Math.trunc(Math.round(runDuration)),
      });
      if (verbose) {
        console.log(
          `  -> Value changed: closed run value=${JSON.stringify(prevValue)}, duration=${runDuration}`,
        );
      }
      prevValue = val;
      runDuration = Number(sec);
      if (verbose) {
        console.log(
          `  -> Start new run: value=${JSON.stringify(prevValue)}, duration=${runDuration}`,
        );
      }
    }
  }

  if (totalRows > 0) {
    phases.push({
      value: prevValue,
      duration_seconds: Math.trunc(Math.round(runDuration)),
    });
    if (verbose) {
      console.log(
        `[INFO] Closed final run value=${JSON.stringify(prevValue)}, duration=${runDuration}`,
      );
    }
  }

  const durMap: Record<number, any> = {};
  for (const ph of phases) {
    const d = Math.trunc(ph.duration_seconds);
    if (durMap[d] !== undefined && verbose) {
      console.warn(
        `[WARN] Duplicate duration ${d}; overriding ${JSON.stringify(durMap[d])} -> ${JSON.stringify(ph.value)}`,
      );
    }
    durMap[d] = ph.value;
  }

  return { phases, durMap };
}

function analyzeSimpleFromText(
  text: string,
  { secondsIndex, valueIndex, delimiter, verbose }: AnalyzeOptions,
): { phases: Phase[]; durMap: Record<number, any> } {
  const sample = text.slice(0, 4096);
  const delim = delimiter ?? sniffDelimiter(sample);
  if (verbose) console.log("[INFO] Using delimiter:", JSON.stringify(delim));
  if (verbose) {
    console.log(
      `[INFO] Index-based parsing. secondsIndex=${secondsIndex}, valueIndex=${valueIndex}`,
    );
  }

  const rows = text
    .split(/\r?\n/)
    .filter((line) => line && !/^\s*$/.test(line))
    .map((line) => splitCSVLine(line, delim));

  return analyzeSimpleRows(rows, { secondsIndex, valueIndex, verbose });
}

function getGroupName(group: any): string {
  return String(group?.["group-name"] ?? group?.name ?? "").trim();
}

function normalizeTargetKey(value: string): string {
  return String(value || "").toLowerCase().replace(/[\s_-]+/g, "");
}

function resolveRangeKey(group: any): string {
  const nameKey = normalizeTargetKey(getGroupName(group));
  const typeKey = normalizeTargetKey(String(group?.type ?? ""));
  const map: Record<string, string> = {
    amber: "Amber",
    blue: "Blue",
    co2: "CO2",
    coolwhite: "Cool White",
    cyan: "Cyan",
    deepred: "DeepRed",
    farred: "FarRed",
    green: "Green",
    humidity: "Humidity",
    hydroponics: "Hydroponics",
    red: "Red",
    temperature: "Temperature",
    uva: "UVA",
    uvb: "UVB",
    white: "Cool White",
  };

  return map[typeKey] ?? map[nameKey] ?? getGroupName(group);
}

function getInputRange(rangeKey: string, profile: ProfileKey) {
  if (rangeKey === "Temperature") {
    return {
      min: profile === "G7" ? -4 : 4,
      max: 42,
      int: false,
      scale: 10,
    };
  }

  const range = RANGES[rangeKey] ?? { min: 0, max: 100, int: true };
  return {
    min: range.min,
    max: range.max,
    int: range.int !== false,
    scale: range.scale,
  };
}

function formatRangeValue(value: number, unit: string) {
  if (unit === "celsius") return `${value} °C`;
  if (unit === "percent") return `${value}%`;
  if (unit === "ppm") return `${value} ppm`;
  return String(value);
}

function phasesToPoints(phases: Phase[]): [string, any][] {
  const points: [string, any][] = [];
  for (const ph of phases) {
    const dur = Number(ph?.duration_seconds ?? 0);
    if (dur > 0) points.push([formatDurationPreserveDays(dur), ph.value]);
  }
  return points;
}

function parseCombinedCsvText(
  text: string,
  {
    delimiter,
    verbose,
    targetOptions,
  }: {
    delimiter?: string | null;
    verbose?: boolean;
    targetOptions: CsvTargetOption[];
  },
): { secondsHeader: string; entries: ParsedEntry[]; unmatchedHeaders: string[] } {
  const sample = text.slice(0, 4096);
  const delim = delimiter ?? sniffDelimiter(sample);
  const lines = text.split(/\r?\n/).filter((line) => line && !/^\s*$/.test(line));
  if (lines.length < 2) {
    throw new Error("Combined CSV needs a header row and at least one data row.");
  }

  const headers = splitCSVLine(lines[0], delim).map((cell) => String(cell).trim());
  const dataRows = lines.slice(1).map((line) => splitCSVLine(line, delim));
  const normalizedHeaders = headers.map((header) => normalizeTargetKey(header));
  const secondsIndex = normalizedHeaders.findIndex((header) =>
    new Set(["seconds", "second", "sec", "time", "times", "time_s"]).has(header),
  );
  const resolvedSecondsIndex = secondsIndex >= 0 ? secondsIndex : 0;

  const headerIndexByKey = new Map<string, number>();
  headers.forEach((header, index) => {
    const key = normalizeTargetKey(header);
    if (key && !headerIndexByKey.has(key)) headerIndexByKey.set(key, index);
  });

  const usedColumnIndices = new Set<number>([resolvedSecondsIndex]);
  const entries: ParsedEntry[] = [];

  for (const target of targetOptions) {
    const candidateKeys = Array.from(
      new Set([normalizeTargetKey(target.name), normalizeTargetKey(target.rangeKey)].filter(Boolean)),
    );
    const valueIndex = candidateKeys
      .map((key) => headerIndexByKey.get(key))
      .find(
        (index): index is number =>
          index != null && index !== resolvedSecondsIndex && !usedColumnIndices.has(index),
      );

    if (valueIndex == null) continue;
    usedColumnIndices.add(valueIndex);

    const { phases } = analyzeSimpleRows(dataRows, {
      secondsIndex: resolvedSecondsIndex,
      valueIndex,
      verbose,
    });
    const points = phasesToPoints(phases);
    entries.push({
      target,
      header: headers[valueIndex],
      phases,
      points,
      out: { phases: [{ type: "csv-import", points }] },
    });
  }

  if (entries.length === 0) {
    throw new Error(
      "No parameter columns matched the current protocol. Use a header row like: seconds, Temperature, Humidity, CO2, Cool White.",
    );
  }

  const unmatchedHeaders = headers.filter((_, index) => !usedColumnIndices.has(index));
  return {
    secondsHeader: headers[resolvedSecondsIndex] || "seconds",
    entries,
    unmatchedHeaders,
  };
}

/* ===================== UI Component ===================== */

export default function CsvPhaseAnalyzer() {
  const secondsIndex = 0;
  const valueIndex = 1;
  const [importMode, setImportMode] = useState<ImportMode>("single");
  const [delimiter, setDelimiter] = useState<string>("");
  const [verbose] = useState(false);
  const [targetParam, setTargetParam] = useState<string>("");

  const protocol = useProto((s: any) => s.protocol);
  const setProtocol = useProto((s: any) => s.setProtocol);
  const profile = useProto((s: any) => s.profile) as ProfileKey;

  const [fileName, setFileName] = useState<string>("");
  const [rawText, setRawText] = useState<string>("");
  const [error, setError] = useState<string>("");

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const protocolParts = protocol?.sections?.[0]?.parts ?? [];
  const roomConfig = ROOM_CONFIGS[profile];
  const roomLampSummary = roomConfig?.channels.map((channel) => channel.label).join(", ") ?? "";

  const targetOptions = useMemo<CsvTargetOption[]>(() => {
    const sourceParts = protocolParts.length ? protocolParts : PROFILES[profile]?.groups ?? [];
    const lampGroups = new Set(
      roomConfig?.channels.map((channel) => channel.protocolGroupName) ?? [],
    );
    const seen = new Set<string>();

    return sourceParts
      .map((part: any) => {
        const name = getGroupName(part);
        if (!name || seen.has(name)) return null;
        seen.add(name);
        return {
          name,
          unit: String(part?.unit ?? ""),
          rangeKey: resolveRangeKey(part),
          isLamp: lampGroups.has(name),
        };
      })
      .filter((option): option is CsvTargetOption => option !== null);
  }, [protocolParts, profile, roomConfig]);

  const selectedTarget = useMemo(
    () => targetOptions.find((option) => option.name === targetParam) ?? null,
    [targetOptions, targetParam],
  );

  const selectedTargetRange = useMemo(
    () => (selectedTarget ? getInputRange(selectedTarget.rangeKey, profile) : null),
    [selectedTarget, profile],
  );

  useEffect(() => {
    if (!targetOptions.length) {
      if (targetParam) setTargetParam("");
      return;
    }
    if (!targetOptions.some((option) => option.name === targetParam)) {
      setTargetParam(targetOptions[0].name);
    }
  }, [targetOptions, targetParam]);

  const result = useMemo<null | ParseResult | { error: string }>(() => {
    if (!rawText) return null;
    try {
      if (importMode === "combined") {
        return {
          kind: "combined",
          ...parseCombinedCsvText(rawText, {
            delimiter: delimiter ? delimiter : undefined,
            verbose,
            targetOptions,
          }),
        };
      }

      const { phases } = analyzeSimpleFromText(rawText, {
        secondsIndex,
        valueIndex,
        delimiter: delimiter ? delimiter : undefined,
        verbose,
      });
      const points = phasesToPoints(phases);
      return { kind: "single", phases, points, out: { phases: [{ type: "csv-import", points }] } };
    } catch (e: any) {
      console.error(e);
      return { error: e?.message || String(e) };
    }
  }, [rawText, delimiter, importMode, targetOptions, verbose]);

  function onPickFileClick() {
    fileInputRef.current?.click();
  }

  function onFileChosen(file: File) {
    setError("");
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = () => {
      setRawText(String(reader.result || ""));
    };
    reader.onerror = () => setError("Failed to read the file.");
    reader.readAsText(file, "utf-8");
  }

  function mapValueForTarget(target: CsvTargetOption | null, v: any): number {
    if (typeof v !== "number" || !Number.isFinite(v)) return 0;
    if (!target) return Math.round(v);
    const range = getInputRange(target.rangeKey, profile);

    if (target.rangeKey === "Temperature") {
      return Math.round(v * range.scale);
    }

    let next = range.int ? Math.round(v) : v;
    next = Math.max(range.min, Math.min(range.max, next));

    if (range.scale) next *= range.scale;
    return Math.round(next);
  }

  function applyToProtocol() {
    if (!result || "error" in result) return;
    try {
      const next =
        typeof structuredClone === "function"
          ? structuredClone(protocol)
          : JSON.parse(JSON.stringify(protocol));
      const parts = next?.sections?.[0]?.parts || [];

      const entries =
        result.kind === "combined"
          ? result.entries
          : selectedTarget
            ? [{ target: selectedTarget, header: selectedTarget.name, phases: result.phases, points: result.points, out: result.out }]
            : [];

      if (!entries.length) {
        alert("No target parameter is available for the current room.");
        return;
      }

      const warnings = entries
        .map((entry) => {
          const range = getInputRange(entry.target.rangeKey, profile);
          const bad = entry.points
            .map(([, v]) => (typeof v === "number" ? v : Number(v)))
            .filter((v) => Number.isFinite(v) && (v < range.min || v > range.max));
          if (!bad.length) return "";
          const examples = [...new Set(bad)]
            .slice(0, 4)
            .map((v) => formatRangeValue(v, entry.target.unit))
            .join(", ");
          return `${entry.target.name}: ${bad.length} out of range (${formatRangeValue(range.min, entry.target.unit)}-${formatRangeValue(range.max, entry.target.unit)}), e.g. ${examples}`;
        })
        .filter(Boolean);

      if (warnings.length > 0) {
        const ok = window.confirm(
          `Some CSV values are outside the allowed range for ${profile}:\n\n${warnings.join("\n")}\n\nApply anyway?`,
        );
        if (!ok) return;
      }

      const appliedGroups: string[] = [];
      for (const entry of entries) {
        const points = entry.points
          .filter(([t]) => !!t)
          .map(([t, v]) => [t, mapValueForTarget(entry.target, v)] as [string, number]);
        const replaced = [{ type: "csv-import", points } as any];
        const groupName = entry.target.name;
        const gi = parts.findIndex((p: any) => (p["group-name"] || p.name) === groupName);
        if (gi < 0) {
          alert(`Group not found in current protocol: ${groupName}`);
          return;
        }
        parts[gi].phases = replaced;
        appliedGroups.push(groupName);
      }

      for (const p of parts) {
        if (p && p["group-name"] == null && p.name) p["group-name"] = p.name;
      }
      next.sections[0].parts = parts;
      setProtocol(next);
      window.dispatchEvent(
        new CustomEvent("protocol:save-draft", { detail: { protocol: next } }),
      );
      alert(
        result.kind === "combined"
          ? `${appliedGroups.length} parameter groups replaced from one CSV: ${appliedGroups.join(", ")}.`
          : `${appliedGroups[0]} phases replaced from CSV (1 phase set).`,
      );
    } catch (e: any) {
      alert("Failed to apply phases: " + (e?.message || String(e)));
    }
  }

  return (
    <div className="max-w-4xl mx-auto p-4 space-y-4">
      <h2 className="text-xl font-semibold">Import Time-Series CSV</h2>
      <p className="text-sm text-slate-600">
        Import a second-by-second time series and automatically convert it into a structured phase
        schedule. This option is ideal when you already have a predefined program, such as:
      </p>
      <ul className="text-sm text-slate-600 list-disc list-inside space-y-1 ml-1">
        <li>A light pulse pattern for one room-specific lamp channel</li>
        <li>A measured temperature schedule</li>
        <li>A precise step program created in Excel</li>
      </ul>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <button
          type="button"
          onClick={() => setImportMode("single")}
          className={`rounded border p-3 text-left ${importMode === "single" ? "border-indigo-500 bg-indigo-50" : "border-slate-200 bg-white"}`}
        >
          <div className="text-sm font-semibold text-slate-800">Single Parameter CSV</div>
          <div className="mt-1 text-xs text-slate-600">One file with `seconds, value` for one selected parameter.</div>
        </button>
        <button
          type="button"
          onClick={() => setImportMode("combined")}
          className={`rounded border p-3 text-left ${importMode === "combined" ? "border-indigo-500 bg-indigo-50" : "border-slate-200 bg-white"}`}
        >
          <div className="text-sm font-semibold text-slate-800">Combined CSV</div>
          <div className="mt-1 text-xs text-slate-600">One file with a header row and multiple parameter columns at once.</div>
        </button>
      </div>

      <div
        style={{
          background: "#f8fafc",
          border: "1px solid #e2e8f0",
          borderRadius: 8,
          padding: "12px 16px",
        }}
      >
        <div className="text-sm font-semibold text-slate-700" style={{ marginBottom: 6 }}>
          Required format
        </div>
        <ul className="text-sm text-slate-600 list-disc list-inside space-y-1">
          {importMode === "single" ? (
            <>
              <li>
                Two columns per row: <code>seconds, value</code>
              </li>
              <li>
                <b>No header row!</b>
              </li>
            </>
          ) : (
            <>
              <li>
                One header row is required, for example: <code>seconds, Temperature, Humidity, CO2</code>
              </li>
              <li>
                First column should be <code>seconds</code>, <code>sec</code>, or <code>time</code>
              </li>
              <li>Each extra column header should match a protocol parameter name such as Temperature, CO2, Humidity, Cool White, DeepRed, FarRed, Blue, Red, UVA, or UVB</li>
            </>
          )}
          <li>Delimiter can be comma, semicolon, or tab</li>
          <li>
            See{" "}
            <a
              href="https://drive.google.com/drive/folders/1mkEiaF3XQERiai2J5IFtx8lXEVUDUHWX?usp=sharing"
              target="_blank"
              rel="noreferrer"
              className="text-blue-700 underline"
            >
              this Google Drive folder
            </a>{" "}
            for 2 example CSVs
          </li>
        </ul>
        <div
          className="text-sm font-semibold text-slate-700"
          style={{ marginTop: 10, marginBottom: 4 }}
        >
          Example (conceptual)
        </div>
        <pre
          style={{
            background: "#f1f5f9",
            borderRadius: 6,
            padding: "6px 10px",
            fontSize: 12,
            color: "#334155",
            margin: 0,
          }}
        >{importMode === "single"
          ? `0, 10\n1, 10\n2, 10\n3, 20`
          : `seconds,Temperature,Humidity,CO2,Cool White\n0,20.0,70,420,0\n1,20.0,70,420,0\n2,20.5,70,420,25\n3,21.0,68,450,25`}</pre>
      </div>

      <div
        style={{
          background: "#f0fdf4",
          border: "1px solid #bbf7d0",
          borderRadius: 8,
          padding: "12px 16px",
        }}
      >
        <div className="text-sm font-semibold text-slate-700" style={{ marginBottom: 6 }}>
          What happens automatically
        </div>
        <ul className="text-sm text-slate-600 list-disc list-inside space-y-1">
          <li>The delimiter is detected automatically</li>
          <li>Consecutive identical values are grouped into single phases</li>
          <li>Seconds are summed into phase durations</li>
          <li>Values are rounded to one decimal place (for stability and readability)</li>
        </ul>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 items-end">
        {importMode === "single" ? (
          <div>
            <label className="block text-sm font-medium mb-1">Target parameter</label>
            <select
              className="border rounded p-2 w-full"
              value={targetParam}
              onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setTargetParam(e.target.value)}
              disabled={!targetOptions.length}
            >
              {targetOptions.map((option) => (
                <option key={option.name} value={option.name}>
                  {option.name}
                </option>
              ))}
            </select>
            <div className="mt-1 text-xs text-slate-500">
              Current room: {profile}. Room-specific lamp channels: {roomLampSummary || "none"}.
            </div>
            {selectedTarget && selectedTargetRange && (
              <div className="mt-1 text-xs text-slate-500">
                Allowed CSV values for {selectedTarget.name}:{" "}
                {formatRangeValue(selectedTargetRange.min, selectedTarget.unit)}-
                {formatRangeValue(selectedTargetRange.max, selectedTarget.unit)}
                {selectedTarget.isLamp ? " (room lamp channel)" : ""}.
              </div>
            )}
          </div>
        ) : (
          <div>
            <label className="block text-sm font-medium mb-1">Detected parameter columns</label>
            <div className="border rounded p-2 min-h-[42px] bg-slate-50 text-sm text-slate-700">
              {targetOptions.map((option) => option.name).join(", ")}
            </div>
            <div className="mt-1 text-xs text-slate-500">
              Current room: {profile}. Any matching columns in the uploaded combined CSV will be applied together.
            </div>
          </div>
        )}

        <div>
          <label className="block text-sm font-medium mb-1">
            Delimiter <span className="text-slate-500">(empty = auto)</span>
          </label>
          <input
            type="text"
            className="border rounded p-2 w-full"
            placeholder=", ; \\t |"
            value={delimiter}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setDelimiter(e.target.value)}
            maxLength={1}
          />
        </div>

        <div className="md:col-span-2 flex items-center gap-4">
          <button
            onClick={onPickFileClick}
            className="ml-auto border rounded px-3 py-2 text-sm bg-white hover:bg-slate-50"
          >
            {importMode === "single" ? "Choose Single CSV..." : "Choose Combined CSV..."}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,text/csv,text/plain"
            className="hidden"
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
              const f = e.target.files?.[0] as File | undefined;
              if (f) onFileChosen(f);
            }}
          />
        </div>
      </div>

      {fileName ? (
        <div className="text-sm text-slate-700">
          <b>File:</b> {fileName}
        </div>
      ) : null}

      {error ? <div className="text-sm text-red-600">Error: {error}</div> : null}

      {result && !("error" in result) ? (
        <>
          <div className="flex items-center gap-3">
            <button
              onClick={applyToProtocol}
              className="border rounded px-3 py-2 text-sm bg-indigo-600 text-white hover:bg-indigo-500"
              title={
                result.kind === "combined"
                  ? "Replace all matched protocol groups from this combined CSV"
                  : `Replace phases for ${selectedTarget?.name ?? targetParam} in current protocol`
              }
            >
              {result.kind === "combined" ? "Apply All Matched Columns" : "Apply to Protocol"}
            </button>
          </div>

          {result.kind === "single" ? (
            <>
              <div className="border rounded p-3">
                <div className="font-medium mb-2">Phase runs</div>
                <div className="overflow-auto">
                  <table className="w-full text-sm border-collapse">
                    <thead>
                      <tr className="border-b">
                        <th className="text-left py-1 pr-2">#</th>
                        <th className="text-left py-1 pr-2">Value</th>
                        <th className="text-right py-1 pr-2">Duration (s)</th>
                        <th className="text-right py-1 pr-2">Duration (HH:MM:SS)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.phases.map((ph: Phase, i: number) => (
                        <tr key={i} className="border-b">
                          <td className="py-1 pr-2">{i + 1}</td>
                          <td className="py-1 pr-2">{String(ph.value)}</td>
                          <td className="py-1 pr-2 text-right">{ph.duration_seconds}</td>
                          <td className="py-1 pr-2 text-right">{formatHHMMSS(ph.duration_seconds)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="border rounded p-3">
                <div className="font-medium mb-2">Points (HH:MM:SS, value)</div>
                <div className="text-xs text-slate-600 mb-2">Derived one-per-phase where duration &gt; 0.</div>
                <div className="overflow-auto">
                  <table className="w-full text-sm border-collapse">
                    <thead>
                      <tr className="border-b">
                        <th className="text-left py-1 pr-2">#</th>
                        <th className="text-left py-1 pr-2">HH:MM:SS</th>
                        <th className="text-left py-1 pr-2">Value</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.points.map(([t, v]: [string, any], i: number) => (
                        <tr key={i} className="border-b">
                          <td className="py-1 pr-2">{i + 1}</td>
                          <td className="py-1 pr-2">{t}</td>
                          <td className="py-1 pr-2">{String(v)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          ) : (
            <div className="border rounded p-3">
              <div className="font-medium mb-2">Matched Columns</div>
              <div className="text-xs text-slate-600 mb-2">
                Time column: <b>{result.secondsHeader}</b>. Each matched parameter column will replace the corresponding group in the current protocol.
              </div>
              <div className="overflow-auto">
                <table className="w-full text-sm border-collapse">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left py-1 pr-2">Parameter</th>
                      <th className="text-left py-1 pr-2">CSV column</th>
                      <th className="text-right py-1 pr-2">Phase runs</th>
                      <th className="text-right py-1 pr-2">Points</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.entries.map((entry) => (
                      <tr key={entry.target.name} className="border-b">
                        <td className="py-1 pr-2">{entry.target.name}</td>
                        <td className="py-1 pr-2">{entry.header}</td>
                        <td className="py-1 pr-2 text-right">{entry.phases.length}</td>
                        <td className="py-1 pr-2 text-right">{entry.points.length}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {result.unmatchedHeaders.length > 0 ? (
                <div className="mt-3 text-xs text-slate-500">
                  Ignored CSV columns: {result.unmatchedHeaders.join(", ")}
                </div>
              ) : null}
            </div>
          )}
        </>
      ) : rawText && result && "error" in result ? (
        <div className="text-sm text-red-600">Error: {result.error}</div>
      ) : null}
    </div>
  );
}
