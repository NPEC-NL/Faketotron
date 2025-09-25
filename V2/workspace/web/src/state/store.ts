import { create } from "zustand";
import type { Protocol, Phase } from "../profiles";

type State = {
  profile: "G4" | "G5" | "G6" | "G7" | "G8";
  protocol: Protocol;
  /** Bumped on ANY protocol change to force subscribers to recompute */
  protoRev: number;
};

type Actions = {
  setProfile: (p: State["profile"]) => void;
  setProtocol: (p: Protocol) => void;
  addPhase: (groupIdx: number, phase: Phase) => void;
  updatePhase: (groupIdx: number, phaseIdx: number, patch: Partial<Phase>) => void;
  removePhase: (groupIdx: number, phaseIdx: number) => void;
};

export const useStore = create<State & Actions>((set: any) => ({
  profile: "G4",
  protocol: { description: "", repeat: 2147483647, logic: "", sections: [{ parts: [] }] },
  protoRev: 0,

  setProfile: (p: State["profile"]) => set({ profile: p }),

  // Replace protocol (from legacy editor load/edit, file import, etc.)
  // Ensure new identity and bump protoRev so subscribers (GraphTab) refresh.
  setProtocol: (p: Protocol) =>
  set((s: any) => {
    const protocol = typeof structuredClone === "function"
      ? structuredClone(p)
      : JSON.parse(JSON.stringify(p));

    const protoRev = (s.protoRev ?? 0) + 1;

    // Make the "loaded" signal deterministic and central
    queueMicrotask(() => {
      window.dispatchEvent(new CustomEvent("protocol:loaded", { detail: { protoRev } }));
    });

    return { protocol, protoRev };
  }),

  addPhase: (gi: number, ph: Phase) =>
    set((s: any) => {
      const parts = [...(s.protocol.sections[0]?.parts || [])];
      const g = { ...parts[gi] };
      g.phases = [...(g.phases || []), ph];
      parts[gi] = g;
      return { protocol: { ...s.protocol, sections: [{ parts }] }, protoRev: s.protoRev + 1 };
    }),

  updatePhase: (gi: number, pi: number, patch: Partial<Phase>) =>
    set((s: any) => {
      const parts = [...(s.protocol.sections[0]?.parts || [])];
      const g = { ...parts[gi] };
      const ph = { ...g.phases[pi], ...patch } as Phase;
  g.phases = g.phases.map((x: Phase, i: number) => (i === pi ? ph : x));
      parts[gi] = g;
      return { protocol: { ...s.protocol, sections: [{ parts }] }, protoRev: s.protoRev + 1 };
    }),

  removePhase: (gi: number, pi: number) =>
    set((s: any) => {
      const parts = [...(s.protocol.sections[0]?.parts || [])];
      const g = { ...parts[gi] };
  g.phases = g.phases.filter((_: Phase, i: number) => i !== pi);
      parts[gi] = g;
      return { protocol: { ...s.protocol, sections: [{ parts }] }, protoRev: s.protoRev + 1 };
    }),
}));

export const useProto: typeof useStore = useStore;
