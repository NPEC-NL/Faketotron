import { RANGES } from "./ranges";

export type PhaseConst = { type: "const"; value: number; duration: string };
export type PhaseRamp  = { type: "ramp"; start: number; end: number; duration: string; step?: string };
export type PhaseSin   = { type: "sin";  min: number; max: number; period: string; phaseOffset: string; duration: string; step?: string };
export type PhaseCloud = {
  type: "cloud" | "clouds"; duration: string; step?: string;
  amplitude: number; offset: number;
  cloud_density: number; cloud_position: number;
  cloud_duration_mean: number; cloud_duration_var: number;
  fluctuation_mean_ratio: number; fluctuation_var: number;
  cloud_drop_coeff: number;
};
export type PhaseCsvImport = { type: "csv-import"; points: Array<[string, number]> };
export type Phase = PhaseConst | PhaseRamp | PhaseSin | PhaseCloud | PhaseCsvImport;

export type Group = {
  name: string;
  type: string;
  unit: string;
  vars: string[];   // machine var names
  phases: Phase[];
};

export type Section  = { parts: Group[] };
export type Protocol = { description: string; repeat: number; logic: string; sections: Section[] };

export type ProfileKey = "G4" | "G5" | "G6" | "G7" | "G8";
export type Profile    = { key: ProfileKey; title: string; groups: Group[] };

function defConst(name: string, dur = "01:00:00"): PhaseConst {
  const r = RANGES[name] || { min: 0, max: 100, int: true };
  const mid = Math.round((r.min + r.max) / 2);
  return { type: "const", value: mid, duration: dur };
}

/** Four chamber profiles. Machine var lists mirror V1 naming; adjust if needed. */
export const PROFILES: Record<ProfileKey, Profile> = {
  G4: {
    key: "G4",
    title: "G4 (Standard)",
    groups: [
      { name: "CO2",          type: "co2",         unit: "ppm",     vars: ["CO2_Set"],   phases: [defConst("CO2")] },
      { name: "Cool White",   type: "cool-white",  unit: "percent", vars: ["CoolWhite"], phases: [defConst("Cool White")] },
      { name: "DeepRed",      type: "deep-red",    unit: "percent", vars: ["DeepRed"],   phases: [defConst("DeepRed")] },
      { name: "FarRed",       type: "far-red",     unit: "percent", vars: ["FarRed"],    phases: [defConst("FarRed")] },
      { name: "Humidity",     type: "humidity",    unit: "percent", vars: ["Rh_Set"],    phases: [defConst("Humidity")] },
      { name: "Temperature",  type: "temperature", unit: "celsius", vars: ["T_Set"],     phases: [defConst("Temperature")] },
      { name: "UVB",          type: "uvb",         unit: "percent", vars: ["UVB"],       phases: [defConst("UVB")] },
    ],
  },
  G5: {
    key: "G5",
    title: "G5",
    groups: [
      { name: "CO2",          type: "co2",         unit: "ppm",     vars: ["CO2_Set"],   phases: [defConst("CO2")] },
      { name: "Cool White",   type: "cool-white",  unit: "percent", vars: ["CoolWhite"], phases: [defConst("Cool White")] },
      { name: "DeepRed",      type: "deep-red",    unit: "percent", vars: ["DeepRed"],   phases: [defConst("DeepRed")] },
      { name: "FarRed",       type: "far-red",     unit: "percent", vars: ["FarRed"],    phases: [defConst("FarRed")] },
      { name: "Humidity",     type: "humidity",    unit: "percent", vars: ["Rh_Set"],    phases: [defConst("Humidity")] },
      { name: "Temperature",  type: "temperature", unit: "celsius", vars: ["T_Set"],     phases: [defConst("Temperature")] },
      { name: "UVB",          type: "uvb",         unit: "percent", vars: ["UVB"],       phases: [defConst("UVB")] },
    ],
  },
  G6: {
    key: "G6",
    title: "G6",
    groups: [
      { name: "CO2",          type: "co2",         unit: "ppm",     vars: ["CO2_Set"],   phases: [defConst("CO2")] },
      { name: "Cool White",   type: "white",       unit: "percent", vars: ["CoolWhite1","CoolWhite2","CoolWhite3","CoolWhite4","CoolWhite5","CoolWhite6"], phases: [defConst("Cool White")] },
      { name: "FarRed",       type: "far-red",     unit: "percent", vars: ["FarRed1","FarRed2","FarRed3","FarRed4","FarRed5","FarRed6"], phases: [defConst("FarRed")] },
      { name: "Humidity",     type: "humidity",    unit: "percent", vars: ["Rh_Set"],    phases: [defConst("Humidity")] },
      { name: "Red",          type: "red",         unit: "percent", vars: ["Red1","Red2","Red3","Red4","Red5","Red6"], phases: [defConst("Red")] },
      { name: "Temperature",  type: "temperature", unit: "celsius", vars: ["T_Set"],     phases: [defConst("Temperature")] },
      { name: "UVB",          type: "uvb",         unit: "percent", vars: ["UVB"],       phases: [defConst("UVB")] },
    ],
  },
  G7: {
    key: "G7",
    title: "G7",
    groups: [
      { name: "Amber",        type: "amber",       unit: "percent", vars: ["Amber"],     phases: [defConst("Amber")] },
      { name: "Blue",         type: "blue",        unit: "percent", vars: ["Blue"],      phases: [defConst("Blue")] },
      { name: "CO2",          type: "co2",         unit: "ppm",     vars: ["CO2_Set"],   phases: [defConst("CO2")] },
      { name: "Cool White",   type: "cool-white",  unit: "percent", vars: ["CoolWhite"], phases: [defConst("Cool White")] },
      { name: "Cyan",         type: "cyan",        unit: "percent", vars: ["Cyan"],      phases: [defConst("Cyan")] },
      { name: "DeepRed",      type: "deep-red",    unit: "percent", vars: ["DeepRed"],   phases: [defConst("DeepRed")] },
      { name: "FarRed",       type: "far-red",     unit: "percent", vars: ["FarRed"],    phases: [defConst("FarRed")] },
      { name: "Green",        type: "green",       unit: "percent", vars: ["Green"],     phases: [defConst("Green")] },
      { name: "Humidity",     type: "humidity",    unit: "percent", vars: ["Rh_Set"],    phases: [defConst("Humidity")] },
      { name: "Red",          type: "red",         unit: "percent", vars: ["Red"],       phases: [defConst("Red")] },
      { name: "Temperature",  type: "temperature", unit: "celsius", vars: ["T_Set"],     phases: [defConst("Temperature")] },
      { name: "UVA",          type: "uva",         unit: "percent", vars: ["UVA"],       phases: [defConst("UVA")] },
    ],
  },
  G8: {
    key: "G8",
    title: "G8",
    groups: [
      { name: "CO2",          type: "co2",         unit: "ppm",     vars: ["CO2_Set"],   phases: [defConst("CO2")] },
      { name: "Cool White",   type: "cool-white",  unit: "percent", vars: ["CoolWhite"], phases: [defConst("Cool White")] },
      { name: "DeepRed",      type: "deep-red",    unit: "percent", vars: ["DeepRed"],   phases: [defConst("DeepRed")] },
      { name: "FarRed",       type: "far-red",     unit: "percent", vars: ["FarRed"],    phases: [defConst("FarRed")] },
      { name: "Humidity",     type: "humidity",    unit: "percent", vars: ["Rh_Set"],    phases: [defConst("Humidity")] },
      { name: "Temperature",  type: "temperature", unit: "celsius", vars: ["T_Set"],     phases: [defConst("Temperature")] },
      { name: "UVB",          type: "uvb",         unit: "percent", vars: ["UVB"],       phases: [defConst("UVB")] },
    ],
  },
};

export function newProtocol(profile: ProfileKey): Protocol {
  return {
    description: "",
    repeat: 2147483647,
    logic: "",
    sections: [{ parts: PROFILES[profile].groups.map(g => ({ ...g, phases: [...g.phases] })) }],
  };
}
