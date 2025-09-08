import React, { useEffect, useMemo, useRef, useState } from "react";
import { LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, ResponsiveContainer } from "recharts";

// ===== Types =====
type ChannelParams = { A: number; b: number; spectrum?: SpectrumPoint[] };
type ShelfName = string;
type ChannelName = string;

type Preset = {
  name: string;
  profile: string;
  shelves: Record<ShelfName, { channels: Record<ChannelName, ChannelParams> }>;
};

type SpectrumPoint = { wavelength: number; A: number; b: number };

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
      lowshift: {
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

function integratePAR(rows: SpectrumRow[]) {
  // Simple trapezoidal integration between 400–700 nm of irradiance curve
  const filtered = rows.filter((r) => r.wavelength >= 400 && r.wavelength <= 700);
  if (filtered.length < 2) return 0;
  let area = 0;
  for (let i = 1; i < filtered.length; i++) {
    const x0 = filtered[i - 1].wavelength;
    const x1 = filtered[i].wavelength;
    const y0 = filtered[i - 1].value;
    const y1 = filtered[i].value;
    area += ((y0 + y1) / 2) * (x1 - x0);
  }
  return area; // units: (μW/cm^2/nm) * nm = μW/cm^2 over 400–700
}

// ===== Main component =====
export default function LightTools() {
  const [presets, setPresets] = useState<Preset[]>(() => {
    const saved = localStorage.getItem("ppfd.presets.v2");
    return saved ? JSON.parse(saved) : DEFAULT_PRESETS;
  });

  const [presetIndex, setPresetIndex] = useState(0);
  const preset = presets[presetIndex];

  const shelfNames = Object.keys(preset.shelves);
  const twoShelfMode = shelfNames.includes("high") && shelfNames.includes("lowshift");

  const [shelf, setShelf] = useState<ShelfName>(shelfNames[0] || "");
  const channelNames = Object.keys(preset.shelves[shelf]?.channels ?? {});
  const [channel, setChannel] = useState<ChannelName>(channelNames[0] || "");

  // Intensities (%). In two-shelf mode we expose three sliders: HIGH, LOW (user), and LOW SHIFT derived.
  const [percent, setPercent] = useState<number>(50); // for single shelf or "high" in two-shelf mode
  const [percentLowUser, setPercentLowUser] = useState<number>(40); // only for two-shelf mode

  // Derived LOW % with leakage: low_eff = clamp(low_user + (A*high + b))
  const lowShiftParams: ChannelParams | undefined = twoShelfMode
    ? preset.shelves["lowshift"]?.channels[channel]
    : undefined;
  const lowEffectivePercent = useMemo(() => {
    if (!twoShelfMode || !lowShiftParams) return percent; // single shelf
    const leak = lowShiftParams.A * percent + lowShiftParams.b;
    return clamp(percentLowUser + leak);
  }, [twoShelfMode, lowShiftParams, percent, percentLowUser]);

  // Active channel params (use HIGH shelf params if two-shelf, else current shelf's)
  const params: ChannelParams = twoShelfMode
    ? preset.shelves["high"]?.channels[channel] ?? { A: 1, b: 0 }
    : preset.shelves[shelf]?.channels[channel] ?? { A: 1, b: 0 };

  // PPFD for whichever shelf is selected in UI
  const selectedShelfPercent = twoShelfMode
    ? shelf === "high"
      ? percent
      : lowEffectivePercent
    : percent;

  const ppfd = useMemo(() => params.A * selectedShelfPercent + params.b, [params, selectedShelfPercent]);

  function inverseSolve(target: number) {
    if (!Number.isFinite(target) || params.A === 0) return 0;
    return clamp((target - params.b) / params.A);
  }

  function onChangePreset(idx: number) {
    setPresetIndex(idx);
    const shs = Object.keys(presets[idx].shelves);
    setShelf(shs[0] || "");
    const chs = Object.keys(presets[idx].shelves[shs[0]]?.channels ?? {});
    setChannel(chs[0] || "");
  }

  function savePresets(next: Preset[]) {
    setPresets(next);
    localStorage.setItem("ppfd.presets.v2", JSON.stringify(next));
  }

  function addChannel() {
    const name = prompt("Channel name? (e.g., coolWhite)");
    if (!name) return;
    const A = parseFloat(prompt("A (slope)?", "1.0") || "1");
    const b = parseFloat(prompt("b (offset)?", "0.0") || "0");
    const next = [...presets];
    const shelfKey = twoShelfMode ? "high" : shelf; // calibration lives with the driving shelf
    next[presetIndex].shelves[shelfKey].channels[name] = { A, b };
    savePresets(next);
    setChannel(name);
  }

  // ===== CSV attachment per channel =====
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  function attachCSVPrompt() {
    fileInputRef.current?.click();
  }

  async function onCSVSelected(file: File) {
    try {
      const text = await file.text();
      const spectrum = parseSpectrumCSV(text);
      const next = [...presets];
      const shelfKey = twoShelfMode ? "high" : shelf;
      const ch = next[presetIndex].shelves[shelfKey].channels[channel] ?? { A: 1, b: 0 };
      ch.spectrum = spectrum;
      next[presetIndex].shelves[shelfKey].channels[channel] = ch;
      savePresets(next);
    } catch (err: any) {
      alert("Failed to parse CSV: " + err?.message);
    }
  }

  // ===== Spectrum visualization =====
  const spectrumData: SpectrumRow[] = useMemo(() => {
    const s = params.spectrum;
    if (!s || s.length === 0) return [];
    const pct = selectedShelfPercent;
    return s.map((pt) => ({ wavelength: pt.wavelength, value: pt.A * pct + pt.b }));
  }, [params.spectrum, selectedShelfPercent]);

  const parIntegrated = useMemo(() => integratePAR(spectrumData), [spectrumData]);

  // ===== Render =====
  return (
    <div className="space-y-5">
      {/* Controls */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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
            onChange={(e) => setShelf(e.target.value)}
          >
            {Object.keys(preset.shelves).map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          {twoShelfMode && (
            <p className="text-xs text-slate-500">
              In two-shelf mode, PPFD for <b>low</b> uses LOW% + leakage from HIGH (configured by lowshift A/b).
            </p>
          )}
        </div>

        <div className="space-y-2">
          <label className="block text-sm font-medium">Channel</label>
          <div className="flex gap-2 items-center">
            <select
              className="border rounded p-2 text-sm flex-1"
              value={channel}
              onChange={(e) => setChannel(e.target.value)}
            >
              {Object.keys(twoShelfMode ? preset.shelves["high"].channels : preset.shelves[shelf]?.channels ?? {}).map(
                (c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                )
              )}
            </select>
            <button onClick={addChannel} className="px-2 py-1 text-sm border rounded">
              + Channel
            </button>
          </div>
          <div className="text-xs text-slate-500">Calibration lives with the driving shelf ("high" in two-shelf mode).</div>
        </div>

        <div className="space-y-2">
          <label className="block text-sm font-medium">A / b (linear calibration)</label>
          <div className="text-sm p-2 border rounded bg-slate-50">A = {params.A}, b = {params.b}</div>
        </div>
      </div>

      {/* Intensity controls */}
      {!twoShelfMode && (
        <div className="space-y-2">
          <label className="block text-sm font-medium">Intensity (%)</label>
          <input
            type="range"
            min={0}
            max={100}
            value={percent}
            onChange={(e) => setPercent(parseInt(e.target.value, 10))}
            className="w-full"
          />
          <div className="flex items-center gap-3 text-sm">
            <div>
              PPFD ≈ <b>{ppfd.toFixed(2)}</b>
            </div>
            <div className="text-slate-500">(from {params.A.toFixed(4)}×% + {params.b.toFixed(4)})</div>
          </div>
        </div>
      )}

      {twoShelfMode && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="space-y-2">
            <label className="block text-sm font-medium">High shelf %</label>
            <input
              type="range"
              min={0}
              max={100}
              value={percent}
              onChange={(e) => setPercent(parseInt(e.target.value, 10))}
              className="w-full"
            />
            <div className="text-xs text-slate-600">High PPFD ≈ {(params.A * percent + params.b).toFixed(2)}</div>
          </div>
          <div className="space-y-2">
            <label className="block text-sm font-medium">Low shelf user %</label>
            <input
              type="range"
              min={0}
              max={100}
              value={percentLowUser}
              onChange={(e) => setPercentLowUser(parseInt(e.target.value, 10))}
              className="w-full"
            />
            <div className="text-xs text-slate-600">User-set low %: {percentLowUser.toFixed(0)}%</div>
          </div>
          <div className="space-y-2">
            <label className="block text-sm font-medium">Low shelf effective %</label>
            <input type="range" min={0} max={100} value={lowEffectivePercent} readOnly className="w-full" />
            <div className="text-xs text-slate-600">
              Effective low % = user {percentLowUser.toFixed(0)}% + leak ({(lowShiftParams?.A ?? 0).toFixed(3)}×{percent.toFixed(
                0
              )}% + {(lowShiftParams?.b ?? 0).toFixed(3)}) ⇢ <b>{lowEffectivePercent.toFixed(1)}%</b>
            </div>
            <div className="text-xs text-slate-600">
              Low PPFD ≈ {(params.A * lowEffectivePercent + params.b).toFixed(2)}
            </div>
          </div>
        </div>
      )}

      {/* Inverse solve */}
      <div className="space-y-2">
        <label className="block text-sm font-medium">Inverse: target PPFD</label>
        <div className="flex gap-2 items-center">
          <input
            type="number"
            className="border rounded p-2 text-sm"
            placeholder="e.g., 120"
            onChange={(e) => {
              const v = parseFloat(e.target.value || "0");
              const pct = inverseSolve(v);
              if (twoShelfMode && shelf !== "high") {
                // Adjust low user % to reach target on the LOW shelf (holding HIGH constant)
                // We back out required effective low %, then remove leakage portion.
                const leak = (lowShiftParams?.A ?? 0) * percent + (lowShiftParams?.b ?? 0);
                setPercentLowUser(clamp(pct - leak));
              } else {
                setPercent(pct);
              }
            }}
          />
          <span className="text-sm text-slate-500">→ % set to match</span>
        </div>
      </div>

      {/* Spectrum card */}
      <div className="border rounded-lg p-3">
        <div className="flex items-center justify-between">
          <div>
            <div className="font-medium">Spectrum visualization</div>
            <div className="text-xs text-slate-500">
              Upload a CSV for this channel with columns: wavelength_nm, A, b. Values shown are irradiance (μW/cm²/nm) at the
              current set %.
            </div>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="file"
              ref={fileInputRef}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) onCSVSelected(f);
                if (fileInputRef.current) fileInputRef.current.value = ""; // reset for re-upload
              }}
              accept=".csv,text/csv"
              className="hidden"
            />
            <button onClick={attachCSVPrompt} className="px-3 py-1.5 text-sm border rounded">
              Attach CSV to channel
            </button>
          </div>
        </div>

        {spectrumData.length === 0 ? (
          <div className="text-sm text-slate-500 mt-3">
            No spectrum attached for <b>{channel}</b>. Click <i>Attach CSV to channel</i> and select your calibration file
            (e.g., CoolWhite_helios.csv). The file is saved locally in your browser with the preset.
          </div>
        ) : (
          <div className="mt-3">
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <div>
                Points: <b>{spectrumData.length}</b>
              </div>
              <div>
                Current %: <b>{selectedShelfPercent.toFixed(1)}%</b>
              </div>
              <div>
                PAR 400–700 nm (∫ irradiance dλ): <b>{parIntegrated.toFixed(1)}</b> μW/cm²
              </div>
            </div>
            <div className="h-64 w-full mt-2">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={spectrumData} margin={{ top: 10, right: 20, bottom: 10, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="wavelength" type="number" domain={["dataMin", "dataMax"]} tickFormatter={(v) => `${v} nm`} />
                  <YAxis tickFormatter={(v) => `${v}`} label={{ value: "μW/cm²/nm", angle: -90, position: "insideLeft" }} />
                  <Tooltip formatter={(v: any) => [`${(v as number).toFixed(2)} μW/cm²/nm`, "Irradiance"]} labelFormatter={(l) => `${l} nm`} />
                  <Line type="monotone" dataKey="value" dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}
      </div>

      <div className="text-xs text-slate-500">
        Presets and attached CSVs are stored locally in your browser (no server). To share with colleagues, export your preset JSON
        from DevTools localStorage key <code>ppfd.presets.v2</code>. CSV parsing expects numeric values; rows with missing values are
        skipped. Units: PPFD from the linear model; spectrum in μE/m²/s/nm.
      </div>
    </div>
  );
}
