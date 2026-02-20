import React, { useMemo, useRef, useState } from "react";
import * as Store from "../state/store";
import { formatDurationPreserveDays } from "../utils/time";
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
  delimiter?: string | null; // if null/undefined → auto sniff
  verbose?: boolean;
};

type Phase = { value: any; duration_seconds: number };

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
  if (!Number.isFinite(f)) return s; // keep as string if not numeric
  return Number.isInteger(f) ? parseInt(String(f), 10) : f;
}

// pick delimiter with most occurrences in sample
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

// RFC4180-ish line splitter with quotes
function splitCSVLine(line: string, delimiter: string): string[] {
  const cells: string[] = [];
  let cur = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"'; // escaped quote
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

function analyzeSimpleFromText(
  text: string,
  { secondsIndex, valueIndex, delimiter, verbose }: AnalyzeOptions
): { phases: Phase[]; durMap: Record<number, any> } {
  const sample = text.slice(0, 4096);
  const delim = delimiter ?? sniffDelimiter(sample);
  if (verbose) console.log("[INFO] Using delimiter:", JSON.stringify(delim));
  if (verbose)
    console.log(
      `[INFO] Index-based parsing. secondsIndex=${secondsIndex}, valueIndex=${valueIndex}`
    );

  const lines = text.split(/\r?\n/);
  const phases: Phase[] = [];
  let totalRows = 0;
  let prevValue: any = null;
  let runDuration = 0;

  for (const line of lines) {
    if (!line || /^\s*$/.test(line)) continue;
    const cells = splitCSVLine(line, delim);

    const allBlank = cells.every((c) =>
      (typeof c === "string" ? c : String(c)).trim() === ""
    );
    if (allBlank) continue;

    totalRows += 1;
    const needed = Math.max(secondsIndex, valueIndex) + 1;
    if (cells.length < needed) {
      if (verbose)
        console.warn(
          `[WARN] Row ${totalRows}: expected >= ${needed} columns, got ${cells.length} -> skipping`
        );
      continue;
    }

    const rawSec = cells[secondsIndex];
    const rawVal = cells[valueIndex];

    const sec = tryParseNumber(rawSec);
    let val = tryParseNumber(rawVal);

    if (typeof val === "number" && Number.isFinite(val)) {
      // round to 1 decimal like Python version
      val = Math.round((val + Number.EPSILON) * 10) / 10;
    }

    if (!(typeof sec === "number" && Number.isFinite(sec))) {
      if (verbose)
        console.warn(
          `[WARN] Row ${totalRows}: invalid seconds=${JSON.stringify(rawSec)} -> skipping`
        );
      continue;
    }

    if (verbose) {
      console.log(`[ROW ${totalRows}] cells=`, cells);
      console.log(`  -> seconds=${sec}, value=${JSON.stringify(val)}`);
    }

    if (totalRows === 1) {
      prevValue = val;
      runDuration = Number(sec);
      if (verbose)
        console.log(
          `  -> Start new run: value=${JSON.stringify(prevValue)}, duration=${runDuration}`
        );
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
      if (verbose)
        console.log(
          `  -> Value changed: closed run value=${JSON.stringify(
            prevValue
          )}, duration=${runDuration}`
        );
      prevValue = val;
      runDuration = Number(sec);
      if (verbose)
        console.log(
          `  -> Start new run: value=${JSON.stringify(prevValue)}, duration=${runDuration}`
        );
    }
  }

  if (totalRows > 0) {
    phases.push({
      value: prevValue,
      duration_seconds: Math.trunc(Math.round(runDuration)),
    });
    if (verbose)
      console.log(
        `[INFO] Closed final run value=${JSON.stringify(
          prevValue
        )}, duration=${runDuration}`
      );
  }

  const durMap: Record<number, any> = {};
  for (const ph of phases) {
    const d = Math.trunc(ph.duration_seconds);
    if (durMap[d] !== undefined && verbose) {
      console.warn(
        `[WARN] Duplicate duration ${d}; overriding ${JSON.stringify(
          durMap[d]
        )} -> ${JSON.stringify(ph.value)}`
      );
    }
    durMap[d] = ph.value;
  }

  return { phases, durMap };
}

/* ===================== UI Component ===================== */

export default function CsvPhaseAnalyzer() {
  // Parsing options (fixed column indices per requirements)
  const secondsIndex = 0;
  const valueIndex = 1;
  const [delimiter, setDelimiter] = useState<string>(""); // empty = auto
  const [verbose, setVerbose] = useState(false);

  // Target options (only parameter; applies to the currently open room/protocol)
  const [targetParam, setTargetParam] = useState<"Temperature" | "Cool White">("Temperature");

  // App protocol state
  const protocol = useProto((s: any) => s.protocol);
  const setProtocol = useProto((s: any) => s.setProtocol);
  const profile = useProto((s: any) => s.profile) as string;

  const [fileName, setFileName] = useState<string>("");
  const [rawText, setRawText] = useState<string>("");
  const [error, setError] = useState<string>("");

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const result = useMemo<
    | null
    | { phases: Phase[]; points: [string, any][]; out: any }
    | { error: string }
  >(() => {
    if (!rawText) return null;
    try {
      let { phases } = analyzeSimpleFromText(rawText, {
        secondsIndex,
        valueIndex,
        delimiter: delimiter ? delimiter : undefined,
        verbose,
      });

      // Keep seconds resolution: do not round to minutes and do not drop short runs.
      // Still group consecutive identical values (handled by analyzeSimpleFromText).

      const points: [string, any][] = [];
      for (const ph of phases as Phase[]) {
        const dur = Number(ph?.duration_seconds ?? 0);
        if (dur > 0) points.push([formatDurationPreserveDays(dur), ph.value]);
      }

      return { phases, points, out: { phases: [{ type: "csv-import", points }] } };
    } catch (e: any) {
      console.error(e);
      return { error: e?.message || String(e) };
    }
  }, [rawText, delimiter, verbose]);

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

  function mapValueForTarget(v: any): number {
    if (typeof v !== "number" || !Number.isFinite(v)) return 0;
    if (targetParam === "Temperature") {
      // internal representation expects tenths of degree, e.g. 40.1 -> 401
      return Math.round(v * 10);
    }
    // Cool White: 0..100 integer percent
    const iv = Math.round(v);
    if (iv < 0) return 0;
    if (iv > 100) return 100;
    return iv;
  }

  // Apply will modify the currently loaded protocol in the editor. The group names
  // (Temperature, Cool White) are consistent across G4–G8.
  function applyToProtocol() {
    if (!result || "error" in result) return;
    try {
      const pointsRaw = (result as any).points as [string, any][];

      // --- Temperature bounds check (warn, don’t block) ---
      if (targetParam === "Temperature") {
        const minDeg = profile === "G7" ? -4 : 4;
        const maxDeg = 42;
        const bad = pointsRaw
          .map(([, v]) => (typeof v === "number" ? v : Number(v)))
          .filter((v) => Number.isFinite(v) && (v < minDeg || v > maxDeg));
        if (bad.length > 0) {
          const examples = [...new Set(bad)]
            .slice(0, 5)
            .map((v) => `${v} °C`)
            .join(", ");
          const ok = window.confirm(
            `⚠️ ${bad.length} temperature point(s) are outside the allowed range ` +
            `(${minDeg}–${maxDeg} °C for ${profile}):\n${examples}\n\nApply anyway?`
          );
          if (!ok) return;
        }
      }
      // Map values to machine scale (e.g., Temperature in tenths, Cool White 0..100)
      const points = pointsRaw
        .filter(([t]) => !!t)
        .map(([t, v]) => [t, mapValueForTarget(v)] as [string, number]);

      // Replace with a single phase of type "csv-import"
      const replaced = [
        {
          type: "csv-import",
          points,
        } as any,
      ];
      const next = typeof structuredClone === "function"
        ? structuredClone(protocol)
        : JSON.parse(JSON.stringify(protocol));
      const parts = next?.sections?.[0]?.parts || [];
      const groupName = targetParam; // "Temperature" or "Cool White"
      const gi = parts.findIndex((p: any) => (p["group-name"] || p.name) === groupName);
      if (gi < 0) {
        alert(`Group not found in current protocol: ${groupName}`);
        return;
      }
      parts[gi].phases = replaced;
      // Ensure legacy compatibility: guarantee group-name present on all parts
      for (const p of parts) {
        if (p && p["group-name"] == null && p.name) p["group-name"] = p.name;
      }
      next.sections[0].parts = parts;
      setProtocol(next);
      // push to legacy editor via the expected event
      window.dispatchEvent(new CustomEvent("protocol:save-draft", { detail: { protocol: next } }));
      alert(`${groupName} phases replaced from CSV (${replaced.length} phases).`);
    } catch (e: any) {
      alert("Failed to apply phases: " + (e?.message || String(e)));
    }
  }

  // no-op

  return (
    <div className="max-w-4xl mx-auto p-4 space-y-4">
      <h2 className="text-xl font-semibold">CSV → Phase Analyzer (browser)</h2>
      <p className="text-sm text-slate-600">
        Upload a CSV shaped like rows of <code>[seconds, value]</code> (index-based, no
        headers). The tool groups consecutive equal values and sums the seconds per run.
        Durations are kept with full seconds precision (no rounding to minutes).
      </p>

      {/* Controls */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 items-end">
        <div>
          <label className="block text-sm font-medium mb-1">Target parameter</label>
          <select
            className="border rounded p-2 w-full"
            value={targetParam}
            onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setTargetParam(e.target.value as any)}
          >
            <option value="Temperature">Temperature</option>
            <option value="Cool White">Cool White</option>
          </select>
        </div>
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
            Choose CSV…
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

      {error ? (
        <div className="text-sm text-red-600">Error: {error}</div>
      ) : null}

      {/* Results */}
      {result && !("error" in result) ? (
        <>
          <div className="flex items-center gap-3">
            <button
              onClick={applyToProtocol}
              className="border rounded px-3 py-2 text-sm bg-indigo-600 text-white hover:bg-indigo-500"
              title={`Replace phases for ${targetParam} in current protocol`}
            >
              Apply to Protocol
            </button>
          </div>

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
                  {(result as any).phases.map((ph: Phase, i: number) => (
                    <tr key={i} className="border-b">
                      <td className="py-1 pr-2">{i + 1}</td>
                      <td className="py-1 pr-2">{String(ph.value)}</td>
                      <td className="py-1 pr-2 text-right">{ph.duration_seconds}</td>
                      <td className="py-1 pr-2 text-right">
                        {formatHHMMSS(ph.duration_seconds)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="border rounded p-3">
            <div className="font-medium mb-2">Points (HH:MM:SS, value)</div>
            <div className="text-xs text-slate-600 mb-2">
              Derived one-per-phase where duration &gt; 0.
            </div>
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
                  {(result as any).points.map(([t, v]: [string, any], i: number) => (
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
      ) : rawText && result && "error" in result ? (
        <div className="text-sm text-red-600">Error: {result.error}</div>
      ) : null}
    </div>
  );
}
