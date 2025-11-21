import React, { useEffect, useState, useRef } from "react";
import FilesToolbar from "./FilesTab";
import EditorTab from "./EditorTab";
import GraphTab from "./GraphTab";
import LightTools from "./LightTools";
import CsvTab from "./CsvTab";
import FytInspector from "./FytInspector";
import { newProtocol } from "../profiles";
import * as Store from "../state/store";
import npecLogo from "../assets/NPEC.png";
const useStoreAny: any = (Store as any).useProto ?? (Store as any).useStore;

type TabKey = "editor" | "graph" | "light" | "csv" | "inspector";

export default function App() {
  const [tab, setTab] = useState<TabKey>("editor");

  const profile   = useStoreAny((s: any) => s.profile);
  const protocol  = useStoreAny((s: any) => s.protocol);
  const setProto  = useStoreAny((s: any) => s.setProtocol);

  useEffect(() => {
    if (!protocol?.sections?.[0]?.parts?.length) {
      setProto(newProtocol(profile));
    }
  }, []);

  const editorRef = useRef<HTMLDivElement>(null);
  const graphRef  = useRef<HTMLDivElement>(null);
  const lightRef  = useRef<HTMLDivElement>(null);

  const TabBtn = (k: TabKey, label: string) => (
    <button
      key={k}
      className="btn"
      onClick={() => setTab(k)}
      style={{
        padding: "6px 10px",
        borderRadius: 8,
        border: "1px solid #e5e7eb",
        background: tab === k ? "#eef2ff" : "white",
        fontWeight: tab === k ? 600 : 500,
      }}
      aria-selected={tab === k}
    >
      {label}
    </button>
  );

  return (
    <div className="wrap">
      <div style={{ display: "flex", gap: 8, padding: 8, marginBottom: 12 }}>
        {TabBtn("editor", "Editor")}
        {TabBtn("graph", "Graph")}
        {TabBtn("light", "Light Tools")}
    {TabBtn("csv", "CSV")}
    {/* FYT Inspector tab hidden intentionally; keep logic and panel for future debugging */}
          <div className="flex items-center gap-2 pl-3 border-l border-slate-300 ml-auto">
            <img src={npecLogo} alt="NPEC logo" className="h-16 w-auto" />
            <span className="font-semibold text-slate-700 text-xl tracking-wide">NPEC Faketron</span>
          </div>
      </div>

      <div
        ref={editorRef}
        style={{ display: tab === "editor" ? "block" : "none", marginBottom: 12 }}
      >
        <div style={{ marginBottom: 8 }}>
        </div>
        <EditorTab />
      </div>

      <div
        ref={graphRef}
        style={{ display: tab === "graph" ? "block" : "none", margin: "20px", border: "2px solid lightgrey", padding: "10px" }}
      >
        <GraphTab />
      </div>

      <div ref={lightRef} style={{ display: tab === "light" ? "block" : "none", margin: "20px", border: "2px solid lightgrey", padding: "10px" }}>
        <LightTools />
      </div>

      <div style={{ display: tab === "csv" ? "block" : "none", margin: "20px", border: "2px solid lightgrey", padding: "10px" }}>
        <CsvTab />
      </div>

      <div style={{ display: tab === "inspector" ? "block" : "none", margin: "20px", border: "2px solid lightgrey", padding: "10px" }}>
        <FytInspector />
      </div>
    </div>
  );
}
