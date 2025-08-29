import React from "react";
import * as Store from "../state/store";
const useProto: any = (Store as any).useProto ?? (Store as any).useStore;

import { newProtocol, type Protocol } from "../profiles";
import { decodeFYT, encodeFYT } from "faketotron-v2-core";

function pickFile(accept: string): Promise<File> {
  return new Promise((resolve, reject) => {
    const inp = document.createElement("input");
    inp.type = "file";
    inp.accept = accept;
    inp.onchange = () => {
      const f = inp.files?.[0];
      if (f) resolve(f); else reject(new Error("No file chosen"));
    };
    inp.click();
  });
}
function downloadText(name: string, text: string, mime = "application/json") {
  const a = document.createElement("a");
  a.href = "data:" + mime + ";charset=utf-8," + encodeURIComponent(text);
  a.download = name;
  a.click();
}
function downloadBytes(name: string, bytes: Uint8Array) {
  const blob = new Blob([bytes], { type: "application/octet-stream" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

export default function FilesTab() {
  const profile     = useProto((s: any) => s.profile);
  const protocol    = useProto((s: any) => s.protocol) as Protocol;
  const setProtocol = useProto((s: any) => s.setProtocol);

  async function onLoadJson() {
    try {
      const f = await pickFile(".json,application/json");
      const txt = await f.text();
      const obj = JSON.parse(txt);
      if (!obj.description) obj.description = "";
      setProtocol(obj);
    } catch (e: any) {
      alert("Failed to load JSON: " + e?.message);
    }
  }
  async function onLoadFyt() {
    try {
      const f = await pickFile(".fyt,application/octet-stream");
      const buf = new Uint8Array(await f.arrayBuffer());
      const decoded: any = decodeFYT(buf);
      const p: Protocol = { ...decoded.protocol, description: decoded.description ?? "" };
      setProtocol(p);
      window.dispatchEvent(new CustomEvent("protocol:loaded", { detail: { reason: "file" } }));
    } catch (e: any) {
      alert("Failed to load FYT: " + e?.message);
    }
  }
  function onSaveJson() {
    try {
      const text = JSON.stringify(protocol, null, 2);
      downloadText("protocol.json", text, "application/json");
    } catch (e: any) {
      alert("Failed to save JSON: " + e?.message);
    }
  }
  function onSaveFyt() {
    try {
      let bytes: Uint8Array;
      const enc: any = encodeFYT as any;
      try { bytes = enc(protocol); }
      catch { bytes = enc({ protocol, description: (protocol as any).description ?? "" }); }
      downloadBytes("protocol.fyt", bytes);
    } catch (e: any) {
      alert("Failed to save FYT: " + e?.message);
    }
  }
  function onNew() {
    setProtocol(newProtocol(profile));
  }

}
