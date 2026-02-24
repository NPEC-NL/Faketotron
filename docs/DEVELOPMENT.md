# Development

## V1 vs. V2

The origina purpose of Faketotron was more for user training on how to operate the actual machine. The usage expands to direct protocol generation, visualization and metadata management later. As a result, the legacy editor V1, which fully mimics the PSI software, is inline embedded into V2, a modern wrapper that contains way more functions. However, **the machine built-in variable names and group were hard-coded in V1**.

If you need to adapt Faketotron to your own PSI system that has different setup, you need to modify V1 manually. For adding or modifying the profiles at legacy editor (V1), you can edit and open directly the `V2\workspace\web\src\legacy\latest\index.html`, and modify the profile default json at `const PROFILE_JSONS` and their corresponding ranges at `const RANGES`. The profile .json (variable groups and names) can be obtained by the real Fytotron Client by saving the protocol (.fyt file) to local computer, then open it using vscode or other hex decoder. For the range limit, you need to test it yourself on the real machine.

**Be very careful to also edit `const MACHINE_VAR`**: It's the actual machine variable name that you should obtain from the "real" .fyt file. We perform some frontend name mapping to match the display name in the real Fytotron (the real Fytotron Client has different display names than their machine variable names).


## Wrapping customized V1 into V2

V1 is inline embedded in V2. To replace V1 to your own version/build, you need to:

1. Put your V1 html file under `\workspace\web\src\legacy\latest`, rename it as `index.html`
2. Copy the [bridge script](#bridge-script) in your html if it doesn't contain this line. You can add it between `</script>` and `</body>` (the third last line).
3. At `\workspace`, run: `pnpm i`, `pnpm -C faketotron-v2-core build`, then `pnpm -C web dev` (requires Node.js and pnpm). You should then see it running at localhost.

If you want to export the app into a single .html, run `pnpm -C web add -D vite-plugin-singlefile` and `pnpm -C web build`, then the single file html should be `\workspace\web\dist\index.html`.

### Editing V2 Light Tool Presets
At `\workspace\web\src\ui\LightTools.tsx`, edit the json profile at `const DEFAULT_PRESETS`.

### V1 to V2 bridge script

```js
<script>
/* ====== Protocol receiver from graph tab ====== */
(function () {
  function setProtocolFromHost(proto) {
    try {
      protocol = {
        description: proto?.description || "",
        repeat: proto?.repeat ?? 2147483647,
        logic: proto?.logic || "",
        sections: Array.isArray(proto?.sections) ? proto.sections : [{ parts: [] }],
      };
      document.getElementById("desc").value   = protocol.description;
      document.getElementById("logic").value  = protocol.logic && protocol.logic !== "" ? protocol.logic : "- not set -";
      document.getElementById("repeat").value = protocol.repeat === 2147483647 ? "Infinitely times" : String(protocol.repeat);
      const rebuilt    = buildGroupsFromLoaded(protocol);
      groups           = rebuilt.groups;
      unassigned       = rebuilt.unassigned;
      activeGroupId    = groups[0]?.id || null;
      vmSelectedGroupId= activeGroupId;

      refreshUI();

      parent.postMessage({ type: "legacy:protocol-updated", protocol }, "*");
      console.log("[legacy-bridge] setProtocolFromHost → applied & refreshed");
    } catch (e) {
      console.error("[legacy-bridge] setProtocolFromHost failed", e);
    }
  }

  window.setProtocolFromHost = setProtocolFromHost;

  window.addEventListener("message", (ev) => {
    const msg = ev.data || {};
    if (msg.type === "host:set-protocol") {
      console.log("[legacy-bridge] host:set-protocol");
      setProtocolFromHost(msg.protocol);
    }
  });
})();
</script>
```