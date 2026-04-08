export type RoomChannelConfig = {
  key: string;
  label: string;
  color: string;
  protocolGroupName: string;
};

export type RoomConfig = {
  id: string;
  channels: RoomChannelConfig[];
};

export const ROOM_CONFIGS: Record<string, RoomConfig> = {
  G4: {
    id: "G4",
    channels: [
      { key: "coolWhite", label: "Cool White", color: "#7aa6ff", protocolGroupName: "Cool White" },
      { key: "deepRed", label: "Deep Red", color: "#e03131", protocolGroupName: "DeepRed" },
      { key: "farRed", label: "Far Red", color: "#b1006b", protocolGroupName: "FarRed" },
    ],
  },
  G5: {
    id: "G5",
    channels: [
      { key: "coolWhite", label: "Cool White", color: "#7aa6ff", protocolGroupName: "Cool White" },
      { key: "deepRed", label: "Deep Red", color: "#e03131", protocolGroupName: "DeepRed" },
      { key: "farRed", label: "Far Red", color: "#b1006b", protocolGroupName: "FarRed" },
    ],
  },
  G6: {
    id: "G6",
    channels: [
      { key: "coolWhite", label: "Cool White", color: "#7aa6ff", protocolGroupName: "Cool White" },
      { key: "deepRed", label: "Red", color: "#e03131", protocolGroupName: "Red" },
      { key: "farRed", label: "Far Red", color: "#b1006b", protocolGroupName: "FarRed" },
    ],
  },
  G7: {
    id: "G7",
    channels: [
      { key: "coolWhite", label: "Cool White", color: "#7aa6ff", protocolGroupName: "Cool White" },
      { key: "blue", label: "Blue", color: "#3b82f6", protocolGroupName: "Blue" },
      { key: "cyan", label: "Cyan", color: "#06b6d4", protocolGroupName: "Cyan" },
      { key: "green", label: "Green", color: "#22c55e", protocolGroupName: "Green" },
      { key: "amber", label: "Amber", color: "#f59e0b", protocolGroupName: "Amber" },
      { key: "red", label: "Red", color: "#ef4444", protocolGroupName: "Red" },
      { key: "deepRed", label: "Deep Red", color: "#e03131", protocolGroupName: "DeepRed" },
      { key: "farRed", label: "Far Red", color: "#b1006b", protocolGroupName: "FarRed" },
    ],
  },
  G8: {
    id: "G8",
    channels: [
      { key: "coolWhite", label: "Cool White", color: "#7aa6ff", protocolGroupName: "Cool White" },
      { key: "deepRed", label: "Deep Red", color: "#e03131", protocolGroupName: "DeepRed" },
      { key: "farRed", label: "Far Red", color: "#b1006b", protocolGroupName: "FarRed" },
    ],
  },
};

export function detectRoomFromFilename(filename: string): RoomConfig | null {
  const upper = filename.toUpperCase();
  for (const key of ["G8", "G7", "G6", "G5", "G4"]) {
    if (upper.includes(key)) return ROOM_CONFIGS[key];
  }

  const aliasPatterns: Array<[string, RegExp]> = [
    ["G8", /(?:^|[^A-Z0-9])8(?:[^A-Z0-9]|$)/],
    ["G7", /(?:^|[^A-Z0-9])7(?:[^A-Z0-9]|$)/],
    ["G6", /(?:^|[^A-Z0-9])6(?:[^A-Z0-9]|$)/],
    ["G5", /(?:^|[^A-Z0-9])5(?:[^A-Z0-9]|$)/],
    ["G4", /(?:^|[^A-Z0-9])4(?:[^A-Z0-9]|$)/],
  ];

  for (const [key, pattern] of aliasPatterns) {
    if (pattern.test(upper)) return ROOM_CONFIGS[key];
  }

  return null;
}
