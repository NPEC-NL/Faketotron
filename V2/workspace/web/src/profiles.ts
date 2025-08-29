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
export type Phase = PhaseConst | PhaseRamp | PhaseSin | PhaseCloud;

export type Group = {
  name: string;
  type: string;
  unit: string;
  vars: string[];   // machine var names
  phases: Phase[];
};

export type Section  = { parts: Group[] };
export type Protocol = { description: string; repeat: number; logic: string; sections: Section[] };

export type ProfileKey = "fytotron-standard" | "fytotron-extended" | "daylight" | "helios";
export type Profile    = { key: ProfileKey; title: string; groups: Group[] };

function defConst(name: string, dur = "01:00:00"): PhaseConst {
  const r = RANGES[name] || { min: 0, max: 100, int: true };
  const mid = Math.round((r.min + r.max) / 2);
  return { type: "const", value: mid, duration: dur };
}

/** Four chamber profiles. Machine var lists mirror V1 naming; adjust if needed. */
export const PROFILES: Record<ProfileKey, Profile> = {
  "fytotron-standard": {
    key: "fytotron-standard",
    title: "Fytotron (2-shelf, Standard Temp)",
    groups: [
      { name: "CO2",          type: "co2",        unit: "ppm",     vars: ["CO2_Set"],           phases: [defConst("CO2")] },
      { name: "Cool White",   type: "white",      unit: "percent", vars: ["CoolWhite1"],        phases: [defConst("Cool White")] },
      { name: "Cool White 2", type: "white",      unit: "percent", vars: ["CoolWhite2"],        phases: [defConst("Cool White")] },
      { name: "Deep-Red",     type: "deep-red",   unit: "percent", vars: ["DeepRed1"],          phases: [defConst("Deep-Red")] },
      { name: "Deep-Red 2",   type: "deep-red",   unit: "percent", vars: ["DeepRed2"],          phases: [defConst("Deep-Red")] },
      { name: "Far-Red",      type: "far-red",    unit: "percent", vars: ["FarRed1"],           phases: [defConst("Far-Red")] },
      { name: "Far-Red 2",    type: "far-red",    unit: "percent", vars: ["FarRed2"],           phases: [defConst("Far-Red")] },
      { name: "Humidity",     type: "humidity",   unit: "percent", vars: ["Rh_Set"],            phases: [defConst("Humidity")] },
      { name: "Hydroponics",  type: "hydroponie", unit: "",        vars: ["Run1","Run2"],       phases: [defConst("Hydroponics")] },
      { name: "Temperature",  type: "temperature",unit: "celsius", vars: ["T_Set"],             phases: [defConst("Temperature")] },
    ],
  },
  "fytotron-extended": {
    key: "fytotron-extended",
    title: "Fytotron (2-shelf, Extended Temp)",
    groups: [
      { name: "CO2",          type: "co2",        unit: "ppm",     vars: ["CO2_Set"],           phases: [defConst("CO2")] },
      { name: "Cool White",   type: "white",      unit: "percent", vars: ["CoolWhite1"],        phases: [defConst("Cool White")] },
      { name: "Cool White 2", type: "white",      unit: "percent", vars: ["CoolWhite2"],        phases: [defConst("Cool White")] },
      { name: "Deep-Red",     type: "deep-red",   unit: "percent", vars: ["DeepRed1"],          phases: [defConst("Deep-Red")] },
      { name: "Deep-Red 2",   type: "deep-red",   unit: "percent", vars: ["DeepRed2"],          phases: [defConst("Deep-Red")] },
      { name: "Far-Red",      type: "far-red",    unit: "percent", vars: ["FarRed1"],           phases: [defConst("Far-Red")] },
      { name: "Far-Red 2",    type: "far-red",    unit: "percent", vars: ["FarRed2"],           phases: [defConst("Far-Red")] },
      { name: "Humidity",     type: "humidity",   unit: "percent", vars: ["Rh_Set"],            phases: [defConst("Humidity")] },
      { name: "Hydroponics",  type: "hydroponie", unit: "",        vars: ["Run1","Run2"],       phases: [defConst("Hydroponics")] },
      { name: "Temperature",  type: "temperature",unit: "celsius", vars: ["T_Set"],             phases: [defConst("Temperature")] },
    ],
  },
  daylight: {
    key: "daylight",
    title: "Daylight Chamber",
    groups: [
      { name: "Blue",     type: "blue",     unit: "percent", vars: ["Blue1","Blue2","Blue3","Blue4"],       phases: [defConst("Blue")] },
      { name: "Green",    type: "green",    unit: "percent", vars: ["Green1","Green2","Green3","Green4"],   phases: [defConst("Green")] },
      { name: "Red",      type: "red",      unit: "percent", vars: ["Red1","Red2","Red3","Red4"],           phases: [defConst("Red")] },
      { name: "Far-Red",  type: "far-red",  unit: "percent", vars: ["FarRed1","FarRed2","FarRed3","FarRed4"], phases: [defConst("Far-Red")] },
      { name: "Amber",    type: "amber",    unit: "percent", vars: ["Amber1","Amber2","Amber3","Amber4"],   phases: [defConst("Amber")] },
      { name: "Cyan",     type: "cyan",     unit: "percent", vars: ["Cyan1","Cyan2","Cyan3","Cyan4"],       phases: [defConst("Cyan")] },
      { name: "UVA",      type: "uva",      unit: "percent", vars: ["UVA1","UVA2","UVA3","UVA4"],           phases: [defConst("UVA")] },
      { name: "CO2",      type: "co2",      unit: "ppm",     vars: ["CO2_Set"],                               phases: [defConst("CO2")] },
      { name: "Humidity", type: "humidity", unit: "percent", vars: ["Rh_Set"],                                phases: [defConst("Humidity")] },
      { name: "Temperature", type: "temperature", unit: "celsius", vars: ["T_Set"],                           phases: [defConst("Temperature")] },
    ],
  },
  helios: {
    key: "helios",
    title: "Helios",
    groups: [
      { name: "Blue",     type: "blue",     unit: "percent", vars: ["Blue1","Blue2","Blue3","Blue4"],       phases: [defConst("Blue")] },
      { name: "Green",    type: "green",    unit: "percent", vars: ["Green1","Green2","Green3","Green4"],   phases: [defConst("Green")] },
      { name: "Red",      type: "red",      unit: "percent", vars: ["Red1","Red2","Red3","Red4"],           phases: [defConst("Red")] },
      { name: "Far-Red",  type: "far-red",  unit: "percent", vars: ["FarRed1","FarRed2","FarRed3","FarRed4"], phases: [defConst("Far-Red")] },
      { name: "Amber",    type: "amber",    unit: "percent", vars: ["Amber1","Amber2","Amber3","Amber4"],   phases: [defConst("Amber")] },
      { name: "Cyan",     type: "cyan",     unit: "percent", vars: ["Cyan1","Cyan2","Cyan3","Cyan4"],       phases: [defConst("Cyan")] },
      { name: "UVA",      type: "uva",      unit: "percent", vars: ["UVA1","UVA2","UVA3","UVA4"],           phases: [defConst("UVA")] },
      { name: "CO2",      type: "co2",      unit: "ppm",     vars: ["CO2_Set"],                               phases: [defConst("CO2")] },
      { name: "Humidity", type: "humidity", unit: "percent", vars: ["Rh_Set"],                                phases: [defConst("Humidity")] },
      { name: "Temperature", type: "temperature", unit: "celsius", vars: ["T_Set"],                           phases: [defConst("Temperature")] },
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
