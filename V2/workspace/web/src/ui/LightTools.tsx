import React, { useEffect, useMemo, useRef, useState } from "react";
import { LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, ResponsiveContainer } from "recharts";

// ===== Types =====
type SpectrumPoint = { wavelength: number; A: number; b: number };

type SpectrumSet = { id: string; name: string; points: SpectrumPoint[]; enabled: boolean };

type ChannelParams = { A: number; b: number; /** legacy single-spectrum */ spectrum?: SpectrumPoint[]; /** multiple spectra that can be summed */ spectrumSets?: SpectrumSet[] };

type ShelfName = string;
type ChannelName = string;

type Preset = {
  name: string;
  profile: string;
  shelves: Record<ShelfName, { channels: Record<ChannelName, ChannelParams> }>;
};


type SpectrumRow = { wavelength: number; value: number };

// ===== Default data (existing calibration) =====
const DEFAULT_PRESETS: Preset[] = [
  {
    name: "Two shelves General",
    profile: "Fytotron",
    shelves: {
      high: {
        channels: {
          coolWhite: { A: 4.75930888, b: 6.95239179 },
          deepRed: { A: 0.2068177175, b: 0.29237353 },
          farRed: { A: 0.645981561, b: 2.18807104 },
        },
      },
      // Low shelf receives its own set percentage PLUS a leakage shift from the high shelf.
      // The A/b here define how much of the HIGH shelf setpoint leaks into LOW (percent space).
      // Effective LOW % = clamp( low_user% + (A*high_user% + b), 0..100 )
      lowshifted: {
        channels: {
          coolWhite: { A: 0.2061208, b: 1.18077098 },
          deepRed: { A: 0.00809161908, b: 0.009599985 },
          farRed: { A: 0.021290318316, b: 0.102429302 },
        },
      },
    },
  },
  {
    name: "Daylight General",
    profile: "Daylight",
    shelves: {
      single: {
        channels: {
          coolWhite: { A: 4.57636951, b: 18.77992866 },
          blue: { A: 0.297167436225, b: 7.2744976875 },
          cyan: { A: 0.239824355125, b: 3.8916245085 },
          green: { A: 0.129337367075, b: 3.2390840145 },
          amber: { A: 0.07438576425, b: 0.390141785 },
          Red: { A: 0.46074158586, b: -0.5230835783 },
          deepRed: { A: 0.49537750715, b: 2.37831835 },
          farRed: { A: 0.37021777755, b: 1.37220917 },
          UVA: { A: 0.286002788893, b: -0.12514097314 },
        },
      },
    },
  },
  {
    name: "Helios Growth Room",
    profile: "Helios growth",
    shelves: {
      single: {
        channels: {
          // Updated A/b from your latest file
          coolWhite: { A: 5.23046437365005, b: 10.034218074216131 },
          deepRed: { A: 0.4498239934475001, b: 0.30144158965002354 },
          farRed: { A: 0.7595520201830003, b: 2.293794068060037 },
        },
      },
    },
  },
];

// ===== Helpers =====
function clamp(x: number, lo = 0, hi = 100) {
  return Math.max(lo, Math.min(hi, x));
}

function uid() {
  return Math.random().toString(36).slice(2, 9);
}

function parseSpectrumCSV(csv: string): SpectrumPoint[] {
  // Accepts headers like: wavelength,wavelength_nm,lambda, A, b (case-insensitive)
  // and rows such as: 315.7,0.0123,0.0456
  const lines = csv.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return [];
  const header = lines[0].split(/,|\t/).map((h) => h.trim().toLowerCase());
  const idxLambda = header.findIndex((h) => ["wavelength", "wavelength_nm", "lambda", "nm"].includes(h));
  const idxA = header.findIndex((h) => h === "a" || h === "slope");
  const idxB = header.findIndex((h) => h === "b" || h === "intercept");
  if (idxLambda < 0 || idxA < 0 || idxB < 0) {
    throw new Error("CSV must include columns for wavelength, A, and b (headers may be wavelength_nm, A, b).");
  }
  const out: SpectrumPoint[] = [];
  for (let i = 1; i < lines.length; i++) {
    const parts = lines[i].split(/,|\t/);
    if (parts.length < Math.max(idxLambda, idxA, idxB) + 1) continue;
    const wavelength = parseFloat(parts[idxLambda]);
    const A = parseFloat(parts[idxA]);
    const b = parseFloat(parts[idxB]);
    if (Number.isFinite(wavelength) && Number.isFinite(A) && Number.isFinite(b)) {
      out.push({ wavelength, A, b });
    }
  }
  // Sort by wavelength just in case
  out.sort((a, b) => a.wavelength - b.wavelength);
  return out;
}

function integrateRange(rows: SpectrumRow[], nmMin: number, nmMax: number) {
  // Trapezoidal integration of spectral photon flux density (μE/m²/s/nm) over [nmMin, nmMax]
  const filtered = rows.filter((r) => r.wavelength >= nmMin && r.wavelength <= nmMax);
  if (filtered.length < 2) return 0;
  let area = 0;
  for (let i = 1; i < filtered.length; i++) {
    const x0 = filtered[i - 1].wavelength;
    const x1 = filtered[i].wavelength;
    const y0 = filtered[i - 1].value;
    const y1 = filtered[i].value;
    area += ((y0 + y1) / 2) * (x1 - x0);
  }
  return area; // units: (μE/m²/s/nm)*nm = μE/m²/s
}

function sumSpectraPerChannel(channelSets: { sets: SpectrumSet[]; pct: number }[]): SpectrumRow[] {
  const map = new Map<number, number>();
  for (const { sets, pct } of channelSets) {
    for (const set of sets) {
      if (!set.enabled) continue;
      for (const pt of set.points) {
        const v = pt.A * pct + pt.b;
        map.set(pt.wavelength, (map.get(pt.wavelength) ?? 0) + v);
      }
    }
  }
  return Array.from(map.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([wavelength, value]) => ({ wavelength, value }));
}

// ===== Pretty line color helper =====
const VISIBLE_MIN = 380;
const VISIBLE_MAX = 780;

// Approximate nm → sRGB (Dan Bruton–style piecewise, tweaked for UI)
function nmToRGB(nm: number): [number, number, number] {
  let r = 0, g = 0, b = 0;
  if (nm >= 380 && nm < 440) { r = -(nm - 440) / (440 - 380); g = 0; b = 1; }
  else if (nm < 490)        { r = 0; g = (nm - 440) / (490 - 440); b = 1; }
  else if (nm < 510)        { r = 0; g = 1; b = -(nm - 510) / (510 - 490); }
  else if (nm < 580)        { r = (nm - 510) / (580 - 510); g = 1; b = 0; }
  else if (nm < 645)        { r = 1; g = -(nm - 645) / (645 - 580); b = 0; }
  else if (nm <= 780)       { r = 1; g = 0; b = 0; }
  // simple intensity roll-off at edges
  let factor = 1;
  if (nm > 700) factor = 0.7 - 0.7 * (nm - 700) / (780 - 700);
  if (nm < 420) factor = 0.3 + 0.7 * (nm - 380) / (420 - 380);
  const gamma = 0.8;
  const to255 = (c: number) => Math.round(255 * Math.pow(Math.max(0, Math.min(1, c * factor)), gamma));
  return [to255(r), to255(g), to255(b)];
}
const rgbHex = (r: number, g: number, b: number) =>
  `#${r.toString(16).padStart(2,'0')}${g.toString(16).padStart(2,'0')}${b.toString(16).padStart(2,'0')}`;

type GradStop = { offset: number; color: string; opacity: number };

function buildSpectrumStops(minNm: number, maxNm: number, sampleNms?: number[]): GradStop[] {
  if (maxNm <= minNm) return [{ offset: 0, color: '#999', opacity: 1 }];
  // Use actual wavelengths if available; otherwise sample ~30 points.
  const nms = (sampleNms && sampleNms.length)
    ? sampleNms
    : Array.from({ length: 30 }, (_, i) => minNm + (i * (maxNm - minNm)) / 29);

  return nms.map(nm => {
    const clamped = Math.max(minNm, Math.min(maxNm, nm));
    const offset = (clamped - minNm) / (maxNm - minNm);
    if (nm < VISIBLE_MIN || nm > VISIBLE_MAX) {
      return { offset, color: '#9aa0a6', opacity: 0.35 }; // greyed outside visible
    }
    const [r, g, b] = nmToRGB(nm);
    return { offset, color: rgbHex(r, g, b), opacity: 1 };
  });
}

// ===== DnD helpers for channel pills =====
function useDragList<T>(items: T[], onReorder: (next: T[]) => void) {
  const dragIndex = useRef<number | null>(null);
  function onDragStart(i: number) { dragIndex.current = i; }
  function onDragOver(e: React.DragEvent) { e.preventDefault(); }
  function onDrop(i: number) {
    if (dragIndex.current === null || dragIndex.current === i) return;
    const next = [...items];
    const [moved] = next.splice(dragIndex.current, 1);
    next.splice(i, 0, moved);
    dragIndex.current = null;
    onReorder(next);
  }
  return { onDragStart, onDragOver, onDrop };
}

// ===== Main component =====
export default function LightTools() {
  const [presets, setPresets] = useState<Preset[]>(() => {
    const saved = localStorage.getItem("ppfd.presets.v3");
    if (saved) return JSON.parse(saved);
    // migrate v2 if exists
    const v2 = localStorage.getItem("ppfd.presets.v2");
    return v2 ? JSON.parse(v2) : DEFAULT_PRESETS;
  });
  useEffect(() => {
    localStorage.setItem("ppfd.presets.v3", JSON.stringify(presets));
  }, [presets]);

  const [presetIndex, setPresetIndex] = useState(0);
  const preset = presets[presetIndex];
  useEffect(() => {
    const firstShelf = Object.keys(presets[presetIndex].shelves)[0] || "";
    setShelf(firstShelf);

    setActiveChannels([]);
    setPerChannelPercentHigh({});
    setPerChannelPercentLowUser({});
  }, [presetIndex]);



  const shelfNames = Object.keys(preset.shelves);
  const twoShelfMode = shelfNames.includes("high") && shelfNames.includes("lowshifted");

  const [shelf, setShelf] = useState<ShelfName>(shelfNames[0] || "");
  const allChannels = Object.keys(preset.shelves[twoShelfMode ? (shelf === "lowshifted" ? "high" : shelf) : shelf]?.channels ?? {});

  // Keep editChannel valid whenever shelf/preset/channel list changes
  useEffect(() => {
    if (!allChannels.length) {
      setEditChannel(null);
      return;
    }
    setEditChannel((prev) => (prev && allChannels.includes(prev) ? prev : allChannels[0]));
  }, [presetIndex, shelf, allChannels.join("|")]);

  

  // === NEW: the working mix (user-selected channels, order matters) ===
  const [activeChannels, setActiveChannels] = useState<ChannelName[]>([]);
  const [editChannel, setEditChannel] = useState<ChannelName | null>(null);

  // per-channel percents
  const [perChannelPercentHigh, setPerChannelPercentHigh] = useState<Record<ChannelName, number>>({});
  const [perChannelPercentLowUser, setPerChannelPercentLowUser] = useState<Record<ChannelName, number>>({});

  // Derived LOW effective per channel
  const lowShiftTable: Record<ChannelName, ChannelParams> = twoShelfMode
    ? preset.shelves["lowshifted"]?.channels ?? {}
    : {} as any;

  function selectedPercentFor(channel: ChannelName): number {
    if (!twoShelfMode) return perChannelPercentHigh[channel] ?? 0;
    if (shelf === "high") return perChannelPercentHigh[channel] ?? 0;
    const hi = perChannelPercentHigh[channel] ?? 0;
    const lowUser = perChannelPercentLowUser[channel] ?? 0;
    const leak = (lowShiftTable[channel]?.A ?? 0) * hi + (lowShiftTable[channel]?.b ?? 0);
    return clamp(lowUser + leak);
  }

  // Active channel params come from driving shelf ("high" if two-shelf)
  function paramsFor(channel: ChannelName): ChannelParams {
    const shelfKey = twoShelfMode ? "high" : shelf;
    return preset.shelves[shelfKey]?.channels[channel] ?? { A: 1, b: 0 };
  }

  // Migrate any legacy single-spectrum to spectrumSets when a channel becomes active
  useEffect(() => {
    const shelfKey = twoShelfMode ? "high" : shelf;
    const next = [...presets];
    let changed = false;
    for (const chName of activeChannels) {
      const ch = next[presetIndex].shelves[shelfKey]?.channels[chName];
      if (ch && ch.spectrum && !ch.spectrumSets) {
        const migrated: SpectrumSet = { id: uid(), name: `${chName} spectrum`, points: ch.spectrum, enabled: true };
        next[presetIndex].shelves[shelfKey].channels[chName] = { ...ch, spectrumSets: [migrated], spectrum: undefined };
        changed = true;
      }
    }
    if (changed) setPresets(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeChannels, shelf, twoShelfMode]);

  function onChangePreset(idx: number) {
    setPresetIndex(idx);
    // reset working mix & CSVs to avoid cross-profile leakage
    clearSpectraAndMix();
  }

  function clearSpectraAndMix() {
    const next = [...presets];
    const shelfKeys = Object.keys(next[presetIndex].shelves);
    for (const sk of shelfKeys) {
      const chs = next[presetIndex].shelves[sk].channels;
      for (const cname of Object.keys(chs)) {
        if (chs[cname].spectrumSets?.length) {
          chs[cname] = { ...chs[cname], spectrumSets: [] };
        }
      }
    }
    setPresets(next);
    setActiveChannels([]);
    setEditChannel(null);
    setPerChannelPercentHigh({});
    setPerChannelPercentLowUser({});
  }

  // ===== CSV attachment (now can map multiple files to multiple channels) =====
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  function attachCSVPrompt() { fileInputRef.current?.click(); }

  async function onCSVSelected(files: FileList) {
  try {
    const shelfKey = twoShelfMode ? "high" : shelf; // spectra live with driving shelf
    const next = [...presets];

    // Enforce single file
    if (!files || files.length === 0) return;
    if (files.length > 1) {
      alert("Only one CSV per channel is allowed. Please select a single file.");
      return;
    }

    // Decide the channel: always the currently selected one
    const targetChannel = editChannel || allChannels[0];
    if (!targetChannel) {
      alert("No channel selected.");
      return;
    }

    const f = files[0];
    const text = await f.text();
    const points = parseSpectrumCSV(text);

    // Replace any existing CSV for this channel with the new one
    const ch = next[presetIndex].shelves[shelfKey].channels[targetChannel] ?? { A: 1, b: 0 };
    const newSet: SpectrumSet = { id: uid(), name: f.name, points, enabled: true };
    next[presetIndex].shelves[shelfKey].channels[targetChannel] = { ...ch, spectrumSets: [newSet] };

    setPresets(next);
  } catch (err: any) {
    alert("Failed to parse CSV: " + err?.message);
  }
}


  function toggleSetEnabled(channelName: ChannelName, setId: string, enabled: boolean) {
    const next = [...presets];
    const shelfKey = twoShelfMode ? "high" : shelf;
    const ch = next[presetIndex].shelves[shelfKey].channels[channelName];
    if (!ch || !ch.spectrumSets) return;
    ch.spectrumSets = ch.spectrumSets.map((s) => (s.id === setId ? { ...s, enabled } : s));
    setPresets(next);
  }

  function removeSet(channelName: ChannelName, setId: string) {
    const next = [...presets];
    const shelfKey = twoShelfMode ? "high" : shelf;
    const ch = next[presetIndex].shelves[shelfKey].channels[channelName];
    if (!ch || !ch.spectrumSets) return;
    ch.spectrumSets = ch.spectrumSets.filter((s) => s.id !== setId);
    setPresets(next);
  }

  // ===== Working mix controls =====
  function addSelectedChannelToMix() {
    const selected = editChannel || allChannels[0];
    if (!selected) return;
    if (activeChannels.includes(selected)) return;
    const nextOrder = [...activeChannels, selected];
    setActiveChannels(nextOrder);
    setEditChannel(selected);
    setPerChannelPercentHigh((prev) => ({ ...prev, [selected]: 50 }));
    if (twoShelfMode) setPerChannelPercentLowUser((prev) => ({ ...prev, [selected]: 40 }));
  }

  function removeChannelFromMix(name: ChannelName) {
    setActiveChannels((prev) => prev.filter((c) => c !== name));
    setPerChannelPercentHigh((prev) => { const n = { ...prev }; delete n[name]; return n; });
    setPerChannelPercentLowUser((prev) => { const n = { ...prev }; delete n[name]; return n; });
    if (editChannel === name) setEditChannel(null);
  }

  // reorder pills
  const { onDragStart, onDragOver, onDrop } = useDragList(activeChannels, setActiveChannels);

  // ===== Spectrum visualization (summed over all active channels) =====
  const perChannelSets = useMemo(() => {
    const shelfKey = twoShelfMode ? "high" : shelf;
    return activeChannels.map((c) => ({
      channel: c,
      sets: (presets[presetIndex].shelves[shelfKey].channels[c]?.spectrumSets ?? []) as SpectrumSet[],
      // Each channel uses its own %; on LOW shelf in 2-shelf mode, use effective low %
      pct: twoShelfMode && shelf === "lowshifted"
        ? selectedPercentFor(c)
        : (perChannelPercentHigh[c] ?? 0),
    }));
  // robust deps so changes to any channel % will rerun this calc
  }, [
    activeChannels.join("|"),
    presets,
    presetIndex,
    shelf,
    twoShelfMode,
    JSON.stringify(perChannelPercentHigh),
    JSON.stringify(perChannelPercentLowUser),
  ]);


  const componentSeries = useMemo(() => {
    // show each channel as a dashed series (sum of that channel's sets)
    return perChannelSets.map(({ channel, sets, pct }) => {
      const data = sumSpectraPerChannel([{ sets: sets.filter(s => s.enabled), pct }]);
      return { name: channel, data };
    });
  }, [perChannelSets]);

  const combinedData: SpectrumRow[] = useMemo(
    () => sumSpectraPerChannel(
      perChannelSets.map(({ sets, pct }) => ({ sets: sets.filter(s => s.enabled), pct }))
    ),
    [JSON.stringify(perChannelSets)]
  );


  // Integration range (nm) & result
  const [nmMin, setNmMin] = useState<number>(400);
  const [nmMax, setNmMax] = useState<number>(700);
  const parIntegrated = useMemo(() => integrateRange(combinedData, Math.min(nmMin, nmMax), Math.max(nmMin, nmMax)), [combinedData, nmMin, nmMax]);

  const domainMin = combinedData.length ? combinedData[0].wavelength : 380;
  const domainMax = combinedData.length ? combinedData[combinedData.length - 1].wavelength : 780;

  // Use actual wavelengths for best alignment
  const spectrumStops = React.useMemo(
    () => buildSpectrumStops(domainMin, domainMax, combinedData.map(d => d.wavelength)),
    [domainMin, domainMax, combinedData]
  );

  // total PPFD (sum of each channel's PPFD at its %)
  const totalPPFD = useMemo(() => {
    return activeChannels.reduce((acc, c) => {
      const p = paramsFor(c);
      const pct = (shelf === "high" || !twoShelfMode) ? (perChannelPercentHigh[c] ?? 0) : selectedPercentFor(c);
      // For display, when on LOW shelf we show effective %, but PPFD still uses the same A/b mapping per shelf selection
      return acc + (p.A * pct + p.b);
    }, 0);
  }, [activeChannels, perChannelPercentHigh, twoShelfMode, shelf]);

  // ===== Render =====
  return (
    <div className="space-y-5">
      <div className="text-l text-slate-1000">
        <b>Important Note: </b> The PPFD to device % conversion is calculated based on linear regression with measured parameters, and thus should only be considered as a reference rather than the precise actual value!
      </div>

      {/* Controls */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="space-y-2">
          <label className="block text-sm font-medium">Preset</label>
          <select
            className="border rounded p-2 text-sm w-full"
            value={presetIndex}
            onChange={(e) => onChangePreset(parseInt(e.target.value, 10))}
          >
            {presets.map((p, i) => (
              <option key={i} value={i}>
                {p.name} ({p.profile})
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-2">
          <label className="block text-sm font-medium">Shelf</label>
          <select
            className="border rounded p-2 text-sm w-full"
            value={shelf}
            onChange={(e) => { setShelf(e.target.value); clearSpectraAndMix(); }}
          >
            {Object.keys(preset.shelves).map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          {twoShelfMode && (
            <p className="text-xs text-slate-500">
              In two-shelf mode, LOW uses user % plus leakage from HIGH (configured by lowshift A/b). Switching shelves clears graphs & CSVs.
            </p>
          )}
        </div>

        <div className="space-y-2">
          <label className="block text-sm font-medium">Channel</label>
          <div className="flex gap-2 items-center">
            <select
              className="border rounded p-2 text-sm flex-1"
              value={editChannel ?? allChannels[0] ?? ""}
              onChange={(e) => setEditChannel(e.target.value)}
            >
              {allChannels.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
            <button onClick={addSelectedChannelToMix} className="px-2 py-1 text-sm border rounded" title="Add currently selected channel to the mix">
              + Add to mix
            </button>
          </div>
          <div className="text-xs text-slate-500">Calibration lives with the driving shelf ("high" in two-shelf mode). The mix below controls each channel separately.</div>
        </div>

        <div className="space-y-2">
          <label className="block text-sm font-medium">A / b (selected channel)</label>
          {editChannel ? (
            <div className="text-sm p-2 border rounded bg-slate-50">A = {paramsFor(editChannel).A}, b = {paramsFor(editChannel).b}</div>
          ) : (
            <div className="text-sm p-2 border rounded bg-slate-50">Select a channel</div>
          )}
        </div>
      </div>

      {/* NEW: Channel switcher (order = CSV mapping order). Drag to reorder. */}
      <div className="space-y-2">
        <label className="block text-sm font-medium">Active channels</label>
        {activeChannels.length === 0 ? (
          <div className="text-sm text-slate-500">Use "+ Add to mix" to add channels. The order here determines how multi-file CSV imports map to channels.</div>
        ) : (
          <div className="flex flex-wrap gap-2">
            {activeChannels.map((c, i) => (
              <button
                key={c}
                draggable
                onDragStart={() => onDragStart(i)}
                onDragOver={onDragOver}
                onDrop={() => onDrop(i)}
                onClick={() => setEditChannel(c)}
                className={`px-3 py-1 rounded-full border text-sm flex items-center gap-2 ${editChannel === c ? 'bg-slate-800 text-white' : 'bg-white'}`}
                title="Drag to reorder"
              >
                <span className="font-medium">{c}</span>
                <span className="text-xs text-slate-600">{selectedPercentFor(c).toFixed(0)}%</span>
                <span className="ml-1 text-red-600 cursor-pointer" onClick={(e) => { e.stopPropagation(); removeChannelFromMix(c); }} title="Remove">×</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Intensity controls: edits the currently selected channel in the mix */}
      {editChannel && (
        <div className="space-y-4">
          {!twoShelfMode && (
            <div className="space-y-2">
              <label className="block text-sm font-medium">Intensity for {editChannel} (%)</label>
              <div className="flex items-center gap-3">
                <input
                  type="range" min={0} max={100}
                  value={perChannelPercentHigh[editChannel] ?? 0}
                  onChange={(e) => setPerChannelPercentHigh((prev) => ({ ...prev, [editChannel]: parseInt(e.target.value, 10) }))}
                  className="w-full" />
                <input
                  type="number" min={0} max={100}
                  value={perChannelPercentHigh[editChannel] ?? 0}
                  onChange={(e) => setPerChannelPercentHigh((prev) => ({ ...prev, [editChannel]: clamp(parseFloat(e.target.value || '0')) }))}
                  className="w-20 border rounded p-1 text-sm" />
                <span className="text-sm text-slate-600">%</span>
              </div>
              <div className="flex items-center gap-3 text-sm">
                <div>
                  PPFD ({editChannel}) ≈ <b>{(paramsFor(editChannel).A * (perChannelPercentHigh[editChannel] ?? 0) + paramsFor(editChannel).b).toFixed(2)}</b>
                </div>
              </div>
            </div>
          )}

          {twoShelfMode && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="space-y-2">
                <label className="block text-sm font-medium">High shelf % — {editChannel}</label>
                <div className="flex items-center gap-3">
                  <input type="range" min={0} max={100}
                    value={perChannelPercentHigh[editChannel] ?? 0}
                    onChange={(e) => setPerChannelPercentHigh((prev) => ({ ...prev, [editChannel]: parseInt(e.target.value, 10) }))}
                    className="w-full" />
                  <input type="number" min={0} max={100}
                    value={perChannelPercentHigh[editChannel] ?? 0}
                    onChange={(e) => setPerChannelPercentHigh((prev) => ({ ...prev, [editChannel]: clamp(parseFloat(e.target.value || '0')) }))}
                    className="w-20 border rounded p-1 text-sm" />
                  <span className="text-sm text-slate-600">%</span>
                </div>
                <div className="text-xs text-slate-600">High PPFD ≈ {(paramsFor(editChannel).A * (perChannelPercentHigh[editChannel] ?? 0) + paramsFor(editChannel).b).toFixed(2)}</div>
              </div>
              <div className="space-y-2">
                <label className="block text-sm font-medium">Low shelf user % — {editChannel}</label>
                <div className="flex items-center gap-3">
                  <input type="range" min={0} max={100}
                    value={perChannelPercentLowUser[editChannel] ?? 0}
                    onChange={(e) => setPerChannelPercentLowUser((prev) => ({ ...prev, [editChannel]: parseInt(e.target.value, 10) }))}
                    className="w-full" />
                  <input type="number" min={0} max={100}
                    value={perChannelPercentLowUser[editChannel] ?? 0}
                    onChange={(e) => setPerChannelPercentLowUser((prev) => ({ ...prev, [editChannel]: clamp(parseFloat(e.target.value || '0')) }))}
                    className="w-20 border rounded p-1 text-sm" />
                  <span className="text-sm text-slate-600">%</span>
                </div>
                <div className="text-xs text-slate-600">User-set low %: {(perChannelPercentLowUser[editChannel] ?? 0).toFixed(0)}%</div>
              </div>
              <div className="space-y-2">
                <label className="block text-sm font-medium">Low shelf effective % — {editChannel}</label>
                <div className="flex items-center gap-3">
                  <input type="range" min={0} max={100} value={selectedPercentFor(editChannel)} readOnly className="w-full" />
                  <input type="number" value={selectedPercentFor(editChannel).toFixed(1)} readOnly className="w-20 border rounded p-1 text-sm bg-slate-50" />
                  <span className="text-sm text-slate-600">%</span>
                </div>
                <div className="text-xs text-slate-600">
                  Effective low % = user {(perChannelPercentLowUser[editChannel] ?? 0).toFixed(0)}% + leak ({(lowShiftTable[editChannel]?.A ?? 0).toFixed(3)}×{(perChannelPercentHigh[editChannel] ?? 0).toFixed(0)}% + {(lowShiftTable[editChannel]?.b ?? 0).toFixed(3)}) ⇢ <b>{selectedPercentFor(editChannel).toFixed(1)}%</b>
                </div>
                <div className="text-xs text-slate-600">Low PPFD ≈ {(paramsFor(editChannel).A * selectedPercentFor(editChannel) + paramsFor(editChannel).b).toFixed(2)}</div>
              </div>
            </div>
          )}

          {/* Inverse solve for the channel being edited */}
          <div className="space-y-2">
            <label className="block text-sm font-medium">Inverse: target PPFD for {editChannel}</label>
            <div className="flex gap-2 items-center">
              <input
                type="number"
                className="border rounded p-2 text-sm"
                placeholder="e.g., 120"
                onChange={(e) => {
                  const v = parseFloat(e.target.value || "0");
                  const p = paramsFor(editChannel);
                  if (!Number.isFinite(v) || p.A === 0) return;
                  const pct = clamp((v - p.b) / p.A);
                  if (twoShelfMode && shelf !== "high") {
                    const leak = (lowShiftTable[editChannel]?.A ?? 0) * (perChannelPercentHigh[editChannel] ?? 0) + (lowShiftTable[editChannel]?.b ?? 0);
                    setPerChannelPercentLowUser((prev) => ({ ...prev, [editChannel]: clamp(pct - leak) }));
                  } else {
                    setPerChannelPercentHigh((prev) => ({ ...prev, [editChannel]: pct }));
                  }
                }}
              />
              <span className="text-sm text-slate-500">→ set % for this channel</span>
            </div>
          </div>
        </div>
      )}

      {/* Spectrum card */}
      <div className="border rounded-lg p-3">
        <div className="flex items-center justify-between">
          <div>
            <div className="font-medium">Spectrum visualization (sum across channels)</div>
            <div className="text-xs text-slate-500">
              Upload one CSV for each channel. Units are <b>μE/m²/s/nm</b> at each channel's current %.
            </div>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="file"
              ref={fileInputRef}
              /* remove `multiple` */
              onChange={(e) => {
                const files = e.target.files;
                if (files && files.length > 0) onCSVSelected(files);
                if (fileInputRef.current) fileInputRef.current.value = ""; // reset for re-upload
              }}
              accept=".csv,text/csv"
              className="hidden"
            />

            <button onClick={attachCSVPrompt} className="px-3 py-1.5 text-sm border rounded">
              Add CSV
            </button>

          </div>
        </div>

        {activeChannels.length === 0 ? (
          <div className="text-sm text-slate-500 mt-3">No active channels. Add channels to the mix to begin.</div>
        ) : (
          <div className="mt-3 flex flex-wrap gap-4">
            {/* Active sets list per channel */}
            {perChannelSets.map(({ channel, sets }) => (
              <div key={channel} className="text-sm basis-[260px] grow md:basis-[320px]">
                <div className="font-medium mb-1">{channel} CSV</div>

                {sets.length === 0 ? (
                  <div className="text-slate-500">No spectra for {channel}.</div>
                ) : (
                  <div className="not-prose">
                    <label className="inline-flex items-center gap-1 border rounded px-2 py-1">
                      <input
                        type="checkbox"
                        checked={sets[0].enabled}
                        onChange={(e) => toggleSetEnabled(channel, sets[0].id, e.target.checked)}
                      />
                      <span className="truncate max-w-[180px]" title={sets[0].name}>
                        {sets[0].name}
                      </span>
                      <button className="ml-2 text-red-600" onClick={() => removeSet(channel, sets[0].id)} title="Remove">
                        ×
                      </button>
                    </label>
                  </div>
                )}
              </div>
            ))}

            {/* Integration controls */}
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <div>
                Total PPFD ≈ <b>{totalPPFD.toFixed(2)}</b>
              </div>
              <div className="flex items-center gap-2">
                <span>Integrate</span>
                <input type="number" value={nmMin} onChange={(e) => setNmMin(parseFloat(e.target.value || "400"))} className="w-20 border rounded p-1 text-sm" />
                <span>–</span>
                <input type="number" value={nmMax} onChange={(e) => setNmMax(parseFloat(e.target.value || "700"))} className="w-20 border rounded p-1 text-sm" />
                <span>nm</span>
              </div>
              <div>
                Reference PAR {Math.min(nmMin, nmMax)}–{Math.max(nmMin, nmMax)} nm (∫ φ(λ) dλ): <b>{parIntegrated.toFixed(2)}</b> μE/m²/s
              </div>
            </div>

            {/* Chart */}
            <div className="h-72 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart margin={{ top: 10, right: 20, bottom: 10, left: 0 }}>
                  <defs>
                    <linearGradient id="spectrumStroke" x1="0" y1="0" x2="1" y2="0">
                      {spectrumStops.map((s, i) => (
                        <stop key={i} offset={`${(s.offset * 100).toFixed(2)}%`} stopColor={s.color} stopOpacity={s.opacity} />
                      ))}
                    </linearGradient>
                  </defs>

                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="wavelength" type="number" domain={["dataMin", "dataMax"]} tickFormatter={(v) => `${v} nm`} allowDecimals />
                  <YAxis domain={[0, 3.6]} tickFormatter={(v) => `${v}`} label={{ value: "μE/m²/s/nm", angle: -90, position: "insideLeft" }} />
                  <Tooltip formatter={(v: any) => [`${(v as number).toFixed(3)} μE/m²/s/nm`, "Value"]} labelFormatter={(l) => `${l} nm`} />

                  {/* Per-channel dashed sums */}
                  {componentSeries.map((s) => (
                    <Line key={s.name} data={s.data} dataKey="value" name={s.name} dot={false} type="monotone" strokeDasharray="4 2" />
                  ))}
                  {/* Combined line */}
                  <Line data={combinedData} dataKey="value" name="SUM" dot={false} type="monotone" stroke="url(#spectrumStroke)" strokeWidth={2} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}
      </div>

      <div className="text-xs text-slate-500">
        Presets and attached CSVs are stored locally in your browser (no server). Switching shelves or presets clears the working mix and CSVs because they are considered separate settings.
      </div>
    </div>
  );
}
