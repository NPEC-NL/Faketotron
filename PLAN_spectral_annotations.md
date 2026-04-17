# Faketron — Implementation Plan: Spectral Dashboard & Event Annotations

## Context
Two new features for the Faketron browser-based climate protocol designer (Wageningen plant chambers G4–G8). The app uses React 18 + TypeScript + Zustand + Recharts + Tailwind. All code lives in `V2/workspace/web/src/`.

**Why these features:**
- **Spectral Dashboard**: Researchers currently have no way to see derived spectral quality metrics (R:FR ratio, DLI, blue fraction) without external tools. These are mandatory reporting numbers in plant science publications.
- **Event Annotations**: There is no way to mark experimental events (inoculation, sampling, harvest) on the protocol timeline. Annotations are critical for reproducibility and for making protocol graphs usable in lab notebooks.

---

## Feature 1: Spectral Dashboard

### What it shows
A "Spectral Metrics" panel inside `LightTools.tsx` that displays, in real time as channel sliders move:

| Metric | Formula | Biological Meaning |
|---|---|---|
| **Total PPFD** | ∫ spectrum(400–700nm) | Photosynthetically active radiation |
| **R:FR ratio** | ∫(600–700nm) / ∫(700–800nm) | Phytochrome state → shade avoidance, flowering |
| **Blue fraction** | ∫(400–500nm) / ∫(400–700nm) | Stomatal opening, anthocyanin production |
| **Blue:Red ratio** | ∫(400–500nm) / ∫(600–700nm) | Shade avoidance secondary signal |
| **DLI** | PPFD × photoperiod_s / 1 000 000 | Daily Light Integral (mol photons/m²/day) |
| **UV-A fraction** | ∫(315–400nm) / total | UV stress indicator |
| **Far-Red fraction** | ∫(700–800nm) / total(400–800nm) | Elongation / shade signal magnitude |

All integrals are computed from the **reconstructed spectrum** (already computed in LightTools via `reconstructSpectrum()` + `convertSpectrumToUmol()`) using the **trapezoidal `integrateSpectrum()`** already in `utils/spectra.ts`. No new math primitives needed.

For DLI the user must supply the photoperiod hours (simple number input next to the dashboard — defaults to 16h).

### Where to place it
**Below the existing "Reconstructed Spectrum" bar chart** in `LightTools.tsx`, inside a new collapsible `<details>` section titled "Spectral Quality Metrics". Only renders when `lampCal` is loaded (spectrum data available) or when using a preset that includes calibration coefficients; otherwise shows a soft placeholder message.

### New utility: `utils/spectra.ts` — add `computeSpectralMetrics()`

```typescript
export type SpectralMetrics = {
  ppfd: number;             // µmol/(s·m²), PAR 400–700nm
  rFrRatio: number | null;  // null if FR integral ≈ 0
  blueFraction: number;     // 0–1
  blueRedRatio: number | null;
  farRedFraction: number;   // 0–1 of 400–800nm total
  uvAFraction: number;      // 0–1 of 400–800nm total
  dli: number;              // mol/(m²·day), given photoperiodHours
};

export function computeSpectralMetrics(
  spectrum: SpectrumPoint[],   // already in µmol/(s·m²·nm) units
  photoperiodHours: number
): SpectralMetrics;
```

Implementation: call `integrateSpectrum()` six times with different wavelength bounds. All six calls are cheap (O(n) trapezoidal). Return structured object.

### Changes to `LightTools.tsx`

1. **Add state**: `const [photoperiod, setPhotoperiod] = useState(16);`

2. **Compute metrics** inside the component body (memoized with `useMemo`):
   ```typescript
   const spectralMetrics = useMemo(() => {
     if (!lampCal) return null;
     const spectrum = convertSpectrumToUmol(reconstructSpectrum(lampCal, specSliders));
     return computeSpectralMetrics(spectrum, photoperiod);
   }, [lampCal, specSliders, photoperiod]);
   ```
   (Note: `specSliders` already exists as state in the component.)

3. **Add `SpectralMetricsPanel` component** (can be a local component inside the same file or a separate small file at `ui/SpectralMetricsPanel.tsx`):
   - Input: `metrics: SpectralMetrics | null`, `photoperiod: number`, `onPhotoperiodChange: (h: number) => void`
   - Renders a responsive grid of metric cards (each: label, value, unit, brief tooltip)
   - Uses Tailwind `grid grid-cols-2 md:grid-cols-4` layout
   - Each card has a subtle color-coded border: red for red-range metrics, blue for blue-range, green for DLI

4. **Metric card design**:
   ```
   ┌──────────────────┐
   │  R:FR Ratio      │
   │                  │
   │     1.23         │  ← large number
   │                  │
   │  [?] tooltip     │  ← hover explains meaning
   └──────────────────┘
   ```
   Color coding:
   - R:FR < 0.5 → amber warning (very shaded)
   - R:FR 0.5–2.0 → green (normal range)
   - R:FR > 2.0 → blue info (far-red poor spectrum)
   - DLI: thresholds by crop type (optional, just color the card)

5. **DLI photoperiod input**: Small inline input ("Photoperiod for DLI: [16] h/day") directly in the panel header.

6. **Fallback when no lampCal**: Show a muted info box: "Upload a calibration CSV to see spectral quality metrics." Do NOT hide the section — keep it visible as a prompt.

### Handling presets without full lampCal
Currently presets store linear coefficients `A, b` (not full spectra). Without `lampCal`, we cannot reconstruct a full spectrum. Two options:
- **Option A (chosen)**: Only show metrics when lampCal is loaded. Otherwise show the informative placeholder.
- **Option B (future)**: Add representative spectra per channel to presets (large but possible). Deferred.

This keeps the implementation clean and avoids approximation errors.

---

## Feature 2: Event Annotations

### Data model

New type (add to `V2/workspace/faketotron-v2-core/src/types.ts`):
```typescript
export type Annotation = {
  id: string;        // nanoid() — browser-safe random ID (no external dep; use crypto.randomUUID())
  label: string;     // e.g. "Inoculation", "Harvest"
  dayOffset: number; // 1-based day number (Day 1 = first day of experiment)
  color: string;     // CSS hex string, e.g. "#ef4444"
};
```

### State changes: `state/store.ts`

Add to `State`:
```typescript
annotations: Annotation[];
```

Add to actions:
```typescript
addAnnotation(a: Omit<Annotation, "id">): void;
  // Generates id via crypto.randomUUID(), appends to list, no protoRev bump needed

updateAnnotation(id: string, patch: Partial<Omit<Annotation, "id">>): void;
  // Shallow merge, immutable update

removeAnnotation(id: string): void;
  // Filter by id

clearAnnotations(): void;
  // Empty the list (called on "New Protocol")
```

**Important**: Annotations are stored separately from `protocol` and do NOT bump `protoRev`. They are independent state. This avoids unnecessary graph re-sampling when an annotation is added.

**Persistence**: Persist annotations in `localStorage` alongside the zustand state (use zustand's `persist` middleware if already in use, or a simple `useEffect` sync). Key: `faketron-annotations`.

**Reset on new protocol**: Call `clearAnnotations()` when a new protocol is loaded via `setProtocol()`.

### JSON export integration

When exporting `.json` (human-readable format), add annotations as a top-level key:
```json
{
  "protocol": { ... },
  "annotations": [
    { "id": "abc", "label": "Inoculation", "dayOffset": 14, "color": "#ef4444" }
  ]
}
```

The `.fyt` binary export is unaffected (PSI-format, no annotations). When importing a `.json` that has an `annotations` field, load annotations into the store alongside the protocol.

### UI: Annotation Manager Panel

Location: A collapsible sidebar panel inside `GraphTab.tsx`, placed above the existing "visible series" checkboxes, titled **"Events"**.

Design:
```
[ + Add Event ] 
─────────────────────────────────
● Inoculation    Day 14   ████  [×]
● Harvest        Day 21   ████  [×]
─────────────────────────────────
```

Each row shows:
- Color swatch (click to open native `<input type="color">`)
- Label (click to edit inline — `contentEditable` span or small `<input>`)
- "Day N" text (editable number field)
- Delete [×] button

"Add Event" button appends a new annotation with defaults: label "Event", day = `totalDays / 2` (middle of protocol), color randomly chosen from a palette of 8 preset colors (so it doesn't clash with existing ones).

The panel is visible in all graph modes (24-hour, Day Scroller, Experimental Duration, Flexible).

### Rendering in each graph mode

#### A. Flexible Graph (custom SVG — primary location)

The flexible graph in GraphTab already renders all phase boundaries as circles on a custom SVG canvas. Annotations overlay as vertical dashed lines.

For each annotation:
```typescript
const xSec = (annotation.dayOffset - 1) * DAY_SECONDS; // convert day → seconds
const xPx = mapX(xSec);                                 // existing mapX() helper
if (xPx >= 0 && xPx <= svgWidth) {
  // Line spanning full SVG height
  <line
    x1={xPx} y1={0}
    x2={xPx} y2={svgHeight}
    stroke={annotation.color}
    strokeWidth={1.5}
    strokeDasharray="6 3"
    opacity={0.85}
  />
  // Label — rotated text at top, or a flag badge
  <text
    x={xPx + 4} y={14}
    fill={annotation.color}
    fontSize={10}
    fontWeight="600"
    style={{ userSelect: "none" }}
  >
    {annotation.label}
  </text>
  // Small circle at bottom as anchor
  <circle cx={xPx} cy={svgHeight} r={4} fill={annotation.color} />
}
```

Annotations are rendered **after** the data lines (so they appear on top) but **before** the phase interaction circles (so those remain clickable).

#### B. 24-Hour Graph (Recharts LineChart)

Since the annotation marks a whole day (not an hour), show a full-width colored banner above the chart when the current `dayIndex` matches:
```tsx
{annotations.filter(a => a.dayOffset - 1 === dayIndex).map(a => (
  <div key={a.id} className="flex items-center gap-2 px-3 py-1 text-xs rounded"
       style={{ background: a.color + "22", borderLeft: `3px solid ${a.color}`, color: a.color }}>
    <span>●</span> <strong>{a.label}</strong> — Day {a.dayOffset}
  </div>
))}
```
This banner appears above the Recharts chart wrapper.

#### C. Day Scroller

The Day Scroller lets users step through days. Show annotation days as specially marked in the day navigation:
- Add a colored dot badge next to the day number when navigating to an annotated day.
- Show the same banner div as in (B) above the scroller chart.

#### D. Experimental Duration Graph (custom SVG / isometric)

This graph shows multiple days stacked. For annotated days, add a colored horizontal band or a marker dot at the corresponding day slice. Implementation: in the `Consistency3DChart` render, for each day slice that matches an annotation, add a small colored dot or bar marker.

---

## Step-by-Step Implementation Order

### Phase A: Spectral Dashboard (self-contained, no store changes)
1. Add `computeSpectralMetrics()` to `V2/workspace/web/src/utils/spectra.ts`
2. Add `SpectralMetrics` type export to the same file
3. In `LightTools.tsx`:
   - Add `photoperiod` state (default 16)
   - Add `spectralMetrics` useMemo that calls `computeSpectralMetrics`
   - Add `SpectralMetricsPanel` inline component (≈60 lines)
   - Insert panel below the spectrum bar chart with a `<details>` wrapper

### Phase B: Annotation Data Model
4. Add `Annotation` type to `V2/workspace/faketotron-v2-core/src/types.ts`
5. Add `annotations: Annotation[]` to store state (default `[]`)
6. Add `addAnnotation`, `updateAnnotation`, `removeAnnotation`, `clearAnnotations` actions to `V2/workspace/web/src/state/store.ts`
7. Call `clearAnnotations()` inside `setProtocol()` action (reset on new protocol load)
8. Add localStorage persistence for annotations (simple `useEffect` in `App.tsx` or inside store)

### Phase C: Annotation UI Panel
9. In `GraphTab.tsx`: Add `AnnotationPanel` section in the sidebar (above series toggles)
10. Implement color swatch, inline label editor, day number input, add/remove buttons
11. Wire to store actions

### Phase D: Graph Rendering
12. **Flexible graph SVG**: Inject annotation vertical lines + labels using `mapX()`
13. **24-hour graph**: Add day-matched event banner above the Recharts chart
14. **Day Scroller**: Add annotation badge to day indicator
15. **(Optional) Experimental Duration graph**: Add annotation day markers to isometric view

### Phase E: JSON I/O
16. In the export handler (find where `.json` is written — likely in `App.tsx` or toolbar): add `annotations` to the exported object
17. In the import handler (where `.json` is parsed): detect `annotations` field and call `store.setAnnotations()` (new bulk-set action, or load via `addAnnotation` loop)

---

## Critical Files

| File | Change |
|---|---|
| `V2/workspace/faketotron-v2-core/src/types.ts` | Add `Annotation` type |
| `V2/workspace/web/src/utils/spectra.ts` | Add `computeSpectralMetrics()`, `SpectralMetrics` type |
| `V2/workspace/web/src/state/store.ts` | Add `annotations` state + 4 actions |
| `V2/workspace/web/src/ui/LightTools.tsx` | Add `SpectralMetricsPanel` section + `photoperiod` state |
| `V2/workspace/web/src/ui/GraphTab.tsx` | Add annotation panel + rendering in all 4 graph modes |
| `V2/workspace/web/src/ui/App.tsx` (or wherever export lives) | JSON import/export with annotations |

**Existing functions to reuse (do not rewrite):**
- `integrateSpectrum(pts, minNm, maxNm)` — `utils/spectra.ts` — already trapezoidal, wavelength-gated
- `convertSpectrumToUmol(pts)` — `utils/spectra.ts` — W/m²/nm → µmol/s/m²/nm
- `reconstructSpectrum(cal, percents)` — `utils/spectra.ts` — sums all channel spectra
- `spectrumAtPercent(spectra, pct)` — `utils/spectra.ts` — interpolate at arbitrary %
- `mapX(x)` — `GraphTab.tsx` — seconds → SVG pixel
- `colorFor(name)` — `GraphTab.tsx` — series color lookup

---

## Verification

**Spectral Dashboard:**
1. Open LightTools tab
2. Upload the G4 calibration CSV from `public/calibration/`
3. Set all sliders to 100%
4. Verify total PPFD matches the existing "total PPFD" display (regression check)
5. Check R:FR: for a warm-white-dominant spectrum, expect R:FR ≈ 1.2–2.0. For deep-red-only, expect R:FR >> 5.
6. Set photoperiod to 16h, verify DLI = PPFD × 16 × 3600 / 1 000 000
7. Verify blue fraction is ~0 when only deepRed + farRed are at 100%, ~0.2–0.4 when coolWhite dominates

**Annotations:**
1. Load any `.fyt` file
2. Go to Graph tab → Add an annotation "Inoculation" at Day 5, color red
3. Verify it appears as a dashed red vertical line in the Flexible graph at the correct position
4. Navigate to Day 5 in the 24-hour graph → verify the event banner appears
5. Navigate to Day 4 → verify banner does NOT appear
6. Export as JSON → open file, verify `annotations` array is present
7. Re-import JSON → verify annotation reloads correctly
8. Load a new `.fyt` → verify annotations are cleared
9. Add two annotations at the same day → verify both render without overlap
10. Build single-file output (`pnpm -C web build`) → load `dist/index.html` offline → verify everything works (no CDN dependencies)
