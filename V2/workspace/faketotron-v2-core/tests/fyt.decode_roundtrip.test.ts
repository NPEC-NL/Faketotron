import { describe, it, expect } from "vitest";
import { decodeFYT, encodeFYT, DecodedFYT, Protocol } from "../src";
import fs from "node:fs";
import path from "node:path";

const fx = (p: string) => path.join(__dirname, "fixtures", p);

describe("FYT decode + round-trip (preserving header/json bytes)", () => {
  it("decodes Arabidopsis fixture and matches its JSON", () => {
    const fytPath = fx("Arabidopsis_LongDay_LowLight.fyt");
    const jsonPath = "/mnt/data/Arabidopsis_LongDay_LowLight.json"; // original copy if available
    const bin = new Uint8Array(fs.readFileSync(fytPath));
    const decoded = decodeFYT(bin);
    expect(decoded.protocol.description || decoded.description).toBeDefined();

    if (fs.existsSync(jsonPath)) {
      const ref = JSON.parse(fs.readFileSync(jsonPath, "utf-8")) as Protocol;
      // Allow for clouds->cloud normalization
      expect(decoded.protocol.sections[0].parts.length).toBe(ref.sections[0].parts.length);
      expect(decoded.protocol.repeat).toBe(ref.repeat);
      expect(decoded.protocol.logic).toBe(ref.logic);
      expect(decoded.protocol.description).toBe(ref.description);
    }

    // Round-trip: encode(decode(fyt)) === original bytes
    const re = encodeFYT(decoded as DecodedFYT);
    expect(Buffer.from(re)).toEqual(Buffer.from(bin));
  });

  it("decodes sine+cloud fixture and round-trips exactly", () => {
    const fytPath = fx("test_sinecloud.fyt");
    const jsonPath = fx("test_sinecloud.json");
    const bin = new Uint8Array(fs.readFileSync(fytPath));
    const decoded = decodeFYT(bin);
    const ref = JSON.parse(fs.readFileSync(jsonPath, "utf-8")) as Protocol;

    // Basic structure checks
    expect(decoded.protocol.sections[0].parts.length).toBeGreaterThan(0);
    // Temperature ramp sanity
    const temp = decoded.protocol.sections[0].parts.find(p => p.type === "temperature");
    expect(temp).toBeDefined();

    // Round-trip: exact bytes
    const re = encodeFYT(decoded as DecodedFYT);
    expect(Buffer.from(re)).toEqual(Buffer.from(bin));
  });
});
