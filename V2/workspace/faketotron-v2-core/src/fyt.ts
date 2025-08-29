/**
 * FYT encoder/decoder with exact round-trip support.
 * - Preserves original header+JSON when decoding, so encode(decode(bin)) === bin
 * - Fresh encodes follow your rules for header bytes, JSON, and trailer
 */

import { Protocol } from "./types";
import { encodeULEB128, decodeULEB128 } from "./uleb128";

export type DecodedFYT = {
  protocol: Protocol;
  header: Uint8Array;      // original 24-byte header (preserved for round-trip)
  jsonBytes: Uint8Array;   // exact JSON bytes (preserved for round-trip)
  description: string;     // trailer description ("" allowed)
};

function toUtf8(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}
function fromUtf8(b: Uint8Array): string {
  return new TextDecoder("utf-8", { fatal: false }).decode(b);
}

// Find JSON object span via brace matching with string/escape handling
function findJsonSpan(buf: Uint8Array): { start: number; end: number } {
  let start = -1;
  for (let i = 0; i < buf.length; i++) {
    if (buf[i] === 0x7b /* '{' */) { start = i; break; }
  }
  if (start < 0) throw new Error("FYT: JSON object not found");
  let i = start;
  let depth = 0;
  let inStr = false;
  let esc = false;
  while (i < buf.length) {
    const ch = buf[i];
    const c = String.fromCharCode(ch);
    if (inStr) {
      if (esc) { esc = false; }
      else if (c === "\\") { esc = true; }
      else if (c === '"') { inStr = false; }
    } else {
      if (c === '"') inStr = true;
      else if (c === "{") depth++;
      else if (c === "}") {
        depth--;
        if (depth === 0) return { start, end: i + 1 };
      }
    }
    i++;
  }
  throw new Error("FYT: Unterminated JSON");
}

function normalizeClouds(obj: any): void {
  // Convert legacy phase type "clouds" -> "cloud" for code use
  if (!obj || typeof obj !== "object") return;
  if (Array.isArray(obj)) { obj.forEach(normalizeClouds); return; }
  if ((obj as any).type === "clouds") (obj as any).type = "cloud";
  Object.values(obj).forEach(normalizeClouds);
}

export function decodeFYT(bin: Uint8Array): DecodedFYT {
  if (bin.length < 24) throw new Error("FYT too small");
  const header = bin.slice(0, 24);

  // Validate header magic: 0x11 + "Fytotron Protocol"
  const expected = new Uint8Array([0x11, ...toUtf8("Fytotron Protocol")]);
  for (let i = 0; i < expected.length; i++) {
    if (header[i] !== expected[i]) throw new Error("Invalid FYT header");
  }

  const { start, end } = findJsonSpan(bin);
  const jsonBytes = bin.slice(start, end);

  // Skip CR/LF between JSON and trailer
  let pos = end;
  while (pos < bin.length && (bin[pos] === 0x0d || bin[pos] === 0x0a)) pos++;

  // Trailer = [ULEB128(descLen)] + [desc bytes]
  const { value: descLen, next } = decodeULEB128(bin, pos);
  const descBytes = bin.slice(next, next + descLen);
  const description = fromUtf8(descBytes);

  const jsonText = fromUtf8(jsonBytes);
  const obj = JSON.parse(jsonText);
  normalizeClouds(obj);

  return { protocol: obj as Protocol, header, jsonBytes, description };
}

/**
 * Encode FYT
 * - If input is a DecodedFYT, preserve header/json/description for exact round-trip
 * - If input is a fresh Protocol:
 *   - JSON: pretty-printed, CRLF, no trailing newline; description forced to ""
 *   - Trailer: ULEB128(descLen) + UTF-8 description; empty -> single 0x00 byte
 *   - Header bytes 22..23: computed from (header + JSON) only:
 *       L = header.length + jsonBytes.length
 *       T = L + 104
 *       q = floor(T / 128)
 *       hi = q - 1
 *       lo = (T % 128) + 128
 *       header[22] = lo, header[23] = hi   (little-endian)
 */
export function encodeFYT(input: Protocol | DecodedFYT): Uint8Array {
  let header: Uint8Array;
  let jsonBytes: Uint8Array;
  let description: string;

  if ((input as any).header && (input as any).jsonBytes) {
    const d = input as DecodedFYT;
    header = d.header;
    jsonBytes = d.jsonBytes;
    description = d.description ?? (d.protocol as any)?.description ?? "";
  } else {
    const proto = input as Protocol;
    // Prepare JSON body: description cleared, pretty-printed then CRLF-normalized
    const trailerDesc = (proto as any).description ?? "";
    const protoForJson = { ...(proto as any), description: "" } as Protocol;
    const pretty = JSON.stringify(protoForJson, null, 2);
    const text = pretty.split("\n").join("\r\n"); // CRLF, no extra newline added
    jsonBytes = toUtf8(text);
    description = trailerDesc;

    // Build header and compute bytes 22..23 from (header + JSON) only
    header = new Uint8Array(24);
    const prefix = new Uint8Array([0x11, ...toUtf8("Fytotron Protocol")]);
    header.set(prefix, 0);
    header[19] = 0x01; header[20] = 0x00; header[21] = 0x00;

    const L = header.length + jsonBytes.length; // exclude trailer per spec
    const T = L + 104;
    const q = Math.floor(T / 128);
    const hi = q - 1;
    const lo = (T % 128) + 128;
    header[22] = lo & 0xFF;
    header[23] = hi & 0xFF;
  }

  // Trailer bytes
  const descBytes = toUtf8(description);
  const lenBytes = encodeULEB128(descBytes.length);

  const out = new Uint8Array(header.length + jsonBytes.length + lenBytes.length + descBytes.length);
  let o = 0;
  out.set(header, o); o += header.length;
  out.set(jsonBytes, o); o += jsonBytes.length;
  out.set(lenBytes, o); o += lenBytes.length;
  out.set(descBytes, o); o += descBytes.length;

  return out;
}
