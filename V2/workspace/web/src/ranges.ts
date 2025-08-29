export type Range = { min: number; max: number; int?: boolean; scale?: number };

/** V1-like ranges. Temperature is 0..500 with scale=10 (== 0.0..50.0°C). */
export const RANGES: Record<string, Range> = {
  CO2: { min: 0, max: 1000, int: true },
  "Cool White": { min: 0, max: 100, int: true },
  "Deep-Red": { min: 0, max: 100, int: true },
  "Far-Red": { min: 0, max: 100, int: true },
  Humidity: { min: 35, max: 90, int: true },
  Hydroponics: { min: 0, max: 1, int: true },
  Temperature: { min: 0, max: 500, int: true, scale: 10 },

  // Daylight / Helios channels default to 0..100%
  Blue: { min: 0, max: 100, int: true },
  Green: { min: 0, max: 100, int: true },
  Red: { min: 0, max: 100, int: true },
  Amber: { min: 0, max: 100, int: true },
  Cyan: { min: 0, max: 100, int: true },
  UVA: { min: 0, max: 100, int: true },
};
