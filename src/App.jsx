import { useEffect, useMemo, useState } from "react";
import { EyeBallzViewer, generateSteps } from "./eye-ballz-viewer";
import { photos } from "./photos";
import { Nav } from "./components/Nav";
import { AsciiGallery } from "./components/AsciiGallery";
import { Loader } from "./components/Loader";

// Map photos.js entries into the viewer's photo-config shape (same as the bundled demo),
// pointing thumbnails at the public/photos copy.
const photoConfigs = Object.entries(photos).map(([key, p]) => ({
  key,
  thumbnail: `/${p.filename}`,
  prefix: p.PREFIX,
  xSteps: p.X_STEPS,
  ySteps: p.Y_STEPS,
  expressions: p.expressions,
  topRowsOnly: p.topRowsOnly,
}));

// Resolve each frame's color + depth URL against the public/outputs grid. Absolute
// paths keep it route-independent (the bundled default uses "./outputs/...").
const urlFor = (prefix, step, exprFolder) => ({
  photo: exprFolder
    ? `/outputs/${prefix}/expressions/${exprFolder}/${step.filename}`
    : `/outputs/${prefix}/${step.filename}`,
  depth: `/outputs/${prefix}/depth/${step.filename}.depth.png`,
});

// The ASCII figures in public/data — one floating player per clip across the wall.
const FIGURES = [
  "4x3",
  "4x3Big",
  "4x3Full",
  "3x9l0s10n",
  "Gun",
  "GunInverted",
  "GunLight",
  "V4n7am",
  "V4nD0wn",
];

export default function App() {
  // Staged reveal so all GPU warm-up (shader compile + texture uploads) happens behind
  // the overlay: preload HTTP assets -> mount scene under overlay -> wait until both the
  // avatar and the gallery report GPU-warm -> fade the overlay. Avoids post-reveal jank.
  const [preloaded, setPreloaded] = useState(false);
  const [avatarReady, setAvatarReady] = useState(false);
  const [galleryReady, setGalleryReady] = useState(false);
  const [timedOut, setTimedOut] = useState(false);
  const [figures, setFigures] = useState(null);
  const warm = (avatarReady && galleryReady) || timedOut;

  // Fetch + parse the ASCII figures once on mount. They download behind the loader
  // overlay (which shows "Preparing…" after the avatar grids finish); the gallery
  // mounts and reports ready once they resolve.
  useEffect(() => {
    let alive = true;
    // allSettled (not all): a single missing/bad file is skipped instead of taking down
    // the whole wall. Check res.ok first so a 404's HTML body doesn't throw a confusing
    // JSON parse error.
    Promise.allSettled(
      FIGURES.map(async (name) => {
        const res = await fetch(`/data/${name}.json`);
        if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`);
        return { name, data: await res.json() };
      }),
    ).then((results) => {
      if (!alive) return;
      // Keep only the figures that loaded (empty is fine — the 12s timeout reveals).
      setFigures(
        results.filter((r) => r.status === "fulfilled").map((r) => r.value),
      );
    });
    return () => {
      alive = false;
    };
  }, []);

  // Safety net: never let the overlay hang if a ready signal fails to fire (e.g. an
  // asset error). Once the scene is mounted, reveal after at most 12s regardless.
  useEffect(() => {
    if (!preloaded) return;
    const t = window.setTimeout(() => setTimedOut(true), 12000);
    return () => window.clearTimeout(t);
  }, [preloaded]);

  // Critical avatar assets to warm before reveal: the base (neutral) color grid plus
  // the shared depth maps. The non-critical blink grid keeps loading behind the scene.
  const imageUrls = useMemo(() => {
    const urls = [];
    for (const p of photoConfigs) {
      const { steps } = generateSteps({
        X_STEPS: p.xSteps,
        Y_STEPS: p.ySteps,
        PREFIX: p.prefix,
      });
      const neutral = p.expressions?.neutral;
      for (const step of steps.flat()) {
        const { photo, depth } = urlFor(p.prefix, step, neutral);
        urls.push(photo, depth);
      }
    }
    return urls;
  }, []);

  return (
    <>
      <Loader
        imageUrls={imageUrls}
        onPreloaded={() => setPreloaded(true)}
        done={warm}
      />
      {preloaded && (
        <>
          <Nav />
          {figures && figures.length > 0 && (
            <AsciiGallery
              figures={figures}
              onReady={() => setGalleryReady(true)}
            />
          )}
          <div className="hero-avatar">
            <EyeBallzViewer
              photos={photoConfigs}
              urlFor={urlFor}
              status="neutral"
              autoBlink
              transparent
              debug={false}
              // Show the forehead "rub to smile" trigger box for calibration. Set to false
              // once the FOREHEAD_* constants in EyeBallzViewer.jsx feel right.
              // debugForehead={true}
              onSettingsChange={() => {}}
              onReady={() => setAvatarReady(true)}
            />
          </div>
        </>
      )}
    </>
  );
}
