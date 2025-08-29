// public/legacy/bridge.js
(function () {
  function post(msg) { try { parent.postMessage(msg, "*"); } catch (e) {} }

  function measureHeight() {
    var h = Math.max(
      document.documentElement ? document.documentElement.scrollHeight : 0,
      document.body ? document.body.scrollHeight : 0
    );
    post({ type: "legacy:height", height: h });
  }

  // Tell host we're ready
  function sendReady() {
    post({ type: "legacy:ready" });
  }
  if (document.readyState === "complete" || document.readyState === "interactive") {
    setTimeout(sendReady, 0);
  } else {
    document.addEventListener("DOMContentLoaded", sendReady, { once: true });
  }

  // Receive host → legacy
  window.addEventListener("message", function (ev) {
    var msg = ev.data || {};
    if (!msg || typeof msg !== "object") return;

    if (msg.type === "host:init") {
      if (window.setProfile)  window.setProfile(msg.profile);
      if (window.setProtocol) window.setProtocol(msg.protocol);
      measureHeight();
    } else if (msg.type === "host:set-profile") {
      if (window.setProfile) window.setProfile(msg.profile);
      measureHeight();
    } else if (msg.type === "host:set-protocol") {
      if (window.setProtocol) window.setProtocol(msg.protocol);
      measureHeight();
    } else if (msg.type === "host:get-height") {
      measureHeight();
    }
  });

  // Legacy → host: call this whenever the user edits/save/apply
  window.LegacyBridge = window.LegacyBridge || {};
  window.LegacyBridge.protocolUpdated = function (protocol) {
    post({ type: "legacy:protocol-updated", protocol: protocol });
    measureHeight();
  };

  // Auto-height hooks
  window.addEventListener("load", measureHeight);
  window.addEventListener("resize", function () { requestAnimationFrame(measureHeight); });

  // If legacy exposes refreshUI, wrap it so height updates after each render
  if (typeof window.refreshUI === "function") {
    var _orig = window.refreshUI;
    window.refreshUI = function () {
      try { return _orig.apply(this, arguments); }
      finally { requestAnimationFrame(measureHeight); }
    };
  }
})();
