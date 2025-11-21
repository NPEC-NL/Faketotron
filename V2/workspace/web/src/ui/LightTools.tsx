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

// ===== Helpers =====
function clamp(x: number, lo = 0, hi = 100) {
  return Math.max(lo, Math.min(hi, x));
}

// (unused legacy helpers removed)

// ===== Main component =====
export default function LightTools() {
  const [presets, setPresets] = useState<Preset[]>(() => {
    const saved = localStorage.getItem("ppfd.presets.v4");
    if (saved) return JSON.parse(saved);
    // Use new default presets with separate PAR/Full spectrum entries
    return DEFAULT_PRESETS;
  });
  useEffect(() => {
    localStorage.setItem("ppfd.presets.v4", JSON.stringify(presets));
  }, [presets]);

  const [presetIndex, setPresetIndex] = useState(0);
  const preset = presets[presetIndex];

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
      const data: PercentRow[] = steps.map((p) => ({ percent: p, value: A * p + b }));
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
        sum += A * p + b;
      }
      return { percent: p, value: sum };
    });
  }, [preset]);

  // Current selection points (one per channel) to show on the graph
  const currentPoints = useMemo(() => {
    return allChannels.map((ch) => {
      const { A, b } = paramsFor(ch);
      const pct = perChannelPercent[ch] ?? 50;
      return { name: ch, data: [{ percent: pct, value: A * pct + b }] };
    });
  }, [preset, JSON.stringify(perChannelPercent)]);

  // total PPFD at current slider positions
  const totalPPFD = useMemo(() => {
    return allChannels.reduce((sum, ch) => {
      const { A, b } = paramsFor(ch);
      const pct = perChannelPercent[ch] ?? 50;
      return sum + (A * pct + b);
    }, 0);
  }, [preset, JSON.stringify(perChannelPercent)]);

  // Spectrum-like contributions (simple): per-channel PPFD bars
  const spectrumBars = useMemo(() => {
    return allChannels.map((ch) => {
      const { A, b } = paramsFor(ch);
      const pct = perChannelPercent[ch] ?? 50;
      return { name: ch, ppfd: A * pct + b, color: colorFor(ch) };
    });
  }, [preset, JSON.stringify(perChannelPercent)]);

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
                const ppfd = A * pct + b;
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

      {/* Simplified plot: X = PPFD (µmol/m²/s), Y = device % */}
      <div className="border rounded-lg p-3 mt-4">
        <div className="font-medium">{measurementType} map (X = µmol/m²/s, Y = %)</div>
        {allChannels.length === 0 ? (
          <div className="text-sm text-slate-500 mt-3">No channels to plot.</div>
        ) : (
          <div className="h-72 w-full mt-3">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart margin={{ top: 10, right: 20, bottom: 10, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <Legend
                  verticalAlign="top"
                  align="right"
                  wrapperStyle={{ fontSize: 12 }}
                  formatter={(val: string) => {
                    // Map internal channel keys to display names
                    const map: Record<string, string> = {
                      coolWhite: 'Cool White',
                      deepRed: 'Deep Red',
                      farRed: 'Far Red',
                      Total: 'Total (sum)',
                    };
                    return map[val] || val;
                  }}
                />
                <XAxis dataKey="value" type="number" tickFormatter={(v) => `${v}`} label={{ value: "µmol/m²/s", position: "insideBottomRight", offset: -5 }} />
                <YAxis dataKey="percent" domain={[0, 100]} tickFormatter={(v) => `${v}%`} />
                <Tooltip formatter={(v: any, n: any) => [`${(v as number).toFixed(2)} ${n === 'value' ? 'µmol/m²/s' : '%'}`, n === 'value' ? measurementType : 'Percent']} labelFormatter={(l) => `${measurementType}: ${l}`} />
                {/* Per-channel dashed curves */}
                {percentSeries.map((s) => (
                  <Line
                    key={s.name}
                    data={s.data}
                    dataKey="percent"
                    name={s.name}
                    dot={false}
                    type="monotone"
                    strokeDasharray="4 2"
                    stroke={colorFor(s.name)}
                  />
                ))}
                {/* Total curve (solid) */}
                <Line data={totalPercentData} dataKey="percent" name="Total" dot={false} type="monotone" strokeWidth={2} stroke="#222" />
                {/* Current selection markers (one dot per channel) */}
                {currentPoints.map((s) => (
                  <Line
                    key={`dot-${s.name}`}
                    data={s.data}
                    dataKey="percent"
                    // Hide marker lines from legend to avoid duplicates
                    legendType="none"
                    name={`${s.name} (current)`}
                    stroke={colorFor(s.name)}
                    strokeOpacity={0}
                    isAnimationActive={false}
                    dot={{ r: 4, stroke: colorFor(s.name), fill: "#fff", strokeWidth: 2 }}
                    activeDot={{ r: 5 }}
                    type="monotone"
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      {/* Spectrum visualization (approximate): channel contributions */}
      <div className="border rounded-lg p-3">
        <div className="font-medium">Spectrum (approximate, summed contributions)</div>
        {spectrumBars.length === 0 ? (
          <div className="text-sm text-slate-500 mt-3">No data.</div>
        ) : (
          <div className="h-52 w-full mt-3">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={spectrumBars} margin={{ top: 10, right: 20, bottom: 10, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" />
                <YAxis label={{ value: "µmol/m²/s", angle: -90, position: "insideLeft" }} />
                <Tooltip formatter={(v: any) => [`${(v as number).toFixed(2)} µmol/m²/s`, measurementType]} />
                <Bar dataKey="ppfd">
                  {spectrumBars.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
        <div className="text-xs text-slate-500 mt-2">Note: This is not a true SPD; it shows relative PPFD per channel at current settings.</div>
      </div>
    </div>
  );
}
