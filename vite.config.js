import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The eye-ballz-viewer folder ships plain .jsx source; allow Vite to serve it
// alongside the app code. Large pre-rendered frame grids live in
// public/ and are served as static assets.
export default defineConfig({
  plugins: [react()],
  server: { open: true, host: true },
});
