import React, { useEffect, useState, useRef } from "react";
import FilesToolbar from "./FilesTab";
import EditorTab from "./EditorTab";
import GraphTab from "./GraphTab";
import LightTools from "./LightTools";
import { newProtocol } from "../profiles";
import * as Store from "../state/store";
const useStoreAny: any = (Store as any).useProto ?? (Store as any).useStore;

type TabKey = "editor" | "graph" | "light";

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
      </div>

      <div
        ref={editorRef}
        style={{ display: tab === "editor" ? "block" : "none", marginBottom: 12 }}
      >
        <div style={{ marginBottom: 8 }}>
          <FilesToolbar />
        </div>
        <EditorTab />
      </div>

      <div
        ref={graphRef}
        style={{ display: tab === "graph" ? "block" : "none", marginBottom: 12 }}
      >
        <GraphTab />
      </div>

      <div ref={lightRef} style={{ display: tab === "light" ? "block" : "none" }}>
        <LightTools />
      </div>
    </div>
  );
}
