import React, { useMemo, useState } from "react";

type ChannelParams = { A: number; b: number };
type Preset = {
  name: string;
  profile: string;
  shelves: Record<string, { channels: Record<string, ChannelParams> }>;
};

const DEFAULT_PRESETS: Preset[] = [
  {
    name: "Two shelves General",
    profile: "Fytotron",
    shelves: {
      high: { channels: { coolWhite: { A: 1.0, b: 0.0 } } },
      low:  { channels: { coolWhite: { A: 1.0, b: 0.0 } } }
    },
  },
  {
    name: "Daylight General",
    profile: "Daylight",
    shelves: {
      single: { channels: { coolWhite: { A: 1.0, b: 0.0 }, farRed: { A: 1.0, b: 0.0 } } }
    },
  }
];

export default function LightTools() {
  const [presets, setPresets] = useState<Preset[]>(() => {
    const saved = localStorage.getItem("ppfd.presets");
    return saved ? JSON.parse(saved) : DEFAULT_PRESETS;
  });
  const [presetIndex, setPresetIndex] = useState(0);
  const preset = presets[presetIndex];

  const shelves = Object.keys(preset.shelves);
  const [shelf, setShelf] = useState(shelves[0] || "");
  const channels = Object.keys(preset.shelves[shelf]?.channels ?? {});
  const [channel, setChannel] = useState(channels[0] || "");

  const params: ChannelParams = preset.shelves[shelf]?.channels[channel] ?? { A: 1, b: 0 };

  const [percent, setPercent] = useState(50);
  const ppfd = useMemo(() => params.A * percent + params.b, [params, percent]);

  function inverseSolve(target: number) {
    return Math.max(0, Math.min(100, (target - params.b) / params.A));
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
    localStorage.setItem("ppfd.presets", JSON.stringify(next, null, 2));
  }

  function addChannel() {
    const name = prompt("Channel name? (e.g., coolWhite)");
    if (!name) return;
    const A = parseFloat(prompt("A (slope)?", "1.0") || "1");
    const b = parseFloat(prompt("b (offset)?", "0.0") || "0");
    const next = [...presets];
    next[presetIndex].shelves[shelf].channels[name] = { A, b };
    savePresets(next);
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-2">
          <label className="block text-sm">Preset</label>
          <select className="border rounded p-2 text-sm" value={presetIndex} onChange={e=>onChangePreset(parseInt(e.target.value,10))}>
            {presets.map((p, i) => <option key={i} value={i}>{p.name} ({p.profile})</option>)}
          </select>
        </div>
        <div className="space-y-2">
          <label className="block text-sm">Shelf</label>
          <select className="border rounded p-2 text-sm" value={shelf} onChange={e=>setShelf(e.target.value)}>
            {Object.keys(preset.shelves).map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div className="space-y-2">
          <label className="block text-sm">Channel</label>
          <div className="flex gap-2">
            <select className="border rounded p-2 text-sm flex-1" value={channel} onChange={e=>setChannel(e.target.value)}>
              {Object.keys(preset.shelves[shelf]?.channels ?? {}).map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            <button onClick={addChannel} className="px-2 py-1 text-sm border rounded">+ Channel</button>
          </div>
        </div>
        <div className="space-y-2">
          <label className="block text-sm">A / b</label>
          <div className="text-sm p-2 border rounded bg-slate-50">A = {params.A}, b = {params.b}</div>
        </div>
      </div>

      <div className="space-y-2">
        <label className="block text-sm">Intensity (%)</label>
        <input type="range" min={0} max={100} value={percent} onChange={(e)=>setPercent(parseInt(e.target.value,10))} className="w-full" />
        <div className="text-sm">PPFD ≈ <b>{ppfd.toFixed(2)}</b></div>
      </div>

      <div className="space-y-2">
        <label className="block text-sm">Inverse: target PPFD</label>
        <div className="flex gap-2 items-center">
          <input type="number" className="border rounded p-2 text-sm" placeholder="e.g., 120" onChange={(e)=>setPercent(inverseSolve(parseFloat(e.target.value||"0")))} />
          <span className="text-sm text-slate-500">→ % set to match</span>
        </div>
      </div>

      <div className="text-xs text-slate-500">
        Presets are editable (stored in your browser). For now this uses linear A/b from your tables; leakage is disabled by default.
      </div>
    </div>
  );
}
