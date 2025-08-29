// vite.config.ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { viteSingleFile } from "vite-plugin-singlefile";

export default defineConfig({
  base: "./",                              // relative paths in the output
  plugins: [
    react(),
    viteSingleFile(),                      // <- inlines JS, CSS, assets
  ],
  build: {
    cssCodeSplit: false,                   // inline all CSS
    assetsInlineLimit: 100000000,          // force inline assets
    rollupOptions: {
      // keep everything in one chunk
      output: { manualChunks: undefined },
      // ensure dynamic imports are also inlined
      inlineDynamicImports: true as any,
    },
  },
});
