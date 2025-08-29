// Central place to pick which legacy editor HTML to load.
// Add more entries as you add folders under /public/legacy/<key>/index.html

export const LEGACY_VARIANTS: Record<string, string> = {
  "v1.5": "/legacy/index.html",
};

const KEY = "legacyVersion";

/** Return the URL to the currently selected legacy editor HTML. */
export function getLegacySrc(): string {
  const v = (typeof window !== "undefined" && window.localStorage?.getItem(KEY)) || "v1.4";
  return LEGACY_VARIANTS[v] || LEGACY_VARIANTS["v1.4"];
}

/** Persist the chosen legacy variant (key must exist in LEGACY_VARIANTS). */
export function setLegacyVersion(v: string): void {
  if (LEGACY_VARIANTS[v] && typeof window !== "undefined") {
    window.localStorage.setItem(KEY, v);
  }
}
