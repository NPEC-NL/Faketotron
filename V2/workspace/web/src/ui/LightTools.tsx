import React, { useEffect, useMemo, useState } from "react";
import { LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, ResponsiveContainer, Legend, /* add for spectrum and dots */ BarChart, Bar, Cell } from "recharts";

// ===== Types =====
type ChannelParams = { A: number; b: number };

type ShelfName = string;
type ChannelName = string;

type Preset = {
  name: string;
  profile: string;
  shelves: Record<ShelfName, { channels: Record<ChannelName, ChannelParams> }>;
  fullSpectrumShelves?: Record<ShelfName, { channels: Record<ChannelName, ChannelParams> }>;
};

type PercentRow  = { percent: number; value: number };

// Simple color map per channel for consistent curves/markers
const CHANNEL_COLORS: Record<string, string> = {
  coolWhite: "#7aa6ff", // cool blue
  deepRed: "#e03131",  // red
  farRed: "#b1006b",   // magenta-ish
};
const colorFor = (name: string) => CHANNEL_COLORS[name] || "#8884d8";

// ===== Default data (existing calibration) =====
// Each room now has separate PAR and Full spectrum entries in the dropdown
const DEFAULT_PRESETS: Preset[] = [
  {
    name: "G4 PAR (400–700 nm)",
    profile: "Room",
    shelves: {
      single: {
        channels: {
          coolWhite: { A: 9.882178162,  b: 12.9948859  },
          deepRed:   { A: 1.068148947,  b: -2.143145002 },
          farRed:    { A: 0.042586091,  b: 0.267684     },
        },
      },
    },
  },
  {
    name: "G4 Full spectrum (300–900 nm)",
    profile: "Room",
    shelves: {
      single: {
        channels: {
          coolWhite: { A: 11.08, b: 14.57 },
          deepRed:   { A: 1.56,  b: -3.13 },
          farRed:    { A: 0.28,  b: 1.76  },
        },
      },
    },
  },

  {
    name: "G5 PAR (400–700 nm)",
    profile: "Room",
    shelves: {
      single: {
        channels: {
          coolWhite: { A: 8.681166555,  b: 13.98985898 },
          deepRed:   { A: 0.550060964,  b: 0.621245324 },
          farRed:    { A: 0.001097324,  b: 0.36870093  },
        },
      },
    },
  },
  {
    name: "G5 Full spectrum (300–900 nm)",
    profile: "Room",
    shelves: {
      single: {
        channels: {
          coolWhite: { A: 9.55, b: 15.39 },
          deepRed:   { A: 0.85, b: 0.96  },
          farRed:    { A: 0.01, b: 3.36  },
        },
      },
    },
  },

  {
    name: "G6 PAR (400–700 nm)",
    profile: "Room",
    shelves: {
      single: {
        channels: {
          coolWhite: { A: 12.56678405,  b: -48.72777514 },
          deepRed:   { A: 3.744073355,  b: -8.336413329 },
          farRed:    { A: 0,            b: 0             },
        },
      },
    },
  },
  {
    name: "G6 Full spectrum (300–900 nm)",
    profile: "Room",
    shelves: {
      single: {
        channels: {
          coolWhite: { A: 13.47, b: -52.23 },
          deepRed:   { A: 5.12,  b: -11.4  },
          farRed:    { A: 0.08,  b: 1.56   },
        },
      },
    },
  },

  {
    name: "G7 PAR (400–700 nm)",
    profile: "Room",
    shelves: {
      single: {
        channels: {
          coolWhite: { A: 6.694780888,  b: 12.43184897  },
          deepRed:   { A: 0.616117746,  b: -0.079499064 },
          farRed:    { A: 0.014972421,  b: 0.061250814  },
        },
      },
    },
  },
  {
    name: "G7 Full spectrum (300–900 nm)",
    profile: "Room",
    shelves: {
      single: {
        channels: {
          coolWhite: { A: 7.27, b: 13.50 },
          deepRed:   { A: 0.93, b: -0.12 },
          farRed:    { A: 0.11, b: 0.45  },
        },
      },
    },
  },

  {
    name: "G8 PAR (400–700 nm)",
    profile: "Room",
    shelves: {
      single: {
        channels: {
          coolWhite: { A: 17.7940311,   b: 57.29996395  },
          deepRed:   { A: 0.631567799,  b: 1.210504949  },
          farRed:    { A: 0,            b: 0            },
        },
      },
    },
  },
  {
    name: "G8 Full spectrum (300–900 nm)",
    profile: "Room",
    shelves: {
      single: {
        channels: {
          coolWhite: { A: 20.12, b: 64.79 },
          deepRed:   { A: 0.96,  b: 1.84  },
          farRed:    { A: 0.71,  b: 18.08 },
        },
      },
    },
  },
];
const PRESET_STORAGE_KEY = "ppfd.presets.v4";
const PRESET_STORAGE_VERSION = 2;

type PresetStoragePayload = {
  version: number;
  presets: Preset[];
};

function extractPresets(payload: unknown): Preset[] | undefined {
  if (Array.isArray(payload)) {
    return payload as Preset[];
  }
  if (payload && typeof payload === "object" && Array.isArray((payload as PresetStoragePayload).presets)) {
    return (payload as PresetStoragePayload).presets;
  }
  return undefined;
}

function mergeWithDefaults(saved: Preset[] | undefined): Preset[] {
  if (!saved?.length) {
    return [...DEFAULT_PRESETS];
  }

  const seen = new Set<string>();
  const merged: Preset[] = [];

  for (const preset of DEFAULT_PRESETS) {
    merged.push(preset);
    seen.add(preset.name);
  }

  for (const preset of saved) {
    if (seen.has(preset.name)) continue;
    merged.push(preset);
    seen.add(preset.name);
  }

  return merged;
}

function loadInitialPresets(): Preset[] {
  if (typeof window === "undefined") {
    return [...DEFAULT_PRESETS];
  }

  try {
    const raw = window.localStorage.getItem(PRESET_STORAGE_KEY);
    if (!raw) {
      return [...DEFAULT_PRESETS];
    }

    const parsed = JSON.parse(raw);
    return mergeWithDefaults(extractPresets(parsed));
  } catch (error) {
    console.warn("[LightTools] Failed to read stored presets", error);
    return [...DEFAULT_PRESETS];
  }
}

// ===== Helpers =====
function clamp(x: number, lo = 0, hi = 100) {
  return Math.max(lo, Math.min(hi, x));
}

// (unused legacy helpers removed)

// ===== Spectrum Lab types & helpers =====
type SpectrumPoint = { nm: number; ee: number };

type LampCalibrationData = {
  coolWhite: SpectrumPoint[][]; // 20 spectra: index 0→5%, 1→10%, …, 19→100%
  deepRed: SpectrumPoint[][];
  farRed: SpectrumPoint[][];
};

/** Parse a Jeti multi-measurement CSV (e.g. G4_5%_increments_3_lamps.csv). */
function parseLampCalibrationCsv(text: string): LampCalibrationData {
  const lines = text.split(/\r?\n/);
  let headerIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith("Wavelength [nm]")) { headerIdx = i; break; }
  }
  if (headerIdx < 0) throw new Error("Header 'Wavelength [nm]' not found");

  const coolWhite: SpectrumPoint[][] = Array.from({ length: 20 }, () => []);
  const deepRed:   SpectrumPoint[][] = Array.from({ length: 20 }, () => []);
  const farRed:    SpectrumPoint[][] = Array.from({ length: 20 }, () => []);

  for (let i = headerIdx + 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const parts = line.split(";");
    if (parts.length < 61) continue;
    const nm = parseInt(parts[0], 10);
    if (isNaN(nm)) continue;
    for (let j = 0; j < 20; j++) {
      const cw = parseFloat(parts[1 + j].replace(",", "."));
      const dr = parseFloat(parts[21 + j].replace(",", "."));
      const fr = parseFloat(parts[41 + j].replace(",", "."));
      coolWhite[j].push({ nm, ee: isNaN(cw) ? 0 : cw });
      deepRed[j].push({  nm, ee: isNaN(dr) ? 0 : dr });
      farRed[j].push({   nm, ee: isNaN(fr) ? 0 : fr });
    }
  }
  return { coolWhite, deepRed, farRed };
}

/** Parse a single Jeti measurement CSV (first Ee column only). */
function parseJetiSpectrumCsv(text: string): SpectrumPoint[] {
  const lines = text.split(/\r?\n/);
  let headerIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith("Wavelength [nm]")) { headerIdx = i; break; }
  }
  if (headerIdx < 0) throw new Error("Header 'Wavelength [nm]' not found");
  const pts: SpectrumPoint[] = [];
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const parts = line.split(";");
    if (parts.length < 2) continue;
    const nm = parseFloat(parts[0].replace(",", "."));
    const ee = parseFloat(parts[1].replace(",", "."));
    if (!isNaN(nm) && !isNaN(ee)) pts.push({ nm, ee });
  }
  if (!pts.length) throw new Error("No spectral data found after header");
  return pts;
}

/**
 * Interpolated spectrum for a given channel at any percent 0–100.
 * Measured data is at 5 % steps (index 0 = 5 %, …, 19 = 100 %).
 * Between measured points: linear interpolation.
 * Below 5 %: extrapolate from the 5 %→10 % slope (clamping Ee ≥ 0).
 */
function spectrumAtPercent(spectra: SpectrumPoint[][], pct: number): SpectrumPoint[] {
  if (pct <= 0) return spectra[0].map((p) => ({ nm: p.nm, ee: 0 }));
  if (pct >= 100) return spectra[19];

  // Map: 5 % → idx 0, 10 % → idx 1, …, 100 % → idx 19
  const idx = pct / 5 - 1; // e.g. 6 % → 0.2, 3 % → −0.4

  if (idx < 0) {
    // Extrapolate below 5 % using slope between 5 % (idx 0) and 10 % (idx 1)
    // At pct=5 we want spectra[0]; per 1 % the change is (spectra[1]–spectra[0])/5
    const perOne = (val1: number, val0: number) => (val1 - val0) / 5;
    const stepsBelow = 5 - pct; // how many % below 5
    return spectra[0].map((p, i) => ({
      nm: p.nm,
      ee: Math.max(0, p.ee - perOne(spectra[1][i]?.ee ?? 0, p.ee) * stepsBelow),
    }));
  }

  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return spectra[lo];
  const t = idx - lo;
  return spectra[lo].map((p, i) => ({
    nm: p.nm,
    ee: p.ee * (1 - t) + (spectra[hi][i]?.ee ?? 0) * t,
  }));
}

/** Sum three channel spectra at given percentages into one combined spectrum. */
function reconstructSpectrum(
  cal: LampCalibrationData,
  cwPct: number,
  drPct: number,
  frPct: number,
): SpectrumPoint[] {
  const cw = spectrumAtPercent(cal.coolWhite, cwPct);
  const dr = spectrumAtPercent(cal.deepRed, drPct);
  const fr = spectrumAtPercent(cal.farRed, frPct);
  return cw.map((p, i) => ({
    nm: p.nm,
    ee: p.ee + (dr[i]?.ee ?? 0) + (fr[i]?.ee ?? 0),
  }));
}

// ===== Main component =====
export default function LightTools() {
  const [presets, setPresets] = useState<Preset[]>(loadInitialPresets);
  useEffect(() => {
    if (typeof window === "undefined") return;

    const payload: PresetStoragePayload = {
      version: PRESET_STORAGE_VERSION,
      presets,
    };
    window.localStorage.setItem(PRESET_STORAGE_KEY, JSON.stringify(payload));
  }, [presets]);

  const [presetIndex, setPresetIndex] = useState(0);
  const preset = presets[presetIndex] ?? presets[0];

  if (!preset) {
    return null;
  }

  // Shelves now come directly from the selected preset
  const activeShelves = preset.shelves;

  // Channels come from the first shelf of the selected preset (simplified)
  const firstShelfKey = Object.keys(activeShelves)[0] || "";
  const allChannels = Object.keys(activeShelves[firstShelfKey]?.channels ?? {});

  // per-channel percents (0..100)
  const [perChannelPercent, setPerChannelPercent] = useState<Record<ChannelName, number>>({});

  // On preset change: auto-add all channels to the mix with a default 50%
  useEffect(() => {
    const init: Record<ChannelName, number> = {};
    for (const ch of allChannels) init[ch] = 50;
    setPerChannelPercent(init);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [presetIndex, firstShelfKey]);

  // Channel params from the first shelf
  function paramsFor(channel: ChannelName): ChannelParams {
    return activeShelves[firstShelfKey]?.channels[channel] ?? { A: 1, b: 0 };
  }

  function onChangePreset(idx: number) {
    setPresetIndex(idx);
  }

  // Determine measurement type from preset name
  const measurementType = preset.name.includes('Full spectrum') ? 'Full spectrum' : 'PAR';

  // ===== New: PPFD vs device % chart data =====
  // Build per-channel PPFD curves using calibration PPFD(%) = A * % + b
  const percentSeries = useMemo(() => {
    const series = [] as { name: string; data: PercentRow[] }[];
    const steps = Array.from({ length: 101 }, (_, i) => i); // 0..100 inclusive
    for (const ch of allChannels) {
      const { A, b } = paramsFor(ch);
      const data: PercentRow[] = steps.map((p) => ({ percent: p, value: Math.max(0, A * p + b) }));
      series.push({ name: ch, data });
    }
    return series;
  }, [preset]);

  // Total PPFD curve = sum of all active channels at each %
  const totalPercentData: PercentRow[] = useMemo(() => {
    const steps = Array.from({ length: 101 }, (_, i) => i);
    return steps.map((p) => {
      let sum = 0;
      for (const ch of allChannels) {
        const { A, b } = paramsFor(ch);
        sum += Math.max(0, A * p + b);
      }
      return { percent: p, value: sum };
    });
  }, [preset]);

  // Current selection points (one per channel) to show on the graph
  const currentPoints = useMemo(() => {
    return allChannels.map((ch) => {
      const { A, b } = paramsFor(ch);
      const pct = perChannelPercent[ch] ?? 50;
      return { name: ch, data: [{ percent: pct, value: Math.max(0, A * pct + b) }] };
    });
  }, [preset, JSON.stringify(perChannelPercent)]);

  // total PPFD at current slider positions
  const totalPPFD = useMemo(() => {
    return allChannels.reduce((sum, ch) => {
      const { A, b } = paramsFor(ch);
      const pct = perChannelPercent[ch] ?? 50;
      return sum + Math.max(0, A * pct + b);
    }, 0);
  }, [preset, JSON.stringify(perChannelPercent)]);

  // Spectrum-like contributions (simple): per-channel PPFD bars
  const spectrumBars = useMemo(() => {
    return allChannels.map((ch) => {
      const { A, b } = paramsFor(ch);
      const pct = perChannelPercent[ch] ?? 50;
      return { name: ch, ppfd: Math.max(0, A * pct + b), color: colorFor(ch) };
    });
  }, [preset, JSON.stringify(perChannelPercent)]);

  // ===== Spectrum Lab state =====
  const [lampCal, setLampCal] = useState<LampCalibrationData | null>(null);
  const [lampCalFile, setLampCalFile] = useState("");
  const [lampCalError, setLampCalError] = useState("");
  const [jetiRef, setJetiRef] = useState<SpectrumPoint[]>([]);
  const [jetiRefFile, setJetiRefFile] = useState("");
  const [jetiRefError, setJetiRefError] = useState("");
  const [slCW, setSlCW] = useState(50);
  const [slDR, setSlDR] = useState(50);
  const [slFR, setSlFR] = useState(50);

  function onLampCalFileChosen(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setLampCalFile(file.name);
    setLampCalError("");
    const reader = new FileReader();
    reader.onload = () => {
      try {
        setLampCal(parseLampCalibrationCsv(reader.result as string));
      } catch (err: any) {
        setLampCalError(err.message ?? "Parse error");
        setLampCal(null);
      }
    };
    reader.readAsText(file);
  }

  function onJetiRefFileChosen(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setJetiRefFile(file.name);
    setJetiRefError("");
    const reader = new FileReader();
    reader.onload = () => {
      try {
        setJetiRef(parseJetiSpectrumCsv(reader.result as string));
      } catch (err: any) {
        setJetiRefError(err.message ?? "Parse error");
        setJetiRef([]);
      }
    };
    reader.readAsText(file);
  }

  const reconstructed = useMemo(() => {
    if (!lampCal) return [] as SpectrumPoint[];
    return reconstructSpectrum(lampCal, slCW, slDR, slFR);
  }, [lampCal, slCW, slDR, slFR]);

  const overlayData = useMemo(() => {
    if (!reconstructed.length && !jetiRef.length) return [];
    const map = new Map<number, { nm: number; reconstructed?: number; measured?: number }>();
    for (const pt of reconstructed) map.set(pt.nm, { nm: pt.nm, reconstructed: pt.ee });
    for (const pt of jetiRef) {
      const existing = map.get(pt.nm);
      if (existing) existing.measured = pt.ee;
      else map.set(pt.nm, { nm: pt.nm, measured: pt.ee });
    }
    return Array.from(map.values()).sort((a, b) => a.nm - b.nm);
  }, [reconstructed, jetiRef]);

  const channelSpectra = useMemo(() => {
    if (!lampCal) return { cw: [] as SpectrumPoint[], dr: [] as SpectrumPoint[], fr: [] as SpectrumPoint[] };
    return {
      cw: spectrumAtPercent(lampCal.coolWhite, slCW),
      dr: spectrumAtPercent(lampCal.deepRed, slDR),
      fr: spectrumAtPercent(lampCal.farRed, slFR),
    };
  }, [lampCal, slCW, slDR, slFR]);

  // ===== Render =====
  return (
    <div className="space-y-5">
      {/* PAR vs Full Spectrum Explanation */}
      <div className="border border-blue-300 bg-blue-50 rounded-lg p-4 space-y-3">
        <h3 className="font-semibold text-lg text-blue-900">PAR vs Full Spectrum (Short Explanation)</h3>
        
        <div className="space-y-2">
          <div>
            <h4 className="font-semibold text-blue-800">PAR (400–700 nm)</h4>
            <p className="text-sm text-slate-700">
              <strong>Unit:</strong> µmol/m²/s<br />
              This is the wavelength range used for photosynthesis.
            </p>
          </div>
          
          <div>
            <h4 className="font-semibold text-blue-800">Full Spectrum (300–900 nm)</h4>
            <p className="text-sm text-slate-700">
              <strong>Unit:</strong> µmol/m²/s
            </p>
          </div>
        </div>
        
        <div className="text-sm text-slate-700 border-t border-blue-200 pt-3">
          <p className="mb-2">
            The displayed values are <strong>estimates based on trend-line calculations</strong>. For precise measurements, a spectrometer is required for your exact fixture settings.
          </p>
          <p>
            Sometimes far-red appears as 0 in PAR: not because the spectrometer failed to measure it, but because its output is extremely small compared to the much stronger cool-white and deep-red components within the PAR range.
          </p>
          <div className="mt-3 space-y-1">
            <h4 className="font-semibold text-blue-800">More Posters &amp; Raw Spectra</h4>
            <p>
              For additional posters hanging in the NPEC building, including raw spectral data and calculated ratios B(400–500):R(600–700) and R(655–665):FR(725–735), you can visit the shared folder
              {" "}
              <a
                href="https://drive.google.com/drive/folders/1xWC8XHK52TAQp51PZiaLiuDlUalp0QaL?usp=sharing"
                target="_blank"
                rel="noreferrer"
                className="text-blue-700 underline"
              >
                here
              </a>
              .
            </p>
          </div>
        </div>
      </div>

      {/* Controls */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-2">
          <label className="block text-sm font-medium">Room & Measurement Type</label>
          <select
            className="border rounded p-2 text-sm w-full"
            value={presetIndex}
            onChange={(e: React.ChangeEvent<HTMLSelectElement>) => onChangePreset(parseInt(e.target.value, 10))}
          >
            {presets.map((p: Preset, i: number) => (
              <option key={i} value={i}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
        
        {/* Per-channel sliders */}
        <div className="space-y-2 md:col-span-2">
          <label className="block text-sm font-medium">Channel intensities (%)</label>
          {allChannels.length === 0 ? (
            <div className="text-sm text-slate-500">No channels available for this preset.</div>
          ) : (
            <div className="space-y-3">
              {allChannels.map((ch) => {
                const pct = perChannelPercent[ch] ?? 50;
                const { A, b } = paramsFor(ch);
                const ppfd = Math.max(0, A * pct + b);
                return (
                  <div key={ch} className="flex items-center gap-3">
                    <div className="w-28 text-sm font-medium">{ch}</div>
                    <input
                      type="range" min={0} max={100}
                      value={pct}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPerChannelPercent((prev: Record<ChannelName, number>) => ({ ...prev, [ch]: parseInt(e.target.value, 10) }))}
                      className="w-full" />
                    <input
                      type="number" min={0} max={100}
                      value={pct}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPerChannelPercent((prev: Record<ChannelName, number>) => ({ ...prev, [ch]: clamp(parseFloat(e.target.value || '0')) }))}
                      className="w-20 border rounded p-1 text-sm" />
                    <span className="text-sm text-slate-600">% → {measurementType} ≈ <b>{ppfd.toFixed(2)}</b></span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
      <div className="text-sm mt-2">Total {measurementType} (current) ≈ <b>{totalPPFD.toFixed(2)}</b> µmol/m²/s</div>

      {/* ===== Spectrum Lab ===== */}
      <div className="border-t-2 border-purple-300 pt-5 mt-6 space-y-4">
        <h2 className="text-lg font-bold text-purple-900">Spectrum Lab — Reconstruct &amp; Compare</h2>
        <p className="text-sm text-slate-600">
          Load the lamp calibration CSV (e.g.{" "}
          <code className="bg-slate-100 px-1 rounded">G4_5%_increments_3_lamps.csv</code>) to
          reconstruct spectra from channel intensities. Optionally load a Jeti measurement to
          overlay for comparison.
        </p>

        {/* File pickers */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <label className="block text-sm font-medium">Lamp Calibration CSV</label>
            <ol className="text-xs text-slate-600 space-y-1 list-decimal list-inside">
              <li>
                Download the calibration file for your room from{" "}
                <a
                  href="https://drive.google.com/drive/folders/16m5sowew9blQqUsE5MWhW0qihLIMHwJz?usp=sharing"
                  target="_blank"
                  rel="noreferrer"
                  className="text-blue-600 underline"
                >
                  this Google Drive folder
                </a>
                {" "}(G4, G5, G6, G7 or G8 — only G4 is available so far)
              </li>
              <li>Upload that file below:</li>
            </ol>
            <input type="file" accept=".csv" onChange={onLampCalFileChosen} className="text-sm" />
            {lampCalFile && <div className="text-xs text-slate-500">{lampCalFile}</div>}
            {lampCalError && <div className="text-xs text-red-600">{lampCalError}</div>}
            {lampCal && (
              <div className="text-xs text-green-700">
                ✓ Loaded — {lampCal.coolWhite[0]?.length ?? 0} wavelengths, 3 channels × 20 levels
              </div>
            )}
          </div>
          <div className="space-y-1">
            <label className="block text-sm font-medium">Jeti Reference Spectrum (optional)</label>
            <p className="text-xs text-slate-500 mb-1">
              Load a Jeti spectroradiometer export (.csv, semicolon-delimited, comma as decimal
              separator). The first Ee column is used as a reference and shown as a dashed overlay
              on the reconstructed spectrum chart for direct comparison with predicted output.
            </p>
            <input type="file" accept=".csv" onChange={onJetiRefFileChosen} className="text-sm" />
            {jetiRefFile && <div className="text-xs text-slate-500">{jetiRefFile}</div>}
            {jetiRefError && <div className="text-xs text-red-600">{jetiRefError}</div>}
            {jetiRef.length > 0 && (
              <div className="text-xs text-green-700">✓ {jetiRef.length} points loaded</div>
            )}
          </div>
        </div>

        {/* Channel intensity sliders (5 % steps) */}
        {lampCal && (
          <div className="space-y-3 p-3 border rounded-lg bg-slate-50">
            <label className="block text-sm font-medium">Channel Intensities (1 % steps, interpolated between 5 % measurements)</label>
            {[
              { label: "Cool White", value: slCW, set: setSlCW, color: CHANNEL_COLORS.coolWhite },
              { label: "Deep Red",   value: slDR, set: setSlDR, color: CHANNEL_COLORS.deepRed },
              { label: "Far Red",    value: slFR, set: setSlFR, color: CHANNEL_COLORS.farRed },
            ].map(({ label, value, set, color }) => (
              <div key={label} className="flex items-center gap-3">
                <div className="w-28 text-sm font-medium" style={{ color }}>{label}</div>
                <input
                  type="range" min={0} max={100} step={1}
                  value={value}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => set(parseInt(e.target.value, 10))}
                  className="w-full"
                />
                <input
                  type="number" min={0} max={100}
                  value={value}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => set(clamp(parseInt(e.target.value || "0", 10)))}
                  className="w-16 border rounded p-1 text-sm text-right font-mono"
                />
                <span className="text-sm">%</span>
              </div>
            ))}
          </div>
        )}

        {/* Overlay chart: reconstructed vs measured */}
        {overlayData.length > 0 && (
          <div className="border rounded-lg p-3">
            <div className="font-medium">Spectrum Overlay — Reconstructed vs Measured</div>
            <div className="h-[560px] w-full mt-3">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={overlayData} margin={{ top: 10, right: 20, bottom: 10, left: 10 }}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis
                    dataKey="nm" type="number" domain={["dataMin", "dataMax"]}
                    label={{ value: "Wavelength (nm)", position: "insideBottomRight", offset: -5 }}
                  />
                  <YAxis label={{ value: "Ee [W/(m²·nm)]", angle: -90, position: "insideLeft" }} />
                  <Tooltip
                    labelFormatter={(nm: number) => `${nm} nm`}
                    formatter={(v: any, name: string) => [(v as number).toExponential(3), name]}
                  />
                  <Legend />
                  {reconstructed.length > 0 && (
                    <Line dataKey="reconstructed" name="Reconstructed" stroke="#8b5cf6"
                      dot={false} strokeWidth={2} type="monotone" />
                  )}
                  {jetiRef.length > 0 && (
                    <Line dataKey="measured" name="Measured (Jeti)" stroke="#f59e0b"
                      dot={false} strokeWidth={1.5} strokeDasharray="4 2" type="monotone"
                      connectNulls />
                  )}
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

        {/* Individual channel spectra */}
        {lampCal && reconstructed.length > 0 && (
          <div className="border rounded-lg p-3">
            <div className="font-medium">Individual Channel Spectra</div>
            <div className="h-[480px] w-full mt-3">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart margin={{ top: 10, right: 20, bottom: 10, left: 10 }}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis
                    dataKey="nm" type="number" domain={["dataMin", "dataMax"]}
                    label={{ value: "Wavelength (nm)", position: "insideBottomRight", offset: -5 }}
                  />
                  <YAxis label={{ value: "Ee [W/(m²·nm)]", angle: -90, position: "insideLeft" }} />
                  <Tooltip
                    labelFormatter={(nm: number) => `${nm} nm`}
                    formatter={(v: any, name: string) => [(v as number).toExponential(3), name]}
                  />
                  <Legend />
                  <Line data={channelSpectra.cw} dataKey="ee" name={`Cool White ${slCW}%`}
                    stroke={CHANNEL_COLORS.coolWhite} dot={false} type="monotone" strokeWidth={1.5} />
                  <Line data={channelSpectra.dr} dataKey="ee" name={`Deep Red ${slDR}%`}
                    stroke={CHANNEL_COLORS.deepRed} dot={false} type="monotone" strokeWidth={1.5} />
                  <Line data={channelSpectra.fr} dataKey="ee" name={`Far Red ${slFR}%`}
                    stroke={CHANNEL_COLORS.farRed} dot={false} type="monotone" strokeWidth={1.5} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
