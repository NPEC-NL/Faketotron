export type Duration = string; // "D.HH:mm:ss" or "HH:mm:ss"

export type PhaseConst = {
  type: "const";
  value: number;
  duration: Duration;
};

export type PhaseRamp = {
  type: "ramp";
  duration: Duration;
  step: Duration; // 00:00:05 typical in V1
  start: number;
  end: number;
};

export type PhaseSin = {
  type: "sin";
  duration: Duration;
  step: Duration;
  offset: number;
  amplitude: number;
  period: Duration;
  phase: number; // degrees
};

export type PhaseCloud = {
  // Note: some legacy files may use "clouds"
  type: "cloud";
  duration: Duration;
  step: Duration;
  offset: number;
  amplitude: number;
  density: number;
  position: number;
  variance: number;
};

export type Phase = PhaseConst | PhaseRamp | PhaseSin | PhaseCloud;

export type Group = {
  "group-name": string;
  type: string;
  "union-tag": string;
  unit: string;
  vars: string[];
  phases: Phase[];
};

export type Section = {
  parts: Group[];
};

export type Protocol = {
  description: string;
  repeat: number;
  logic: string; // HH:mm:ss
  sections: Section[];
};
