import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The eye-ballz-viewer folder ships plain .jsx source; allow Vite to serve it
// alongside the app code. Large pre-rendered frame grids live in
// public/ and are served as static assets.
export default defineConfig({
  plugins: [react()],
  server: {
    open: true,
    host: true,
    // The figures API is a Cloudflare Pages Function. During dev it runs in
    // `npx wrangler pages dev --port 8788` (or `npm run dev:full`, which
    // wraps both); plain `vite` proxies /api there so the upload/gallery/hero
    // features work with HMR. Without wrangler running, /api just fails and
    // the hero falls back to the static figures.
    proxy: { "/api": "http://localhost:8788" },
  },
});
