import React, { useState } from "react";

type InspectResult = {
  fileName: string;
  size: number;
  headerOk: boolean;
  header22: number;
  header23: number;
  headerBytesHex: string;
  headerByte19: number;
  headerByte20: number;
  headerByte21: number;
  headerByte24: number;
  headerByte25: number;
  jsonStart: number;
  jsonEnd: number;
  jsonLength: number;
  impliedTotalLen: number; // L = header + json (by current formula)
  impliedJsonLen: number;  // L - 24
};

const FIXED_HEADER_PREFIX = new Uint8Array([
  0x11, 0x46, 0x79, 0x74, 0x6f, 0x74, 0x72, 0x6f, 0x6e, 0x20, 0x50, 0x72, 0x6f, 0x74, 0x6f, 0x63,
  0x6c, 0x01, 0x00, 0x00
]);

function findJsonSpan(buf: Uint8Array): { start: number; end: number } {
  let start = -1;
  for (let i = 0; i < buf.length; i++) {
    if (buf[i] === 0x7b) { // '{'
      start = i;
      break;
    }
  }
  if (start < 0) throw new Error("JSON start '{' not found");
  let i = start;
  let depth = 0;
  let inStr = false;
  let esc = false;
  while (i < buf.length) {
    const ch = buf[i];
    const c = String.fromCharCode(ch);
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
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
  throw new Error("Unterminated JSON: matching '}' not found");
}

function computeImpliedLengths(lo: number, hi: number) {
  // Current forward formula used by the app:
  //   T = 128*hi + lo
  //   L = T - 104
  //   impliedJson = L - 24
  const T = 128 * (hi & 0xff) + (lo & 0xff);
  const L = T - 104;
  const impliedJson = L - 24;
  return { impliedTotalLen: Math.max(0, L), impliedJsonLen: Math.max(0, impliedJson) };
}

export default function FytInspector() {
  const [res, setRes] = useState<InspectResult | null>(null);
  const [err, setErr] = useState<string>("");

  async function onPick() {
    try {
      setErr("");
      const inp = document.createElement("input");
      inp.type = "file";
      inp.accept = ".fyt,application/octet-stream";
      const file: File = await new Promise((resolve, reject) => {
        inp.onchange = () => {
          const f = inp.files?.[0];
          if (f) resolve(f); else reject(new Error("No file chosen"));
        };
        inp.click();
      });

      const buf = new Uint8Array(await file.arrayBuffer());
      const headerOk = (() => {
        if (buf.length < 24) return false;
        for (let i = 0; i < FIXED_HEADER_PREFIX.length; i++) {
          if (buf[i] !== FIXED_HEADER_PREFIX[i]) return false;
        }
        return true;
      })();
      const header22 = buf[22] ?? 0;
      const header23 = buf[23] ?? 0;
      const headerFirst32 = Array.from(buf.slice(0, Math.min(32, buf.length)))
        .map(b => b.toString(16).padStart(2,'0')).join(' ');
      const b19 = buf[19] ?? 0;
      const b20 = buf[20] ?? 0;
      const b21 = buf[21] ?? 0;
      const b24 = buf[24] ?? 0;
      const b25 = buf[25] ?? 0;
      const { start, end } = findJsonSpan(buf);
      const jsonLength = end - start;
      const { impliedTotalLen, impliedJsonLen } = computeImpliedLengths(header22, header23);

      setRes({
        fileName: file.name,
        size: buf.length,
        headerOk,
        header22,
        header23,
        headerBytesHex: headerFirst32,
        headerByte19: b19,
        headerByte20: b20,
        headerByte21: b21,
        headerByte24: b24,
        headerByte25: b25,
        jsonStart: start,
        jsonEnd: end,
        jsonLength,
        impliedTotalLen,
        impliedJsonLen,
      });
    } catch (e: any) {
      setErr(e?.message || String(e));
      setRes(null);
    }
  }

  return (
    <div className="max-w-3xl mx-auto p-4 space-y-4">
      <h2 className="text-xl font-semibold">FYT Inspector</h2>
      <p className="text-sm text-slate-600">
        Drop a .fyt file to inspect header bytes and JSON span. This helps align large-file header math.
      </p>
      <div>
        <button className="btn" onClick={onPick}>Choose .fyt…</button>
      </div>
      {err ? <div className="text-sm text-red-600">Error: {err}</div> : null}
      {res ? (
        <div className="text-sm border rounded p-3">
          <div><b>File:</b> {res.fileName} ({res.size.toLocaleString()} bytes)</div>
          <div><b>Header prefix OK:</b> {String(res.headerOk)}</div>
          <div className="mt-2 font-medium">Header (first 32 bytes hex)</div>
          <div className="font-mono text-xs break-words">{res.headerBytesHex}</div>
          <div className="mt-2 font-medium">Header bytes</div>
          <ul className="list-disc ml-5">
            <li>header[22] (lo): {res.header22} (0x{res.header22.toString(16).padStart(2,'0')})</li>
            <li>header[23] (hi): {res.header23} (0x{res.header23.toString(16).padStart(2,'0')})</li>
            <li>header[19]: {res.headerByte19} (0x{res.headerByte19.toString(16).padStart(2,'0')})</li>
            <li>header[20]: {res.headerByte20} (0x{res.headerByte20.toString(16).padStart(2,'0')})</li>
            <li>header[21]: {res.headerByte21} (0x{res.headerByte21.toString(16).padStart(2,'0')})</li>
            <li>header[24]: {res.headerByte24} (0x{res.headerByte24.toString(16).padStart(2,'0')})</li>
            <li>header[25]: {res.headerByte25} (0x{res.headerByte25.toString(16).padStart(2,'0')})</li>
          </ul>
          <div className="mt-2 font-medium">JSON span</div>
          <ul className="list-disc ml-5">
            <li>start offset (header length): {res.jsonStart.toLocaleString()}</li>
            <li>end offset: {res.jsonEnd.toLocaleString()}</li>
            <li>length (derived): {res.jsonLength.toLocaleString()} bytes</li>
          </ul>
          <div className="mt-2 font-medium">Header implied (current formula)</div>
          <ul className="list-disc ml-5">
            <li>total length (header + json): {res.impliedTotalLen.toLocaleString()} bytes</li>
            <li>json length (implied): {res.impliedJsonLen.toLocaleString()} bytes</li>
          </ul>
          <div className="mt-2 text-slate-600">
            Note: Large files may show a huge mismatch between derived and implied JSON length; that's the data we need to fix the mapping.
          </div>
        </div>
      ) : null}
    </div>
  );
}
