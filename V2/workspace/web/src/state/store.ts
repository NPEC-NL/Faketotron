import { create } from "zustand";
import type { Protocol, Phase } from "../profiles";


export type MetadataPhaseKey = "night" | "dayAdapt" | "day" | "nightAdapt";

export type MetadataColumn = {
  groupName: string;
  groupIndex: number;
  constant: boolean;
  isFactor: boolean;
  factorLevels: number;
  values: Record<MetadataPhaseKey, string[]>;
};


type State = {
  profile: "fytotron-standard" | "fytotron-extended" | "daylight" | "helios";
  protocol: Protocol;
  /** Bumped on ANY protocol change to force subscribers to recompute */
  protoRev: number;
  /** Metadata grid backing state for MetadataTab (null until initialised) */
  metadataColumns: MetadataColumn[] | null;
};


type Actions = {
  setProfile: (p: State["profile"]) => void;
  setProtocol: (p: Protocol) => void;
  addPhase: (groupIdx: number, phase: Phase) => void;
  updatePhase: (groupIdx: number, phaseIdx: number, patch: Partial<Phase>) => void;
  removePhase: (groupIdx: number, phaseIdx: number) => void;
  setMetadataColumns: (cols: MetadataColumn[] | null) => void;
};


export const useStore = create<State & Actions>((set) => ({
  profile: "fytotron-standard",
  protocol: { description: "", repeat: 2147483647, logic: "", sections: [{ parts: [] }] },
  protoRev: 0,
  metadataColumns: null, 

  setProfile: (p) => set({ profile: p }),

  // Replace protocol (from legacy editor load/edit, file import, etc.)
  // Ensure new identity and bump protoRev so subscribers (GraphTab) refresh.
  setProtocol: (p) =>
  set((s) => {
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

  addPhase: (gi, ph) =>
    set((s) => {
      const parts = [...(s.protocol.sections[0]?.parts || [])];
      const g = { ...parts[gi] };
      g.phases = [...(g.phases || []), ph];
      parts[gi] = g;
      return { protocol: { ...s.protocol, sections: [{ parts }] }, protoRev: s.protoRev + 1 };
    }),

  updatePhase: (gi, pi, patch) =>
    set((s) => {
      const parts = [...(s.protocol.sections[0]?.parts || [])];
      const g = { ...parts[gi] };
      const ph = { ...g.phases[pi], ...patch } as Phase;
      g.phases = g.phases.map((x, i) => (i === pi ? ph : x));
      parts[gi] = g;
      return { protocol: { ...s.protocol, sections: [{ parts }] }, protoRev: s.protoRev + 1 };
    }),

  removePhase: (gi, pi) =>
    set((s) => {
      const parts = [...(s.protocol.sections[0]?.parts || [])];
      const g = { ...parts[gi] };
      g.phases = g.phases.filter((_, i) => i !== pi);
      parts[gi] = g;
      return { protocol: { ...s.protocol, sections: [{ parts }] }, protoRev: s.protoRev + 1 };
    }),

  setMetadataColumns: (cols) => set({ metadataColumns: cols }),

}));

export const useProto: typeof useStore = useStore;
