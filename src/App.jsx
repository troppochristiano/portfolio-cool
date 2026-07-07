import { useEffect, useMemo, useState } from "react";
import {
  EyeBallzViewer,
  generateSteps,
  subsampleSteps,
} from "./eye-ballz-viewer";
import { photos } from "./photos";
import { Nav } from "./components/Nav";
import { AsciiGallery } from "./components/AsciiGallery";
import { Loader } from "./components/Loader";
import { AboutOverlay } from "./components/AboutOverlay";

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
// Only the clips that actually ship in public/data are listed; stale names just 404
// on every load and waste a round-trip that competes with the avatar preload.
const FIGURES = ["4x3Big", "3x9l0s10n", "GunInverted", "V4n7am", "s09r4n0"];

// Dev/preview knob: `?grid=5` renders the avatar on a 5×5 sub-sample of the rendered
// 10×10 grid (coarser head tracking, ~¼ the frames), `?grid=5x3` for a rectangle.
// Absent/invalid → null → the full source grid (production behavior, unchanged).
const PREVIEW_GRID = (() => {
  if (typeof window === "undefined") return null;
  const raw = new URLSearchParams(window.location.search).get("grid");
  if (!raw) return null;
  const [x, y = x] = raw.split("x").map((n) => parseInt(n, 10));
  return Number.isInteger(x) && x > 0 && Number.isInteger(y) && y > 0
    ? { x, y }
    : null;
})();

export default function App() {
  // Staged reveal so the hero's GPU warm-up (shader compile + texture uploads) happens
  // behind the overlay: preload HTTP assets -> mount scene under overlay -> wait until the
  // avatar reports GPU-warm -> fade the overlay. Avoids post-reveal jank on the focal
  // point. The ambient ASCII wall fades itself in afterward and isn't part of this gate.
  const [preloaded, setPreloaded] = useState(false);
  const [avatarReady, setAvatarReady] = useState(false);
  const [timedOut, setTimedOut] = useState(false);
  const [figures, setFigures] = useState(null);
  const [aboutOpen, setAboutOpen] = useState(false);
  // Section the About overlay should scroll to once open (set by the header shortcuts).
  const [aboutTarget, setAboutTarget] = useState(null);
  // Show the "scroll to open" hint only where wheel-to-open is active (fine pointer) and
  // only until the overlay has been opened at least once.
  const [showScrollHint, setShowScrollHint] = useState(false);
  // Reveal as soon as the hero avatar is warm — it's the focal point. The floating
  // ASCII wall is ambient background, so it no longer holds the overlay hostage to its
  // ~3.3MB of figure JSON; it fades itself in a beat later behind the hero.
  const warm = avatarReady || timedOut;

  // Fetch + parse the ASCII figures once on mount. They download in the background and
  // the wall mounts + fades itself in once they resolve — independent of the hero reveal,
  // so this ~3.3MB never sits on the "Preparing…" critical path.
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

  // Scroll-to-open is now owned by the dissolve effect (useDissolveReveal inside
  // AboutOverlay): a downward wheel on the closed hero scrubs the overlay open. The old
  // one-shot deltaY>24 listener lived here; it's gone so the two don't fight.

  // Reveal the "^" open hint once the scene is up (both pointer types — it signals the
  // scroll/swipe-up-to-open gesture); hide it for good the first time the overlay opens.
  useEffect(() => {
    if (!preloaded) return;
    setShowScrollHint(true);
  }, [preloaded]);

  useEffect(() => {
    if (aboutOpen) setShowScrollHint(false);
  }, [aboutOpen]);

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
      const source = generateSteps({
        X_STEPS: p.xSteps,
        Y_STEPS: p.ySteps,
        PREFIX: p.prefix,
      });
      // Warm only the frames the active grid size needs (mirrors the viewer's sub-sample),
      // so the loader bar stays honest at smaller preview grids.
      const { steps } = PREVIEW_GRID
        ? subsampleSteps(source, PREVIEW_GRID.x, PREVIEW_GRID.y)
        : source;
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
          <Nav
            onHome={() => setAboutOpen(false)}
            onNavigate={(id) => {
              setAboutTarget(id);
              setAboutOpen(true);
            }}
          />
          {figures && figures.length > 0 && (
            // The wall fades itself in once its first CSS3D render lands; it no longer
            // gates the reveal, so no onReady wiring is needed here.
            <AsciiGallery figures={figures} />
          )}
          <div className="hero-avatar">
            <EyeBallzViewer
              photos={photoConfigs}
              urlFor={urlFor}
              status="neutral"
              autoBlink
              transparent
              previewGrid={PREVIEW_GRID}
              // debug={true}
              // Show the forehead "rub to smile" trigger box for calibration. Set to false
              // once the FOREHEAD_* constants in EyeBallzViewer.jsx feel right.
              // debugForehead={true}
              onSettingsChange={() => {}}
              onReady={() => setAvatarReady(true)}
            />
          </div>
          <div className="about-trigger-group">
            {showScrollHint && (
              <span className="about-trigger-caret" aria-hidden="true">
                ^
              </span>
            )}
            <button
              type="button"
              className="about-trigger"
              onClick={() => setAboutOpen(true)}
            >
              About
            </button>
          </div>
          <AboutOverlay
            open={aboutOpen}
            onOpenChange={setAboutOpen}
            ready={warm}
            scrollTarget={aboutTarget}
            onScrolled={() => setAboutTarget(null)}
          />
        </>
      )}
    </>
  );
}
