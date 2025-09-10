import React, { useEffect, useRef, useState } from "react";
import * as Store from "../state/store";
import { canonicalizeProtocol } from "../utils/canonicalize";

const useProto: any = (Store as any).useProto ?? (Store as any).useStore;
import legacyHtml from "../legacy/latest/index.html?raw";

/* map profiles if needed (kept for completeness) */
function mapProfileToLegacy(p: string) {
  switch (p) {
    case "daylight": return "Daylight";
    case "two": return "TwoShelves";
    case "two-daylight": return "TwoShelvesDaylight";
    default: return "Fytotron";
  }
}

/* visibility helper for modal autoscroll */
function isActuallyVisible(el: Element): boolean {
  const cs = getComputedStyle(el as HTMLElement);
  if (cs.display === "none" || cs.visibility === "hidden" || parseFloat(cs.opacity || "1") === 0) return false;
  const rect = (el as HTMLElement).getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}
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
  } catch { return () => {}; }
}

/* debounce pull on DOM edits inside legacy */
function attachChangeSync(iframeEl: HTMLIFrameElement, pullFromLegacy: () => void) {
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
    doc.addEventListener("change", bump, true);
    doc.addEventListener("input",  bump, true);
    doc.addEventListener("click",  bump, true);
    setTimeout(bump, 300);
    return () => {
      clearTimeout(t);
      doc.removeEventListener("change", bump, true);
      doc.removeEventListener("input",  bump, true);
      doc.removeEventListener("click",  bump as any, true);
    };
  } catch { return () => {}; }
}

export default function EditorTab() {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [ready, setReady] = useState(false);

  const profile  = useProto((s: any) => s.profile);
  const protocol = useProto((s: any) => s.protocol);
  const setProto = useProto((s: any) => s.setProtocol);

  // loop suppression
  const suppressPullUntilRef = useRef(0);

  /* Bridge injected into legacy page */
  const BRIDGE = `
<script>
(function(){
  function log(){ try { console.log.apply(console, ['[legacy-bridge]'].concat([].slice.call(arguments))); } catch(e){} }

  function notifyReady(){
    try { parent.postMessage({type:'legacy:ready'}, '*'); } catch(e) { log('notifyReady failed', e); }
  }

  function snapshot(){
    try{
      var build = window.buildProtocolJson || window.exportProtocolJson;
      if (typeof build === 'function') {
        var proto = build();
        if (proto) {
          log('snapshot → sending legacy:protocol-updated');
          parent.postMessage({type:'legacy:protocol-updated', protocol: proto}, '*');
        } else {
          log('snapshot → build() returned null/undefined');
        }
      } else {
        log('snapshot → no buildProtocolJson/exportProtocolJson');
      }
    }catch(e){ log('snapshot failed:', e); }
  }

  // --- Fallback "import" path if the editor doesn't provide setProtocolFromHost ---
  // This tries several known hooks and finally falls back to replacing globals & asking the UI to refresh.
  function defaultSetProtocolFromHost(proto){
    log('default setProtocolFromHost invoked');
    try {
      // Known V1/V1.4/V1.5 helpers (if present)
      if (typeof window.importProtocolJson === 'function') { log('using importProtocolJson'); window.importProtocolJson(proto); return; }
      if (typeof window.loadFromJson      === 'function') { log('using loadFromJson');      window.loadFromJson(proto);      return; }
      if (typeof window.applyProtocolJson === 'function') { log('using applyProtocolJson'); window.applyProtocolJson(proto); return; }

      // Fallback: map to "groups" global & ask UI to re-render
      if (proto && proto.sections && proto.sections[0] && Array.isArray(proto.sections[0].parts)) {
        var parts = proto.sections[0].parts;
        if (Array.isArray(parts)) {
          window.groups = parts.map(function(p, i){
            // keep the shape close to what V1 uses in its runtime (name/type/unit/vars/phases)
            return {
              name: p['group-name'] || p.name || ('Group ' + (i+1)),
              type: p.type,
              unit: p.unit || '',
              vars: Array.isArray(p.vars) ? p.vars.slice() : [],
              phases: Array.isArray(p.phases) ? p.phases.slice() : []
            };
          });
          // common refreshers in V1.x
          if (typeof window.renderAll  === 'function') { log('calling renderAll()');  window.renderAll(); }
          if (typeof window.refreshAll === 'function') { log('calling refreshAll()'); window.refreshAll(); }
          if (typeof window.rebuildUI  === 'function') { log('calling rebuildUI()');  window.rebuildUI(); }
        }
      }
    } catch(e) {
      log('default setProtocolFromHost failed', e);
    }
  }

  // Ensure a callable hook exists
  if (typeof window.setProtocolFromHost !== 'function') {
    log('installing default setProtocolFromHost');
    window.setProtocolFromHost = defaultSetProtocolFromHost;
  }

  // Make buildProtocolJson available if only exportProtocolJson exists
  if (typeof window.buildProtocolJson !== 'function' && typeof window.exportProtocolJson === 'function') {
    window.buildProtocolJson = window.exportProtocolJson;
  }

  // Handle messages from host
  window.addEventListener('message', function(ev){
    var msg = ev && ev.data || {};
    if (!msg || !msg.type) return;

    if (msg.type === 'host:init') {
      log('host:init');
      try {
        if (typeof window.setProfileFromHost  === 'function') window.setProfileFromHost(msg.profile);
        if (typeof window.setProtocolFromHost === 'function') window.setProtocolFromHost(msg.protocol);
      } finally { setTimeout(snapshot, 50); }
    }
    else if (msg.type === 'host:set-profile') {
      log('host:set-profile');
      try { if (typeof window.setProfileFromHost  === 'function') window.setProfileFromHost(msg.profile); }
      finally { setTimeout(snapshot, 50); }
    }
    else if (msg.type === 'host:set-protocol') {
      log('host:set-protocol');
      try { if (typeof window.setProtocolFromHost === 'function') window.setProtocolFromHost(msg.protocol); }
      finally { setTimeout(snapshot, 80); }
    }
    else if (msg.type === 'host:request-protocol') {
      log('host:request-protocol');
      snapshot();
    }
  }, true);

  // Also snapshot when the DOM changes inside legacy (keeps Editor in sync)
  var t=null; function bump(){ clearTimeout(t); t=setTimeout(snapshot, 200); }
  document.addEventListener('input',  bump, true);
  document.addEventListener('change', bump, true);
  document.addEventListener('click',  bump, true);

  notifyReady();
})();
</script>`;


  const srcDoc = legacyHtml.includes("</body>")
    ? legacyHtml.replace("</body>", `${BRIDGE}\n</body>`)
    : legacyHtml + BRIDGE;

  // Handle messages FROM legacy
  useEffect(() => {
    function onMsg(ev: MessageEvent) {
      const msg = (ev && ev.data) || {};
      if (msg?.type === "legacy:ready") {
        setReady(true);
        iframeRef.current?.contentWindow?.postMessage(
          { type: "host:init", profile, protocol },
          "*"
        );
      } else if (msg?.type === "legacy:protocol-updated" && msg.protocol) {
        // Ignore echoes while we’re still pushing
        if (Date.now() < suppressPullUntilRef.current) {
          // still within suppression window
          return;
        }
        console.log("[Editor] <- legacy:protocol-updated (pull into store)");
        const fixed = canonicalizeProtocol(msg.protocol);
        setProto(fixed);
        // tell graphs other subscribers that a fresh protocol arrived
        queueMicrotask(() => window.dispatchEvent(new CustomEvent("protocol:loaded")));
        window.dispatchEvent(new CustomEvent("protocol:loaded"));
      }
    }
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, [profile, protocol, setProto]);

  // Let GraphTab send drafts here (this is the event it expects!)
  useEffect(() => {
    function onSaveDraft(ev: Event) {
      const detail = (ev as CustomEvent).detail as any;
      if (!detail || !detail.protocol) return;
      const next = canonicalizeProtocol(detail.protocol);
      console.log("[Editor] <- protocol:save-draft (apply to store + push to legacy)");
      // apply to store first so tabs are in sync
      setProto(next);
      // temporarily suppress pulls originating from our own push
      suppressPullUntilRef.current = Date.now() + 900;
      // push to legacy iframe
      console.log("[Editor] -> host:set-protocol (pushing merged draft into legacy)");
      iframeRef.current?.contentWindow?.postMessage({ type: "host:set-protocol", protocol: next }, "*");
      // let others (Graph) know a cohesive protocol is now current
      window.dispatchEvent(new CustomEvent("protocol:loaded"));
    }
    window.addEventListener("protocol:save-draft", onSaveDraft as any);
    return () => window.removeEventListener("protocol:save-draft", onSaveDraft as any);
  }, [setProto]);

  // When the legacy DOM mutates (user edits inside iframe), pull the snapshot back
  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;
    const detachA = attachModalRevealer(iframe);
    const detachB = attachChangeSync(iframe, () => {
      if (Date.now() < suppressPullUntilRef.current) return;
      iframe.contentWindow?.postMessage({ type: "host:request-protocol" }, "*");
    });
    return () => { detachA(); detachB(); };
  }, [ready]);

  return (
    <div className="card" style={{ overflow: "hidden" }}>
      <div className="label">Protocol Editor (Legacy)</div>
      <div style={{ border: "1px solid #eee", borderRadius: 8, overflow: "hidden" }}>
        <iframe
          ref={iframeRef}
          srcDoc={srcDoc}
          style={{ width: "100%", height: 900, border: "0" }}
          sandbox="allow-same-origin allow-scripts allow-forms allow-modals allow-popups allow-downloads"
        />
      </div>
    </div>
  );
}
