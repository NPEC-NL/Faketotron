import React, { useEffect, useRef, useState } from "react";
import * as Store from "../state/store";
import { canonicalizeProtocol } from "../utils/canonicalize";

const useProto: any = (Store as any).useProto ?? (Store as any).useStore;
// const LEGACY_SRC = "/legacy/latest/index.html";

// Import legacy HTML as a string (Vite's ?raw)
import legacyHtml from "../legacy/latest/index.html?raw";

function mapProfileToLegacy(p: string) {
  switch (p) {
    case "daylight": return "Daylight";
    case "two": return "TwoShelves";
    case "two-daylight": return "TwoShelvesDaylight";
    default: return "Fytotron";
  }
}

/** Return true if element is actually visible (display and non-zero area). */
function isActuallyVisible(el: Element): boolean {
  const cs = getComputedStyle(el as HTMLElement);
  if (cs.display === "none" || cs.visibility === "hidden" || parseFloat(cs.opacity || "1") === 0) return false;
  const rect = (el as HTMLElement).getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

/** Attach a MutationObserver in the iframe: when a modal becomes visible, scroll it into view. */
function attachModalRevealer(iframeEl: HTMLIFrameElement) {
  try {
    const doc = iframeEl.contentDocument || iframeEl.contentWindow?.document;
    if (!doc) return () => {};

    let rafId = 0;
    const reveal = () => {
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        const candidates = Array.from(doc.querySelectorAll(".modal"));
        const visible = candidates.find(isActuallyVisible);
        if (visible) {
          (visible as HTMLElement).scrollIntoView({ block: "center", inline: "nearest" });
          iframeEl.contentWindow?.scrollTo({ top: Math.max(0, visible.getBoundingClientRect().top - 40), behavior: "instant" as any });
        }
      });
    };

    const mo = new MutationObserver(reveal);
    mo.observe(doc.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["class", "style"] });

    doc.addEventListener("DOMContentLoaded", reveal);
    iframeEl.contentWindow?.addEventListener("load", reveal);
    iframeEl.contentWindow?.addEventListener("resize", reveal);

    const iv = setInterval(reveal, 400);

    return () => {
      cancelAnimationFrame(rafId);
      clearInterval(iv);
      mo.disconnect();
      iframeEl.contentWindow?.removeEventListener("load", reveal);
      iframeEl.contentWindow?.removeEventListener("resize", reveal);
    };
  } catch {
    return () => {};
  }
}

/** Install input/change/click listeners inside legacy to trigger pullFromLegacy (debounced). */
function attachChangeSync(
  iframeEl: HTMLIFrameElement,
  pullFromLegacy: () => void
) {
  try {
    const doc = iframeEl.contentDocument || iframeEl.contentWindow?.document;
    if (!doc) return () => {};

    let t: any = null;
    const bump = () => {
      clearTimeout(t);
      t = setTimeout(() => {
        console.log("[Editor] change detected → pullFromLegacy()");
        pullFromLegacy();
      }, 250);
    };

    // Capture phase edits reliably (change, input on forms; click on buttons)
    doc.addEventListener("change", bump, true);
    doc.addEventListener("input", bump, true);
    doc.addEventListener("click", (e) => {
      const el = e.target as HTMLElement | null;
      // most legacy actions are buttons/anchors with classes; capturing any click is safe (debounced)
      if (el) bump();
    }, true);

    // Pull once after legacy finishes initial render
    setTimeout(bump, 300);

    return () => {
      clearTimeout(t);
      doc.removeEventListener("change", bump, true);
      doc.removeEventListener("input", bump, true);
      doc.removeEventListener("click", bump as any, true);
    };
  } catch {
    return () => {};
  }
}

export default function EditorTab() {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [ready, setReady] = useState(false);

  const profile  = useProto((s: any) => s.profile);
  const protocol = useProto((s: any) => s.protocol);
  const setProto = useProto((s: any) => s.setProtocol);

  // Simple push-suppression window to avoid echo loops when we just pulled
  const suppressPushUntilRef = useRef(0);
  const suppressPullUntilRef = useRef(0);


  // Pull protocol directly from legacy (V1.x exposes buildProtocolJson()).
  const BRIDGE = `
<script>
(function(){
  // Tell host we're alive
  function notifyReady(){ try{ parent.postMessage({type:'legacy:ready'}, '*'); }catch(e){} }
  notifyReady();

  // Build & send a snapshot of the protocol
  function snapshot(){
    try{
      var build = window.buildProtocolJson || window.exportProtocolJson;
      if (typeof build === 'function') {
        var proto = build();
        if (proto) parent.postMessage({type:'legacy:protocol-updated', protocol: proto}, '*');
      }
    }catch(e){ console.warn('[legacy] snapshot failed:', e); }
  }

  // Listen to host pushes (profile/protocol/init/request)
  window.addEventListener('message', function(ev){
    var msg = ev && ev.data || {};
    // NOTE: do NOT strict-check ev.origin; about:srcdoc => "null"
    if (msg.type === 'host:init') {
      try {
        if (typeof window.setProfileFromHost  === 'function') window.setProfileFromHost(msg.profile);
        if (typeof window.setProtocolFromHost === 'function') window.setProtocolFromHost(msg.protocol);
      } finally { snapshot(); }
    } else if (msg.type === 'host:set-profile') {
      try { if (typeof window.setProfileFromHost  === 'function') window.setProfileFromHost(msg.profile); }
      finally { snapshot(); }
    } else if (msg.type === 'host:set-protocol') {
      try { if (typeof window.setProtocolFromHost === 'function') window.setProtocolFromHost(msg.protocol); }
      finally { snapshot(); }
    } else if (msg.type === 'host:request-protocol') {
      snapshot();
    }
  }, true);

  // Emit on user changes (debounced)
  var t=null; function bump(){ clearTimeout(t); t=setTimeout(snapshot, 200); }
  document.addEventListener('input',  bump, true);
  document.addEventListener('change', bump, true);
  document.addEventListener('click',  bump, true);

  // Normalize legacy function names if V1.5 changed them
  if (typeof window.buildProtocolJson !== 'function' && typeof window.exportProtocolJson === 'function') {
    window.buildProtocolJson = window.exportProtocolJson;
  }
})();
</script>`;

  // 3) Compose srcDoc: append the bridge right before </body> (or at the end)
  const srcDoc = legacyHtml.includes("</body>")
    ? legacyHtml.replace("</body>", `${BRIDGE}\n</body>`)
    : legacyHtml + BRIDGE;

  // 4) Host-side message handler → update store
  useEffect(() => {
    function onMsg(ev: MessageEvent) {
      const msg = (ev && ev.data) || {};
      if (msg?.type === "legacy:ready") {
        // Optionally push initial profile/protocol here if you keep them in store
        // iframeRef.current?.contentWindow?.postMessage({type:'host:init', profile, protocol}, '*');
      } else if (msg?.type === "legacy:protocol-updated" && msg.protocol) {
        const fixed = canonicalizeProtocol(msg.protocol);
        setProto(fixed);
        // Optional: signal graph to hard-refresh immediately
        // queueMicrotask(() => window.dispatchEvent(new CustomEvent("protocol:loaded")));
      }
    }
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, [setProto]);

  return (
    <div className="card" style={{ padding: 0, overflow: "visible" }}>
      <div className="label" style={{ padding: "8px 12px" }}>Legacy Editor</div>
      <iframe
        ref={iframeRef}
        title="Legacy Editor"
        srcDoc={srcDoc}
        style={{ border: 0, width: "100%", height: 820, display: "block", background: "#fff" }}
      />
    </div>
  );
}
