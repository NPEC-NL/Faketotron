import React, { useEffect, useMemo, useState } from "react";
import * as Store from "../state/store";
import type { Protocol } from "../profiles";
import {
  buildPortableSemantics,
  buildProtocolSemantics,
  emptyOverrides,
  type SemanticsOverrides
} from "../semantics/generate";
import {
  getDefaultPecoIdForGroupType,
  getPecoOptionsForGroupType,
  getSpectralHintForGroupType,
  isLightGroupType
} from "../semantics/mappings";

const useProto: any = (Store as any).useProto ?? (Store as any).useStore;

// Local override storage is profile-specific to avoid mismatches when profile changes.
const LS_KEY_BASE = "faketotron:semantics_overrides:v3";

function safeJsonParse<T>(s: string | null, fallback: T): T {
  if (!s) return fallback;
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
}

function downloadJson(filename: string, obj: any) {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function groupName(g: any): string {
  return g?.["group-name"] ?? g?.name ?? "(unnamed group)";
}

function partKey(sectionIdx: number, partIdx: number): string {
  return `${sectionIdx}:${partIdx}`;
}

/** Unused if phases empty, or all phases are const(value=0) placeholders. */
function isPhasesUnused(phases: any): boolean {
  if (!Array.isArray(phases) || phases.length === 0) return true;
  for (const ph of phases) {
    if (!ph || typeof ph !== "object") return false;
    if (ph.type !== "const") return false;
    // treat missing value as used (avoid deleting ambiguous configs)
    if (!("value" in ph)) return false;
    if (Number(ph.value) !== 0) return false;
  }
  return true;
}

const isUpperShelfVar = (machineVar: string) => /2$/.test(machineVar);

// UI hint only (placeholder). Exported semantics will NOT include leakage calibration unless user provides it.
// Placeholder text only (not exported unless user provides a value)
const leakagePlaceholder = (machineVar: string) => {
  const base = machineVar.replace(/2$/, "").replace(/\d+$/, "");
  return `${base}_lowshift.csv`;
};

function normalizeSelectedPeco(type: string, raw: string): string {
  const opts = getPecoOptionsForGroupType(type).filter((o) => !!o.id);
  if (raw && opts.some((o) => o.id === raw)) return raw;
  const def = getDefaultPecoIdForGroupType(type);
  if (def && opts.some((o) => o.id === def)) return def;
  return opts[0]?.id ?? "";
}

function deepClone<T>(x: T): T {
  return JSON.parse(JSON.stringify(x)) as T;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function highlightJson(obj: any): string {
  const json = escapeHtml(JSON.stringify(obj, null, 2));
  // Simple token highlighting: strings, keys, numbers, booleans, null
  return json
    .replace(/"(\\u[a-fA-F0-9]{4}|\\[^u]|[^\\"])*"(?=\s*:)/g, '<span style="color:#7c3aed">$&</span>') // keys
    .replace(/"(\\u[a-fA-F0-9]{4}|\\[^u]|[^\\"])*"/g, '<span style="color:#2563eb">$&</span>') // strings
    .replace(/\b-?\d+(?:\.\d+)?(?:[eE][+\-]?\d+)?\b/g, '<span style="color:#b45309">$&</span>') // numbers
    .replace(/\b(true|false)\b/g, '<span style="color:#059669">$1</span>') // booleans
    .replace(/\bnull\b/g, '<span style="color:#6b7280">null</span>'); // null
}

const JsonPreview: React.FC<{ title: string; obj: any }> = ({ title, obj }) => (
  <details style={{ marginTop: 14 }}>
    <summary style={{ cursor: "pointer", fontWeight: 700 }}>{title}</summary>
    <pre
      style={{
        whiteSpace: "pre-wrap",
        fontSize: 12,
        background: "#0b1020",
        color: "#e5e7eb",
        padding: 12,
        borderRadius: 12,
        border: "1px solid #111827",
        marginTop: 10,
        overflowX: "auto"
      }}
      dangerouslySetInnerHTML={{ __html: highlightJson(obj) }}
    />
  </details>
);

function filterProtocolSemanticsOutput(obj: any, unusedPartKeys: Set<string>) {
  const out = deepClone(obj);
  const parts = out?.semantics?.parts;
  if (Array.isArray(parts)) {
    out.semantics.parts = parts.filter((p: any) => {
      const si = p?.selector?.section_index;
      const pi = p?.selector?.part_index;
      if (typeof si !== "number" || typeof pi !== "number") return true;
      return !unusedPartKeys.has(partKey(si, pi));
    });
  }

  // Drop calibrations that only apply to removed parts
  const usedVars = new Set<string>();
  (out?.semantics?.parts || []).forEach((p: any) => {
    const m = p?.meaning?.calibration_csv;
    if (m && typeof m === "object") Object.keys(m).forEach((k) => usedVars.add(k));
    const l = p?.meaning?.leakage_calibration_csv;
    if (l && typeof l === "object") Object.keys(l).forEach((k) => usedVars.add(k));
  });

  if (Array.isArray(out?.semantics?.calibrations)) {
    out.semantics.calibrations = out.semantics.calibrations.filter((c: any) => {
      const mv = c?.applies_to_machine_var;
      if (!mv) return true;
      return usedVars.has(mv);
    });
    if (!out.semantics.calibrations.length) delete out.semantics.calibrations;
  }

  return out;
}

function filterPortableSemanticsOutput(obj: any) {
  const out = deepClone(obj);
  if (Array.isArray(out?.channels)) {
    out.channels = out.channels.filter((ch: any) => !isPhasesUnused(ch?.program));
  }
  return out;
}

export default function SemanticsTab() {
  const profile = useProto((s: any) => s.profile) as string;
  const protocol = useProto((s: any) => s.protocol) as Protocol;
  const protoRev = useProto((s: any) => s.protoRev) as number;

  const lsKey = useMemo(() => `${LS_KEY_BASE}:${profile || "unknown"}`, [profile]);

  const [overrides, setOverrides] = useState<SemanticsOverrides>(() => emptyOverrides());

  // Load overrides when profile changes
  useEffect(() => {
    const initial = safeJsonParse<SemanticsOverrides>(
      typeof window !== "undefined" ? window.localStorage.getItem(lsKey) : null,
      emptyOverrides()
    );
    setOverrides({
      pecoByPartKey: initial.pecoByPartKey || {},
      calibrationByVar: initial.calibrationByVar || {},
      leakageCalibrationByUpperVar: (initial as any).leakageCalibrationByUpperVar || {}
    });
  }, [lsKey]);

  // Persist overrides
  useEffect(() => {
    try {
      window.localStorage.setItem(lsKey, JSON.stringify(overrides));
    } catch {
      // ignore
    }
  }, [overrides, lsKey]);

  // Ensure stored PECO IDs remain valid for the current protocol structure and current group types.
  // This avoids mismatches when switching profiles (indices can shift).
  useEffect(() => {
    const next: SemanticsOverrides = {
      pecoByPartKey: { ...overrides.pecoByPartKey },
      calibrationByVar: { ...overrides.calibrationByVar },
      leakageCalibrationByUpperVar: { ...(overrides as any).leakageCalibrationByUpperVar }
    };
    let changed = false;
    const seenKeys = new Set<string>();

    (protocol.sections || []).forEach((sec: any, si: number) => {
      (sec.parts || []).forEach((g: any, pi: number) => {
        const key = partKey(si, pi);
        seenKeys.add(key);
        const raw = next.pecoByPartKey[key] || "";
        const norm = normalizeSelectedPeco(g.type, raw);
        if (raw !== norm) {
          next.pecoByPartKey[key] = norm;
          changed = true;
        }
      });
    });

    // Remove stale keys (protocol changed shape)
    Object.keys(next.pecoByPartKey).forEach((k) => {
      if (!seenKeys.has(k)) {
        delete next.pecoByPartKey[k];
        changed = true;
      }
    });

    if (changed) setOverrides(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [protoRev, profile]);

  const partsFlat = useMemo(() => {
    const out: Array<{ si: number; pi: number; g: any }> = [];
    (protocol.sections || []).forEach((sec: any, si: number) => {
      (sec.parts || []).forEach((g: any, pi: number) => out.push({ si, pi, g }));
    });
    return out;
  }, [protocol]);

  const unusedPartKeys = useMemo(() => {
    const s = new Set<string>();
    (protocol.sections || []).forEach((sec: any, si: number) => {
      (sec.parts || []).forEach((g: any, pi: number) => {
        if (isPhasesUnused(g?.phases)) s.add(partKey(si, pi));
      });
    });
    return s;
  }, [protocol]);

  const protocolSemObjRaw = useMemo(() => buildProtocolSemantics(profile, protocol, overrides), [profile, protocol, overrides]);
  const portableSemObjRaw = useMemo(() => buildPortableSemantics(profile, protocol, overrides), [profile, protocol, overrides]);

  const protocolSemObj = useMemo(() => filterProtocolSemanticsOutput(protocolSemObjRaw, unusedPartKeys), [protocolSemObjRaw, unusedPartKeys]);
  const portableSemObj = useMemo(() => filterPortableSemanticsOutput(portableSemObjRaw), [portableSemObjRaw]);

  const Card: React.FC<{ title: string; children: React.ReactNode; right?: React.ReactNode; dimmed?: boolean }> = ({
    title,
    children,
    right,
    dimmed
  }) => (
    <div
      style={{
        border: "1px solid #e5e7eb",
        borderRadius: 12,
        padding: 12,
        marginBottom: 12,
        background: dimmed ? "#f3f4f6" : "white",
        opacity: dimmed ? 0.75 : 1
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ fontWeight: 700 }}>{title}</div>
        {right}
      </div>
      <div style={{ marginTop: 10 }}>{children}</div>
    </div>
  );

  return (
    <div style={{ padding: 16 }}>
      <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 12, flexWrap: "wrap" }}>
        <div style={{ fontWeight: 800, fontSize: 18 }}>Semantics</div>
        <div style={{ color: "#6b7280" }}>
          Profile: <b>{profile}</b>
        </div>

        <div style={{ marginLeft: "auto", display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button
            className="btn"
            onClick={() => downloadJson("protocol_semantics.json", protocolSemObj)}
            style={{ border: "1px solid #e5e7eb", borderRadius: 8, padding: "6px 10px", background: "#eef2ff" }}
          >
            Download protocol_semantics.json
          </button>
          <button
            className="btn"
            onClick={() => downloadJson("portable_semantics.json", portableSemObj)}
            style={{ border: "1px solid #e5e7eb", borderRadius: 8, padding: "6px 10px", background: "#ecfeff" }}
          >
            Download portable_semantics.json
          </button>
        </div>
      </div>

      <Card
        title="How this tab works"
        right={
          <button
            className="btn"
            onClick={() => {
              setOverrides(emptyOverrides());
              try {
                window.localStorage.removeItem(LS_KEY);
              } catch {
                // ignore
              }
            }}
            style={{ border: "1px solid #e5e7eb", borderRadius: 8, padding: "6px 10px", background: "white" }}
          >
            Reset selections
          </button>
        }
      >
        <div style={{ color: "#374151", lineHeight: 1.5 }}>
          <div style={{ marginBottom: 10 }}>
            This tab generates a <b>canonical semantics layer</b> for your current protocol: it keeps the same structure and
            channel names you already use (so Faketotron can round‑trip), but adds stable scientific meaning.
          </div>
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            <li>
              Pick a <b>PECO term</b> for each control group (temperature / humidity / CO₂ / each light channel).
            </li>
            <li>
              For <b>light</b> groups, you may optionally provide the <b>calibration CSV filename</b> (SpectraPen regression)
              so others can map internal % to measured spectrum/PPFD.
            </li>
            <li>
              Groups with <b>no phases</b> or only a <b>const 0</b> placeholder are treated as <b>not used</b>: they are greyed
              out here and excluded from the exported semantics files.
            </li>
          </ul>

          <div style={{ marginTop: 12 }}>
            <div style={{ fontWeight: 700, marginBottom: 6 }}>Why this tab exists</div>
            <div style={{ color: "#374151", lineHeight: 1.5, fontSize: 14 }}>
              <p style={{ marginTop: 0 }}>
                <b>protocol.json/.fyt</b> are machine-facing and may contain vendor-specific encodings (e.g. temperature stored as 210).
                The Semantics tab exports <b>canonical meaning</b> so datasets remain usable outside the PSI ecosystem and across future devices.
              </p>
              <p style={{ marginBottom: 0 }}>
                The exported files keep the same experimental timeline, but add PECO links, spectral hints, and (optional) calibration filenames.
              </p>
            </div>
          </div>

          <div style={{ marginTop: 12 }}>
            <div style={{ fontWeight: 700, marginBottom: 6 }}>Why PECO selection is manual</div>
            <div style={{ color: "#374151", lineHeight: 1.5, fontSize: 14 }}>
              Ontology terms encode <b>intent</b>, not just numbers. Two labs can run the same 28°C profile but only one considers it “high temperature”.
              Faketotron can’t infer that baseline safely, so you choose the most accurate term.
            </div>
          </div>

          <div style={{ marginTop: 12 }}>
            <div style={{ fontWeight: 700, marginBottom: 6 }}>Risk of choosing fine-grained terms</div>
            <div style={{ color: "#374151", lineHeight: 1.5, fontSize: 14 }}>
              Terms like “high temperature” / “cold temperature” can become misleading if you haven’t defined thresholds.
              If you’re unsure, pick a broader term (e.g. “temperature exposure”) and document thresholds in your SOP/notes.
              Overly specific terms can reduce comparability across datasets.
            </div>
          </div>

          <div style={{ marginTop: 12 }}>
            <div style={{ fontWeight: 700, marginBottom: 6 }}>Meaning of mapping relations</div>
            <ul style={{ margin: 0, paddingLeft: 18, color: "#374151", lineHeight: 1.5, fontSize: 14 }}>
              <li><b>exact</b>: the protocol’s intended condition matches the term definition.</li>
              <li><b>close</b>: very similar, but not perfectly aligned (useful when PECO lacks an exact match).</li>
              <li><b>broad</b>: the term is more general than your intent (safe fallback when uncertain).</li>
              <li><b>narrow</b>: the term is more specific than your intent (use only if you’re confident; implies a stronger claim).</li>
            </ul>
          </div>

          <div style={{ marginTop: 10, color: "#374151" }}>
            <b>Downloads</b>:
            <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
              <li>
                <b>protocol_semantics.json</b>: includes <b>protocol_canonical</b> (e.g. temperature 210 → 21.0) plus PECO
                mappings and machine encoding so PSI users can still export back.
              </li>
              <li>
                <b>portable_semantics.json</b>: a vendor‑neutral list of channels and time‑programs (still using % for light
                control, with spectral hints and optional calibration file references).
              </li>
            </ul>
            <div style={{ marginTop: 6, color: "#6b7280" }}>
              Note: exports are generated from the current protocol in the store. <b>This tab does not modify protocol.json/.fyt</b>.
            </div>
          </div>
        </div>
      </Card>

      {partsFlat.map(({ si, pi, g }) => {
        const key = partKey(si, pi);
        const unused = unusedPartKeys.has(key);
        const opts = getPecoOptionsForGroupType(g.type);
        const selectedRaw = overrides.pecoByPartKey[key] || "";
        const selected = normalizeSelectedPeco(g.type, selectedRaw);
        const spectral = isLightGroupType(g.type) ? getSpectralHintForGroupType(g.type) : undefined;

        return (
          <Card
            key={key}
            dimmed={unused}
            title={`${groupName(g)}  (${g.type})`}
            right={
              unused ? (
                <span
                  style={{
                    fontSize: 12,
                    background: "#e5e7eb",
                    color: "#374151",
                    padding: "2px 8px",
                    borderRadius: 999
                  }}
                >
                  Not used
                </span>
              ) : null
            }
          >
            {unused && (
              <div style={{ marginBottom: 10, color: "#6b7280" }}>
                This group has no phases or only a <code>const 0</code> placeholder. It will be excluded from exported
                semantics.
              </div>
            )}

            <div style={{ display: "grid", gridTemplateColumns: "220px 1fr", gap: 10, alignItems: "center" }}>
              <div style={{ color: "#6b7280" }}>Machine vars</div>
              <div style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}>
                {(g.vars || []).join(", ") || "(none)"}
              </div>

              <div style={{ color: "#6b7280" }}>PECO mapping</div>
              <div>
                <select
                  value={selected}
                  disabled={unused}
                  onChange={(e) =>
                    setOverrides((s) => ({
                      ...s,
                      pecoByPartKey: { ...s.pecoByPartKey, [key]: e.target.value }
                    }))
                  }
                  style={{
                    width: "min(520px, 100%)",
                    padding: "6px 8px",
                    borderRadius: 8,
                    border: "1px solid #e5e7eb"
                  }}
                >
                  {opts.map((o) => (
                    <option key={o.id || o.label} value={o.id}>
                      {o.id ? `${o.label} (${o.id}, ${o.relation})` : o.label}
                    </option>
                  ))}
                </select>

                {selected?.startsWith("PECO:") && (
                  <div style={{ marginTop: 6 }}>
                    <a
                      href={`https://browser.planteome.org/amigo/term/${selected}`}
                      target="_blank"
                      rel="noreferrer"
                      style={{ color: "#2563eb", textDecoration: "none", fontSize: 12 }}
                    >
                      View term definition in PECO ↗
                    </a>
                  </div>
                )}
              </div>

              <div style={{ color: "#6b7280" }}>Spectral hint</div>
              <div style={{ color: "#374151" }}>
                {!spectral && <span style={{ color: "#9ca3af" }}>(none)</span>}
                {spectral?.kind === "bandpass" && (
                  <span>
                    bandpass {spectral.band_nm.min}–{spectral.band_nm.max} nm
                    {typeof spectral.band_nm.typ === "number" ? ` (typ ${spectral.band_nm.typ} nm)` : ""}
                  </span>
                )}
                {spectral?.kind === "range" && (
                  <span>
                    range {spectral.range_nm.min}–{spectral.range_nm.max} nm
                  </span>
                )}
                {spectral?.kind === "broad_cct" && (
                  <span>
                    broad spectrum (CCT {spectral.cct_K.min}–{spectral.cct_K.max} K)
                  </span>
                )}
              </div>
            </div>

            {isLightGroupType(g.type) && (
              <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px dashed #e5e7eb" }}>
                <div style={{ fontWeight: 700, marginBottom: 8 }}>
                  Optional calibration CSV filename(s)
                </div>
                <div style={{ color: "#6b7280", marginBottom: 10, lineHeight: 1.4 }}>
                  SpectraPen regression calibration is used to interpret <b>% driver output</b> in physical units. Leakage calibration (upper → lower shelf) is optional and
                  should only be provided when empirically relevant.
                </div>

                {(g.vars || []).map((v: string) => (
                  <div key={v} style={{ marginBottom: 10 }}>
                    <div style={{ display: "grid", gridTemplateColumns: "220px 1fr", gap: 10, alignItems: "center" }}>
                      <div style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}>{v}</div>
                      <input
                        value={overrides.calibrationByVar[v] || ""}
                        disabled={unused}
                        onChange={(e) =>
                          setOverrides((s) => ({
                            ...s,
                            calibrationByVar: { ...s.calibrationByVar, [v]: e.target.value }
                          }))
                        }
                        placeholder={`${v}.csv`}
                        style={{ padding: "6px 8px", borderRadius: 8, border: "1px solid #e5e7eb" }}
                      />
                    </div>

                    {isUpperShelfVar(v) && (
                      <div style={{ display: "grid", gridTemplateColumns: "220px 1fr", gap: 10, alignItems: "center", marginTop: 8 }}>
                        <div style={{ color: "#6b7280", fontSize: 12 }}>Leakage (upper → lower)</div>
                        <input
                          value={(overrides as any).leakageCalibrationByUpperVar?.[v] || ""}
                          disabled={unused}
                          onChange={(e) =>
                            setOverrides((s) => ({
                              ...s,
                              leakageCalibrationByUpperVar: {
                                ...(s as any).leakageCalibrationByUpperVar,
                                [v]: e.target.value
                              }
                            }))
                          }
                          placeholder={leakagePlaceholder(v)}
                          style={{ padding: "6px 8px", borderRadius: 8, border: "1px solid #e5e7eb" }}
                        />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </Card>
        );
      })}

      <JsonPreview title="Preview: protocol_semantics.json" obj={protocolSemObj} />
      <JsonPreview title="Preview: portable_semantics.json" obj={portableSemObj} />
    </div>
  );
}
