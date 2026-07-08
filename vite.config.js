import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The eye-ballz-viewer folder ships plain .jsx source; allow Vite to serve it
// alongside the app code. Large pre-rendered frame grids live in
// public/ and are served as static assets.
export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        // Stable vendor chunks: three.js only loads with the lazy viewer/wall
        // chunks, and app-code changes don't bust the cached vendor bundles.
        manualChunks: {
          three: ["three"],
          vendor: ["react", "react-dom", "react-router-dom"],
          gsap: ["gsap"],
        },
      },
    },
  },
  server: {
    // Honor a tool-assigned port (e.g. preview harnesses set PORT); default unchanged.
    port: Number(process.env.PORT) || 5173,
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
