import type { RoomConfig } from "./rooms";

export type SpectrumPoint = { nm: number; ee: number };
export type LampCalibrationData = Record<string, SpectrumPoint[][]>;

/** Return 0 if value is not a finite number. */
export function safeNumber(x: unknown): number {
  const n = typeof x === "number" ? x : parseFloat(String(x).replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

/** Convert spectral irradiance Ee [W/(m²·nm)] -> µmol/(s·m²·nm). */
export function toUmol(ee: number, wlNm: number): number {
  return safeNumber(ee) * safeNumber(wlNm) * 0.008359;
}

/** Convert an entire spectrum from Ee to µmol/(s·m²·nm). */
export function convertSpectrumToUmol(pts: SpectrumPoint[]): SpectrumPoint[] {
  return pts.map((p) => ({ nm: p.nm, ee: toUmol(p.ee, p.nm) }));
}

/** Integrate spectrum via trapezoidal rule -> total µmol/(s·m²). */
export function integrateSpectrum(pts: SpectrumPoint[], minNm = 0, maxNm = Infinity): number {
  const filtered = pts.filter((p) => p.nm >= minNm && p.nm <= maxNm);
  if (filtered.length < 2) return filtered.length === 1 ? filtered[0].ee : 0;
  let sum = 0;
  for (let i = 1; i < filtered.length; i++) {
    const dLambda = filtered[i].nm - filtered[i - 1].nm;
    sum += 0.5 * (filtered[i].ee + filtered[i - 1].ee) * dLambda;
  }
  return sum;
}

/**
 * Lamp calibration data: channel key -> array of 20 spectra (5 %, 10 %, …, 100 %).
 */
export function parseLampCalibrationCsv(text: string, roomConfig: RoomConfig): LampCalibrationData {
  const lines = text.split(/\r?\n/);
  let headerIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/Wavelength\s*\[nm\]/i.test(lines[i])) {
      headerIdx = i;
      break;
    }
  }
  if (headerIdx < 0) throw new Error("Header row containing 'Wavelength [nm]' not found");

  const headerCols = lines[headerIdx].split(";");
  const wlCol = headerCols.findIndex((c) => /Wavelength\s*\[nm\]/i.test(c.trim()));
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
export function parseJetiSpectrumCsv(text: string): SpectrumPoint[] {
  const lines = text.split(/\r?\n/);
  let headerIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/Wavelength\s*\[nm\]/i.test(lines[i])) {
      headerIdx = i;
      break;
    }
  }
  if (headerIdx < 0) throw new Error("Header row containing 'Wavelength [nm]' not found");

  const headerCols = lines[headerIdx].split(";");
  const wlCol = headerCols.findIndex((c) => /Wavelength\s*\[nm\]/i.test(c.trim()));
  if (wlCol < 0) throw new Error("'Wavelength [nm]' column not found in header");
  const eeCol = headerCols.findIndex((c) => /Ee\s*\[W\/\(sqm\*nm\)\]/i.test(c.trim()));
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
 */
export function spectrumAtPercent(spectra: SpectrumPoint[][], pct: number): SpectrumPoint[] {
  if (pct <= 0) return spectra[0].map((p) => ({ nm: p.nm, ee: 0 }));
  if (pct >= 100) return spectra[19];

  const idx = pct / 5 - 1;

  if (idx < 0) {
    const perOne = (val1: number, val0: number) => (val1 - val0) / 5;
    const stepsBelow = 5 - pct;
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
export function reconstructSpectrum(
  cal: LampCalibrationData,
  percents: Record<string, number>,
): SpectrumPoint[] {
  const channelKeys = Object.keys(cal);
  if (channelKeys.length === 0) return [];

  const channelSpectra = channelKeys.map((key) =>
    spectrumAtPercent(cal[key], percents[key] ?? 0),
  );

  return channelSpectra[0].map((p, i) => ({
    nm: p.nm,
    ee: channelSpectra.reduce((sum, sp) => sum + (sp[i]?.ee ?? 0), 0),
  }));
}
