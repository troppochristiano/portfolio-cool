import { StrictMode, Suspense, lazy } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import App from "./App";
import Create from "./pages/Create";
import "./styles/global.css";

// Lazy chunks: neither route belongs in the hero bundle — the gallery is a
// separate page and the admin queue is only ever visited by the site owner.
const Gallery = lazy(() => import("./pages/Gallery"));
const Admin = lazy(() => import("./pages/Admin"));

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        {/* Home — the hero + ambient gallery + About overlay, unchanged. */}
        <Route path="/" element={<App />} />
        {/* The merged ASCII media converter. */}
        <Route path="/create" element={<Create />} />
        {/* Community uploads (approved) — infinite scroll grid. */}
        <Route
          path="/gallery"
          element={
            <Suspense fallback={null}>
              <Gallery />
            </Suspense>
          }
        />
        {/* Unlinked moderation queue (server-side bearer auth). */}
        <Route
          path="/admin"
          element={
            <Suspense fallback={null}>
              <Admin />
            </Suspense>
          }
        />
      </Routes>
    </BrowserRouter>
  </StrictMode>
);
