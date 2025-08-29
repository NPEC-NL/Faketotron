import React, { useEffect, useRef, useState } from "react";
// Support both legacy `useProto` and new `useStore`
import * as Store from "../state/store";
const useStoreAny: any = (Store as any).useProto ?? (Store as any).useStore;

function mapProfileToV1(p: string): "Fytotron" | "Daylight" {
  // Standard & Extended → Fytotron; adjust if you later split Daylight/Helios
  if (p === "daylight") return "Daylight";
  return "Fytotron";
}

// lightweight signature to avoid re-sending identical protocol into the iframe
function sig(p: any): string {
  try {
    const s0 = p?.sections?.[0] || { parts: [] };
    return [p?.repeat ?? 0, p?.logic ?? "", s0.parts?.length ?? 0, p?.description?.length ?? 0].join("|");
  } catch {
    return Math.random().toString(36);
  }
}

export default function LegacyEditor() {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [ready, setReady] = useState(false);

  const profile  = useStoreAny((s: any) => s.profile);
  const protocol = useStoreAny((s: any) => s.protocol);
  const setProto = useStoreAny((s: any) => s.setProtocol);

  const lastIframeSig = useRef<string>(""); // what the iframe last told us
  const lastPushedSig = useRef<string>(""); // what we last pushed into the iframe
  const ignoreNextProtocolEffect = useRef<boolean>(false);

  // Handle messages from the iframe
  useEffect(() => {
    function onMsg(ev: MessageEvent) {
      if (!iframeRef.current || ev.source !== iframeRef.current.contentWindow) return;
      const msg = ev.data;
      if (!msg || typeof msg !== "object") return;

      if (msg.type === "v1:ready") {
        setReady(true);
        iframeRef.current.contentWindow?.postMessage(
          { type: "v2:init", profile: mapProfileToV1(profile), protocol },
          "*"
        );
        lastPushedSig.current = sig(protocol);
      } else if (msg.type === "v1:protocol-updated" && msg.protocol) {
        const curSig = sig(msg.protocol);
        lastIframeSig.current = curSig;
        // Update store, but don’t immediately push back into iframe
        ignoreNextProtocolEffect.current = true;
        setProto(msg.protocol);
      }
    }
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, []);

  // Profile changes → tell iframe (no echo issue here)
  useEffect(() => {
    if (!ready) return;
    iframeRef.current?.contentWindow?.postMessage(
      { type: "v2:set-profile", profile: mapProfileToV1(profile) },
      "*"
    );
  }, [ready, profile]);

  // Protocol changes from other parts of the app (e.g., loading a file) → push into iframe
  useEffect(() => {
    if (!ready) return;

    if (ignoreNextProtocolEffect.current) {
      // This change originated from the iframe; just clear the flag and do nothing.
      ignoreNextProtocolEffect.current = false;
      return;
    }

    const currentSig = sig(protocol);
    if (currentSig === lastIframeSig.current || currentSig === lastPushedSig.current) {
      // No new content to push (prevents ping-pong)
      return;
    }

    iframeRef.current?.contentWindow?.postMessage(
      { type: "v2:set-protocol", protocol },
      "*"
    );
    lastPushedSig.current = currentSig;
  }, [ready, protocol]);

  return (
    <div className="card" style={{ padding: 0, overflow: "hidden" }}>
      <div className="label" style={{ padding: "10px 12px" }}>Legacy Protocol Editor (V1.4 Embedded)</div>
      <iframe
        ref={iframeRef}
        title="Legacy Editor"
        src="/legacy-editor.html"
        style={{ border: 0, width: "100%", height: "720px", display: "block" }}
      />
    </div>
  );
}
