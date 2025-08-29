# V2 Dev notes

V1 is inline embedded in V2. To replace V1 to your own version/build, you need to:

1. Put your V1 html file under `\workspace\web\src\legacy\latest`, rename it as `index.html`
2. Add a line `<script src="../bridge.js"></script>` in your html if it doesn't contain this line. You can add it between `</script>` and `</body>` (the third last line).
3. At `\workspace`, run: `pnpm i`, `pnpm -C faketotron-v2-core build`, then `pnpm -C web dev` (requires Node.js and pnpm)
4. You should see this running at localhost.
5. If you want to export it to a single .html, run `pnpm -C web add -D vite-plugin-singlefile` and `pnpm -C web build`, then the single file html should be under `\workspace\web\dist`.