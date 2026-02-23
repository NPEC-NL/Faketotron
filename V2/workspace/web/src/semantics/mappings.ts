/**
 * PECO mappings + spectral hints.
 *
 * This file is intentionally small and stable:
 * - It is NOT a constraints/range system.
 * - It only maps Faketotron channel types to PECO term options and adds spectral hints
 *   needed for reproducibility (not covered by PECO).
 */

export type PecoRelation = "exact" | "close" | "broad" | "narrow";

export type PecoOption = {
  id: string; // e.g. "PECO:0007175"
  label: string;
  relation: PecoRelation;
};

export type SpectralHint =
  | {
      kind: "bandpass";
      band_nm: { min: number; typ?: number; max: number };
    }
  | {
      kind: "range";
      range_nm: { min: number; max: number };
    }
  | {
      kind: "broad_cct";
      cct_K: { min: number; max: number };
    };

/** Minimal PECO labels used in UI; not a complete PECO catalog. */
export const PECO: Record<string, { label: string }> = {
  // Temperature
  "PECO:0007175": { label: "temperature exposure" },
  "PECO:0007173": { label: "high temperature exposure" },
  "PECO:0007174": { label: "cold temperature exposure" },

  // Humidity
  "PECO:0007197": { label: "humidity exposure" },

  // CO2
  "PECO:0001020": { label: "carbon dioxide exposure" },
  "PECO:0001056": { label: "elevated carbon dioxide exposure" },

  // Water / hydroponics-ish
  "PECO:0007198": { label: "water environment exposure" },

  // Light intensity / quantity
  "PECO:0007224": { label: "light intensity exposure" },
  "PECO:0007271": { label: "low light intensity exposure" },
  "PECO:0007076": { label: "moderate light intensity exposure" },
  "PECO:0007075": { label: "high light intensity exposure" },
  "PECO:0007221": { label: "visible light exposure" },
  "PECO:0007222": { label: "ultraviolet light exposure" },

  // Light quality
  "PECO:0007002": { label: "UV-A light exposure" },
  "PECO:0007220": { label: "violet light exposure" },
  "PECO:0007218": { label: "blue light exposure" },
  "PECO:0007217": { label: "green light exposure" },
  "PECO:0007207": { label: "red light exposure" },
  "PECO:0007203": { label: "far red light exposure" },
  "PECO:0007216": { label: "yellow light exposure" },
  "PECO:0007215": { label: "orange light exposure" }
};

export function pecoLabel(id: string): string {
  return PECO[id]?.label ?? id;
}

export function isLightGroupType(type: string): boolean {
  return [
    "white",
    "uva",
    "blue",
    "cyan",
    "green",
    "amber",
    "red",
    "far-red",
    "deep-red"
  ].includes(type);
}

/**
 * Spectral hints for reproducibility.
 * These are *not* claims about exact device spectra; they represent internal channel intent/ranges.
 */
export function getSpectralHintForGroupType(type: string): SpectralHint | undefined {
  switch (type) {
    case "uva":
      // internal mapping: 390–420 nm
      return { kind: "range", range_nm: { min: 390, max: 420 } };
    case "blue":
      return { kind: "bandpass", band_nm: { min: 460.0, typ: 470.0, max: 490.0 } };
    case "cyan":
      return { kind: "bandpass", band_nm: { min: 490.0, typ: 505.0, max: 520.0 } };
    case "green":
      return { kind: "bandpass", band_nm: { min: 520.0, typ: 530.0, max: 550.0 } };
    case "amber":
      return { kind: "bandpass", band_nm: { min: 584.5, typ: 590.0, max: 597.0 } };
    case "red":
      return { kind: "bandpass", band_nm: { min: 620.0, typ: 627.0, max: 645.0 } };
    case "white":
      // internal: broad spectrum, 4,500 – 10,000 K (CCT)
      return { kind: "broad_cct", cct_K: { min: 4500, max: 10000 } };
    default:
      return undefined;
  }
}

/** Default PECO option id per group type. */
export function getDefaultPecoIdForGroupType(type: string): string {
  switch (type) {
    case "temperature":
      return "PECO:0007175";
    case "humidity":
      return "PECO:0007197";
    case "co2":
      return "PECO:0001020";
    case "hydroponie":
      return "PECO:0007198";

    case "uva":
      return "PECO:0007002";
    case "blue":
      return "PECO:0007218";
    case "green":
      return "PECO:0007217";
    case "red":
      return "PECO:0007207";
    case "far-red":
      return "PECO:0007203";
    case "deep-red":
      return "PECO:0007207"; // closest
    case "amber":
      return "PECO:0007216"; // closest
    case "cyan":
      return "PECO:0007217"; // closest
    case "white":
      return "PECO:0007221"; // visible light exposure

    default:
      return "";
  }
}

/**
 * PECO selector options for each group type.
 * UI shows these as the scroll-down list.
 */
export function getPecoOptionsForGroupType(type: string): PecoOption[] {
  switch (type) {
    case "temperature":
      return [
        { id: "PECO:0007175", label: pecoLabel("PECO:0007175"), relation: "exact" },
        { id: "PECO:0007173", label: pecoLabel("PECO:0007173"), relation: "exact" },
        { id: "PECO:0007174", label: pecoLabel("PECO:0007174"), relation: "exact" }
      ];

    case "humidity":
      return [{ id: "PECO:0007197", label: pecoLabel("PECO:0007197"), relation: "exact" }];

    case "co2":
      return [
        { id: "PECO:0001020", label: pecoLabel("PECO:0001020"), relation: "exact" },
        { id: "PECO:0001056", label: pecoLabel("PECO:0001056"), relation: "exact" }
      ];

    case "hydroponie":
      return [{ id: "PECO:0007198", label: pecoLabel("PECO:0007198"), relation: "close" }];

    // Light channels (quality)
    case "blue":
      return [{ id: "PECO:0007218", label: pecoLabel("PECO:0007218"), relation: "exact" }];

    case "green":
      return [{ id: "PECO:0007217", label: pecoLabel("PECO:0007217"), relation: "exact" }];

    case "red":
      return [{ id: "PECO:0007207", label: pecoLabel("PECO:0007207"), relation: "exact" }];

    case "far-red":
      return [{ id: "PECO:0007203", label: pecoLabel("PECO:0007203"), relation: "exact" }];

    case "deep-red":
      return [
        { id: "PECO:0007207", label: pecoLabel("PECO:0007207"), relation: "close" },
        { id: "PECO:0007203", label: pecoLabel("PECO:0007203"), relation: "close" }
      ];

    case "amber":
      return [
        { id: "PECO:0007216", label: pecoLabel("PECO:0007216"), relation: "close" },
        { id: "PECO:0007215", label: pecoLabel("PECO:0007215"), relation: "close" }
      ];

    case "cyan":
      return [
        { id: "PECO:0007217", label: pecoLabel("PECO:0007217"), relation: "close" },
        { id: "PECO:0007218", label: pecoLabel("PECO:0007218"), relation: "close" },
        { id: "PECO:0007221", label: pecoLabel("PECO:0007221"), relation: "broad" }
      ];

    case "uva":
      return [
        { id: "PECO:0007002", label: pecoLabel("PECO:0007002"), relation: "exact" },
        { id: "PECO:0007220", label: pecoLabel("PECO:0007220"), relation: "close" },
        { id: "PECO:0007222", label: pecoLabel("PECO:0007222"), relation: "broad" }
      ];

    case "white":
      return [{ id: "PECO:0007221", label: pecoLabel("PECO:0007221"), relation: "close" }];

    default:
      return [{ id: "", label: "(no mapping)", relation: "broad" }];
  }
}

/**
 * For light channels, we often want to also attach a broad intensity term.
 * This keeps PECO linkage useful even when the primary term is a "quality" term.
 */
export function maybeAddLightIntensityTerm(primaryPecoId: string): PecoOption[] {
  if (!primaryPecoId) return [];
  if (primaryPecoId === "PECO:0007224") return [];
  return [{ id: "PECO:0007224", label: pecoLabel("PECO:0007224"), relation: "broad" }];
}
