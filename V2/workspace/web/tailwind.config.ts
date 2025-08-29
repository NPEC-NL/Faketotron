import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx,css,html}"],
  theme: {
    extend: {}
  },
  plugins: []
} satisfies Config;
