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

// ===== Room configuration for Spectrum Lab =====
type RoomChannelConfig = { key: string; label: string; color: string };
type RoomConfig = { id: string; channels: RoomChannelConfig[] };

const ROOM_CONFIGS: Record<string, RoomConfig> = {
  G4: {
    id: "G4",
    channels: [
      { key: "coolWhite", label: "Cool White", color: "#7aa6ff" },
      { key: "deepRed",   label: "Deep Red",   color: "#e03131" },
      { key: "farRed",    label: "Far Red",     color: "#b1006b" },
    ],
  },
  G5: {
    id: "G5",
    channels: [
      { key: "coolWhite", label: "Cool White", color: "#7aa6ff" },
      { key: "deepRed",   label: "Deep Red",   color: "#e03131" },
      { key: "farRed",    label: "Far Red",     color: "#b1006b" },
    ],
  },
  G6: {
    id: "G6",
    channels: [
      { key: "coolWhite", label: "Cool White", color: "#7aa6ff" },
      { key: "deepRed",   label: "Red",        color: "#e03131" },
      { key: "farRed",    label: "Far Red",     color: "#b1006b" },
    ],
  },
  G7: {
    id: "G7",
    channels: [
      { key: "coolWhite", label: "Cool White", color: "#7aa6ff" },
      { key: "blue",      label: "Blue",       color: "#3b82f6" },
      { key: "cyan",      label: "Cyan",       color: "#06b6d4" },
      { key: "green",     label: "Green",      color: "#22c55e" },
      { key: "amber",     label: "Amber",      color: "#f59e0b" },
      { key: "red",       label: "Red",        color: "#ef4444" },
      { key: "deepRed",   label: "Deep Red",   color: "#e03131" },
      { key: "farRed",    label: "Far Red",     color: "#b1006b" },
    ],
  },
  G8: {
    id: "G8",
    channels: [
      { key: "coolWhite", label: "Cool White", color: "#7aa6ff" },
      { key: "deepRed",   label: "Deep Red",   color: "#e03131" },
      { key: "farRed",    label: "Far Red",     color: "#b1006b" },
    ],
  },
};

/** Detect room from calibration CSV filename. */
function detectRoom(filename: string): RoomConfig | null {
  const upper = filename.toUpperCase();
  // Check longer names first to avoid G7 matching "G7x" vs "G7"
  for (const key of ["G8", "G7", "G6", "G5", "G4"]) {
    if (upper.includes(key)) return ROOM_CONFIGS[key];
  }
  return null;
}

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

// ===== Spectrum Lab types & helpers =====
type SpectrumPoint = { nm: number; ee: number };

/** Return 0 if value is not a finite number. */
function safeNumber(x: unknown): number {
  const n = typeof x === "number" ? x : parseFloat(String(x).replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

/** Convert spectral irradiance Ee [W/(m²·nm)] → µmol/(s·m²·nm). */
function toUmol(ee: number, wlNm: number): number {
  return safeNumber(ee) * safeNumber(wlNm) * 0.008359;
}

/** Convert an entire spectrum from Ee to µmol/(s·m²·nm). */
function convertSpectrumToUmol(pts: SpectrumPoint[]): SpectrumPoint[] {
  return pts.map(p => ({ nm: p.nm, ee: toUmol(p.ee, p.nm) }));
}

/** Integrate spectrum via trapezoidal rule → total µmol/(s·m²).
 *  If minNm / maxNm are provided, only wavelengths in that range are included. */
function integrateSpectrum(pts: SpectrumPoint[], minNm = 0, maxNm = Infinity): number {
  const filtered = pts.filter(p => p.nm >= minNm && p.nm <= maxNm);
  if (filtered.length < 2) return filtered.length === 1 ? filtered[0].ee : 0;
  let sum = 0;
  for (let i = 1; i < filtered.length; i++) {
    const dLambda = filtered[i].nm - filtered[i - 1].nm;
    sum += 0.5 * (filtered[i].ee + filtered[i - 1].ee) * dLambda;
  }
  return sum;
}

/**
 * Lamp calibration data: channel key → array of 20 spectra (5 %, 10 %, …, 100 %).
 * For G4/G5/G6/G8: { coolWhite, deepRed, farRed }
 * For G7: { coolWhite, blue, cyan, green, amber, red, deepRed, farRed }
 */
type LampCalibrationData = Record<string, SpectrumPoint[][]>;

/**
 * Parse a Jeti multi-measurement CSV for any room.
 * The room config determines how many channels and thus how many column groups
 * (each group = 20 levels at 5 % increments).
 */
function parseLampCalibrationCsv(text: string, roomConfig: RoomConfig): LampCalibrationData {
  const lines = text.split(/\r?\n/);
  let headerIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/Wavelength\s*\[nm\]/i.test(lines[i])) { headerIdx = i; break; }
  }
  if (headerIdx < 0) throw new Error("Header row containing 'Wavelength [nm]' not found");

  const headerCols = lines[headerIdx].split(";");
  const wlCol = headerCols.findIndex(c => /Wavelength\s*\[nm\]/i.test(c.trim()));
  if (wlCol < 0) throw new Error("'Wavelength [nm]' column not found in header");

  const numChannels = roomConfig.channels.length;
  const levelsPerChannel = 20;
  const totalDataCols = numChannels * levelsPerChannel;
  const dataStartCol = wlCol + 1;

  const data: LampCalibrationData = {};
  for (const ch of roomConfig.channels) {
    data[ch.key] = Array.from({ length: levelsPerChannel }, () => []);
  }

  for (let i = headerIdx + 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const parts = line.split(";");
    if (parts.length < dataStartCol + totalDataCols) continue;
    const nm = safeNumber(parts[wlCol]?.replace(",", "."));
    if (nm === 0) continue;
    for (let chIdx = 0; chIdx < numChannels; chIdx++) {
      const chKey = roomConfig.channels[chIdx].key;
      const baseCol = dataStartCol + chIdx * levelsPerChannel;
      for (let j = 0; j < levelsPerChannel; j++) {
        const val = safeNumber(parts[baseCol + j]?.replace(",", "."));
        data[chKey][j].push({ nm, ee: val });
      }
    }
  }
  return data;
}

/** Parse a single Jeti measurement CSV — finds columns by header name. */
function parseJetiSpectrumCsv(text: string): SpectrumPoint[] {
  const lines = text.split(/\r?\n/);
  let headerIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/Wavelength\s*\[nm\]/i.test(lines[i])) { headerIdx = i; break; }
  }
  if (headerIdx < 0) throw new Error("Header row containing 'Wavelength [nm]' not found");

  const headerCols = lines[headerIdx].split(";");
  const wlCol = headerCols.findIndex(c => /Wavelength\s*\[nm\]/i.test(c.trim()));
  if (wlCol < 0) throw new Error("'Wavelength [nm]' column not found in header");
  const eeCol = headerCols.findIndex(c => /Ee\s*\[W\/\(sqm\*nm\)\]/i.test(c.trim()));
  if (eeCol < 0) throw new Error("'Ee [W/(sqm*nm)]' column not found in header");

  const pts: SpectrumPoint[] = [];
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const parts = line.split(";");
    const nm = safeNumber(parts[wlCol]?.replace(",", "."));
    const ee = safeNumber(parts[eeCol]?.replace(",", "."));
    if (nm > 0) pts.push({ nm, ee });
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

/** Sum all channel spectra at given percentages into one combined spectrum. */
function reconstructSpectrum(
  cal: LampCalibrationData,
  percents: Record<string, number>,
): SpectrumPoint[] {
  const channelKeys = Object.keys(cal);
  if (channelKeys.length === 0) return [];

  const channelSpectra = channelKeys.map(key =>
    spectrumAtPercent(cal[key], percents[key] ?? 0)
  );

  return channelSpectra[0].map((p, i) => ({
    nm: p.nm,
    ee: channelSpectra.reduce((sum, sp) => sum + (sp[i]?.ee ?? 0), 0),
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
  const [activeRoom, setActiveRoom] = useState<RoomConfig | null>(null);
  const [jetiRef, setJetiRef] = useState<SpectrumPoint[]>([]);
  const [jetiRefFile, setJetiRefFile] = useState("");
  const [jetiRefError, setJetiRefError] = useState("");
  const [specSliders, setSpecSliders] = useState<Record<string, number>>({});
  const [parMinNm, setParMinNm] = useState(400);
  const [parMaxNm, setParMaxNm] = useState(700);

  function onLampCalFileChosen(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setLampCalFile(file.name);
    setLampCalError("");
    const detected = detectRoom(file.name);
    if (!detected) {
      setLampCalError("Could not detect room from filename. Expected G4, G5, G6, G7 or G8 in the filename.");
      setLampCal(null);
      setActiveRoom(null);
      return;
    }
    setActiveRoom(detected);
    // Initialize sliders to 50 % for all channels of the detected room
    const initSliders: Record<string, number> = {};
    for (const ch of detected.channels) initSliders[ch.key] = 50;
    setSpecSliders(initSliders);

    const reader = new FileReader();
    reader.onload = () => {
      try {
        setLampCal(parseLampCalibrationCsv(reader.result as string, detected));
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
    return convertSpectrumToUmol(reconstructSpectrum(lampCal, specSliders));
  }, [lampCal, specSliders]);

  const jetiRefUmol = useMemo(() => convertSpectrumToUmol(jetiRef), [jetiRef]);

  const overlayData = useMemo(() => {
    if (!reconstructed.length && !jetiRefUmol.length) return [];
    const map = new Map<number, { nm: number; reconstructed?: number; measured?: number }>();
    for (const pt of reconstructed) map.set(pt.nm, { nm: pt.nm, reconstructed: pt.ee });
    for (const pt of jetiRefUmol) {
      const existing = map.get(pt.nm);
      if (existing) existing.measured = pt.ee;
      else map.set(pt.nm, { nm: pt.nm, measured: pt.ee });
    }
    return Array.from(map.values()).sort((a, b) => a.nm - b.nm);
  }, [reconstructed, jetiRefUmol]);

  const channelSpectra = useMemo(() => {
    if (!lampCal || !activeRoom) return {} as Record<string, SpectrumPoint[]>;
    const result: Record<string, SpectrumPoint[]> = {};
    for (const ch of activeRoom.channels) {
      if (lampCal[ch.key]) {
        result[ch.key] = convertSpectrumToUmol(spectrumAtPercent(lampCal[ch.key], specSliders[ch.key] ?? 0));
      }
    }
    return result;
  }, [lampCal, activeRoom, specSliders]);

  // PAR per channel (integrated µmol/(s·m²)) filtered by wavelength range
  const channelPAR = useMemo(() => {
    const result: Record<string, number> = {};
    for (const key of Object.keys(channelSpectra)) {
      result[key] = integrateSpectrum(channelSpectra[key], parMinNm, parMaxNm);
    }
    return result;
  }, [channelSpectra, parMinNm, parMaxNm]);

  // Total PAR from reconstructed spectrum
  const reconstructedPAR = useMemo(() => integrateSpectrum(reconstructed, parMinNm, parMaxNm), [reconstructed, parMinNm, parMaxNm]);

  // Jeti reference PAR
  const jetiRefPAR = useMemo(() => integrateSpectrum(jetiRefUmol, parMinNm, parMaxNm), [jetiRefUmol, parMinNm, parMaxNm]);

  // ===== Render =====
  return (
    <div className="space-y-5">
      {/* Info box */}
      <div className="border border-blue-300 bg-blue-50 rounded-lg p-4 space-y-3">
        <h3 className="font-semibold text-lg text-blue-900">Spectrum Lab - Reconstruct &amp; Compare</h3>
        <div className="text-sm text-slate-700 space-y-2">
          <p>
            Upload the lamp calibration CSV for your room (G4-G8) to reconstruct the emitted
            spectrum at any combination of channel intensities. The calibration file contains
            Jeti spectroradiometer measurements at 5&thinsp;% intensity steps for each lamp
            channel; values in between are linearly interpolated.
          </p>
          <p>
            The calibration files for all rooms are available on{" "}
            <a
              href="https://drive.google.com/drive/folders/16m5sowew9blQqUsE5MWhW0qihLIMHwJz?usp=sharing"
              target="_blank"
              rel="noreferrer"
              className="text-blue-700 underline"
            >
              this Google Drive folder
            </a>
            . The filename includes the room name (e.g. G4) so the room is detected automatically
            when you upload the file.
          </p>
          <p>
            You can optionally upload a Jeti reference measurement to overlay on top of the
            reconstruction. This can be a spectrum you measured yourself, a result from a previous
            experiment, or any other Jeti export in the same semicolon-delimited format.
          </p>
          <p>
            The integrated value (&micro;mol/(s&middot;m&sup2;)) is computed over the wavelength range you
            specify below the sliders. The default is 400-700&thinsp;nm (PAR), but you can change
            it to include far-red or a wider range as needed.
          </p>
          <div className="border-t border-blue-200 pt-3 mt-1 space-y-1">
            <h4 className="font-semibold text-blue-800">More posters &amp; raw spectra</h4>
            <p>
              For additional posters in the NPEC building, including raw spectral data and
              calculated ratios B(400-500):R(600-700) and R(655-665):FR(725-735), visit the
              shared folder{" "}
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

      {/* File pickers */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-2">
          <label className="block text-sm font-medium">Lamp calibration CSV</label>
          <p className="text-xs">
            <a href="https://drive.google.com/drive/folders/16m5sowew9blQqUsE5MWhW0qihLIMHwJz?usp=sharing" target="_blank" rel="noreferrer" className="text-blue-700 underline">Google Drive Folder</a>
          </p>
          <input type="file" accept=".csv" onChange={onLampCalFileChosen} className="text-sm" />
          {lampCalFile && <div className="text-xs text-slate-500">{lampCalFile}</div>}
          {lampCalError && <div className="text-xs text-red-600">{lampCalError}</div>}
          {lampCal && activeRoom && (
            <div className="text-xs text-green-700">
              Loaded - {Object.values(lampCal)[0]?.[0]?.length ?? 0} wavelengths, {activeRoom.channels.length} channels x 20 levels - room: {activeRoom.id}
            </div>
          )}
        </div>
        <div className="space-y-2">
          <label className="block text-sm font-medium">Jeti reference spectrum (optional)</label>
          <p className="text-xs text-slate-500">
            A Jeti export from this room, a previous experiment, or any other measurement you
            want to compare against. Must be a semicolon-delimited CSV with a
            Wavelength&thinsp;[nm] and Ee&thinsp;[W/(sqm*nm)] column.
          </p>
          <input type="file" accept=".csv" onChange={onJetiRefFileChosen} className="text-sm" />
          {jetiRefFile && <div className="text-xs text-slate-500">{jetiRefFile}</div>}
          {jetiRefError && <div className="text-xs text-red-600">{jetiRefError}</div>}
          {jetiRef.length > 0 && (
            <div className="text-xs text-green-700">
              {jetiRef.length} points loaded - reference ({parMinNm}-{parMaxNm} nm): {jetiRefPAR.toFixed(1)} µmol/(s·m²)
            </div>
          )}
        </div>
      </div>

        {/* Channel intensity sliders (5 % steps) */}
        {lampCal && activeRoom && (
          <div className="space-y-3 p-3 border rounded-lg bg-slate-50">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
              <label className="text-sm font-medium">Channel intensities (1 % steps, interpolated between 5 % measurements)</label>
              <div className="ml-auto flex items-center gap-2 text-sm">
                <span className="text-xs text-slate-500">Sum the spectrum over</span>
                <input
                  type="number" min={200} max={1100}
                  value={parMinNm}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setParMinNm(Math.max(0, parseInt(e.target.value || "0", 10)))}
                  className="w-16 border rounded p-1 text-sm text-center font-mono"
                />
                <span className="text-slate-500">-</span>
                <input
                  type="number" min={200} max={1100}
                  value={parMaxNm}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setParMaxNm(Math.max(0, parseInt(e.target.value || "0", 10)))}
                  className="w-16 border rounded p-1 text-sm text-center font-mono"
                />
                <span className="text-slate-500">nm</span>
              </div>
            </div>
            {activeRoom.channels.map((ch) => (
              <div key={ch.key} className="flex items-center gap-2">
                <div className="w-24 text-sm font-medium truncate" style={{ color: ch.color }}>{ch.label}</div>
                <input
                  type="range" min={0} max={100} step={1}
                  value={specSliders[ch.key] ?? 50}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSpecSliders((prev) => ({ ...prev, [ch.key]: parseInt(e.target.value, 10) }))}
                  className="flex-1 max-w-[420px]"
                />
                <input
                  type="number" min={0} max={100}
                  value={specSliders[ch.key] ?? 50}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSpecSliders((prev) => ({ ...prev, [ch.key]: clamp(parseInt(e.target.value || "0", 10)) }))}
                  className="w-14 border rounded p-1 text-sm text-right font-mono"
                />
                <span className="text-xs">%</span>
                <span className="text-sm font-semibold text-slate-700 w-48 text-right">{(channelPAR[ch.key] ?? 0).toFixed(1)} µmol/(s·m²)</span>
              </div>
            ))}
            <div className="pt-2 border-t text-base font-bold flex flex-wrap gap-x-6 gap-y-1">
              <span>Reconstructed ({parMinNm}–{parMaxNm} nm): {reconstructedPAR.toFixed(1)} µmol/(s·m²)</span>
              {jetiRef.length > 0 && (
                <span>Reference ({parMinNm}–{parMaxNm} nm): {jetiRefPAR.toFixed(1)} µmol/(s·m²)</span>
              )}
            </div>
          </div>
        )}

        {/* Overlay chart: reconstructed vs measured */}
        {overlayData.length > 0 && (
          <div className="border rounded-lg p-3">
            <div className="font-medium">Spectrum Overlay - Reconstructed vs Measured</div>
            <div className="h-[560px] w-full mt-3">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={overlayData} margin={{ top: 10, right: 20, bottom: 10, left: 10 }}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis
                    dataKey="nm" type="number" domain={["dataMin", "dataMax"]}
                    label={{ value: "Wavelength (nm)", position: "insideBottomRight", offset: -5 }}
                  />
                  <YAxis label={{ value: "μmol/(s·m²·nm)", angle: -90, position: "insideLeft" }} />
                  <Tooltip
                    labelFormatter={(nm: number) => `${nm} nm`}
                    formatter={(v: any, name: string) => [(v as number).toPrecision(4), name]}
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
        {lampCal && activeRoom && reconstructed.length > 0 && (
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
                  <YAxis label={{ value: "μmol/(s·m²·nm)", angle: -90, position: "insideLeft" }} />
                  <Tooltip
                    labelFormatter={(nm: number) => `${nm} nm`}
                    formatter={(v: any, name: string) => [(v as number).toPrecision(4), name]}
                  />
                  <Legend />
                  {activeRoom.channels.map((ch) => (
                    <Line
                      key={ch.key}
                      data={channelSpectra[ch.key] ?? []}
                      dataKey="ee"
                      name={`${ch.label} ${specSliders[ch.key] ?? 50}%`}
                      stroke={ch.color}
                      dot={false}
                      type="monotone"
                      strokeWidth={1.5}
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}
    </div>
  );
}
