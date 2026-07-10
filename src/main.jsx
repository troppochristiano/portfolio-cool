import { StrictMode, Suspense, lazy } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import HeroLayout from "./components/HeroLayout.jsx";
import Create from "./pages/Create";
import "./styles/global.css";
// Side effect: registers the block-reveal leave/enter tweens into the
// pageTransitions seam that RouteTransition drives.
import "./lib/blockRevealTransition.js";

// Lazy chunks: neither route belongs in the hero bundle — the gallery is a
// separate page and the admin queue is only ever visited by the site owner.
const Gallery = lazy(() => import("./pages/Gallery"));
const Admin = lazy(() => import("./pages/Admin"));
const AdminCreate = lazy(() => import("./pages/AdminCreate"));

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        {/* Hero layout: App (face + wall + intro) stays mounted underneath
            /create and /gallery so returning home is instant with no intro
            replay. The index route renders nothing — the hero IS the page. */}
        <Route element={<HeroLayout />}>
          <Route index element={null} />
          {/* The merged ASCII media converter. */}
          <Route path="create" element={<Create />} />
          {/* Community uploads (approved) — infinite scroll grid. */}
          <Route
            path="gallery"
            element={
              <Suspense fallback={null}>
                <Gallery />
              </Suspense>
            }
          />
        </Route>
        {/* Admin lives OUTSIDE the hero layout: owner-only, so no reason to
            keep a WebGL context + ~200 textures alive under it. Trade-off:
            admin -> "/" remounts the hero and replays the intro. */}
        <Route
          path="/admin"
          element={
            <Suspense fallback={null}>
              <Admin />
            </Suspense>
          }
        />
        {/* The same converter as /create, unlocked with the admin secret —
            uploads skip Turnstile and the daily limit. */}
        <Route
          path="/admin/create"
          element={
            <Suspense fallback={null}>
              <AdminCreate />
            </Suspense>
          }
        />
      </Routes>
    </BrowserRouter>
  </StrictMode>
);
