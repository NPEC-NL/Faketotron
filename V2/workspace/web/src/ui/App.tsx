import React, { useEffect, useState, useRef } from "react";
import FilesToolbar from "./FilesTab";
import EditorTab from "./EditorTab";
import GraphTab from "./GraphTab";
import LightTools from "./LightTools";
import CsvTab from "./CsvTab";
import CitiesTab from "./CitiesTab";
import FytInspector from "./FytInspector";
import Welcome from "./Welcome";
import { newProtocol } from "../profiles";
import * as Store from "../state/store";
import npecLogo from "../assets/NPEC.png";
import { LeafButton } from "../LeafButton";
const useStoreAny: any = (Store as any).useProto ?? (Store as any).useStore;

type TabKey = "welcome" | "editor" | "graph" | "light" | "csv" | "cities" | "inspector";

export default function App() {
  const [tab, setTab] = useState<TabKey>("welcome");

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
    <LeafButton
      key={k}
      onClick={() => setTab(k)}
      style={{
        filter: tab === k ? "drop-shadow(0 0 8px rgba(34, 197, 94, 0.6)) brightness(1.1)" : "brightness(0.95)",
        transition: "all 0.3s ease",
        transform: tab === k ? "scale(1.05)" : "scale(1)",
      }}
      aria-selected={tab === k}
    >
      <span style={{
        color: tab === k ? "#16a34a" : "#000000",
        fontWeight: tab === k ? 700 : 600,
        fontSize: "0.95rem",
      }}>
        {label}
      </span>
    </LeafButton>
  );

  return (
    <div className="wrap">
      <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", alignItems: "center", gap: 16, padding: 8, marginBottom: 12 }}>
        {TabBtn("welcome", "Welcome")}
        {TabBtn("editor", "Editor")}
        {TabBtn("graph", "Graph")}
        {TabBtn("light", "Light Tools")}
        {TabBtn("cities", "Cities")}
        {TabBtn("csv", "Time-Series CSV")}
    {/* FYT Inspector tab hidden intentionally; keep logic and panel for future debugging */}
          <div className="flex items-center gap-3 pl-4 border-l border-slate-300">
            <img src={npecLogo} alt="NPEC logo" className="h-24 w-auto" />
            <span className="font-semibold text-slate-700 text-2xl tracking-wide">NPEC Faketron</span>
          </div>
      </div>

      <div style={{ display: tab === "welcome" ? "block" : "none" }}>
        <Welcome />
      </div>

      <div
        ref={editorRef}
        style={{
          display: tab === "editor" ? "block" : "none",
          margin: "20px auto 12px",
          width: "100%",
          maxWidth: 1280,
        }}
      >
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

      <div style={{ display: tab === "cities" ? "block" : "none", margin: "20px", border: "2px solid lightgrey", padding: "10px" }}>
        <CitiesTab />
      </div>

      <div style={{ display: tab === "inspector" ? "block" : "none", margin: "20px", border: "2px solid lightgrey", padding: "10px" }}>
        <FytInspector />
      </div>
    </div>
  );
}
