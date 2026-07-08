import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import gsap from "gsap";
// Steps stay a static import (pure math, no three.js) so the preload URL list
// builds immediately. The viewer and wall pull in all of three.js, so they load
// as split chunks — kicked off eagerly here (not on first render) to download in
// parallel with the multi-second texture preload instead of after it.
import { generateSteps, subsampleSteps } from "./eye-ballz-viewer/steps.js";
const eyeBallzImport = import("./eye-ballz-viewer");
const EyeBallzViewer = lazy(() =>
  eyeBallzImport.then((m) => ({ default: m.EyeBallzViewer })),
);
const asciiGalleryImport = import("./components/AsciiGallery");
const AsciiGallery = lazy(() =>
  asciiGalleryImport.then((m) => ({ default: m.AsciiGallery })),
);
import { photos } from "./photos";
import { Nav } from "./components/Nav";
import { IntroOverlay } from "./components/IntroOverlay";
import { AboutOverlay } from "./components/AboutOverlay";
import FigureDialog from "./components/FigureDialog";
import { getRandomFigures } from "./lib/api";
import { preloadImage, runPool } from "./lib/preload";

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
  depth: `/outputs/${prefix}/depth/${step.filename}.depth.webp`,
});

// The ASCII figures in public/data — one floating player per clip across the wall.
// Only the clips that actually ship in public/data are listed; stale names just 404
// on every load and waste a round-trip that competes with the avatar preload.
const FIGURES = ["4x3Big", "3x9l0s10n", "GunInverted", "V4n7am", "s09r4n0"];

// Descriptor pool seeds: the wall now receives lightweight descriptors (name +
// URL + metadata) and each plane fetches its own JSON lazily. The static clips
// always work — even with the backend down — and community uploads are blended
// in on top when the API answers.
const STATIC_POOL = FIGURES.map((name) => ({
  key: `static:${name}`,
  name,
  author: "Christian Bianchi",
  url: `/data/${name}.json`,
}));

// How many random approved community figures to mix into each roll.
const COMMUNITY_COUNT = 12;

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

// Reduced motion: skip the cinematic intro entirely — a plain black cover fades
// out once the scene is warm. Evaluated once; mid-session OS toggles are rare
// and a reload picks the change up.
const REDUCED_MOTION =
  typeof window !== "undefined" &&
  window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

export default function App() {
  // Staged reveal so the hero's GPU warm-up (shader compile + texture uploads) happens
  // behind the intro: preload HTTP assets -> mount scene hidden -> wait until the
  // avatar reports GPU-warm -> reveal. Avoids post-reveal jank on the focal point.
  const [preloaded, setPreloaded] = useState(false);
  const [avatarReady, setAvatarReady] = useState(false);
  const [timedOut, setTimedOut] = useState(false);
  const [figures, setFigures] = useState(null);
  // Figure tapped on the wall → info dialog (name, author, downloads).
  const [dialogFigure, setDialogFigure] = useState(null);
  // User toggle: hide the eyeballz avatar so the ASCII wall is unobstructed.
  // Persisted so the choice survives reloads.
  const [avatarHidden, setAvatarHidden] = useState(
    () => localStorage.getItem("avatarHidden") === "1",
  );
  const toggleAvatar = () => {
    setAvatarHidden((h) => {
      localStorage.setItem("avatarHidden", h ? "0" : "1");
      return !h;
    });
  };
  const [aboutOpen, setAboutOpen] = useState(false);
  // Section the About overlay should scroll to once open (set by the header shortcuts).
  const [aboutTarget, setAboutTarget] = useState(null);
  // Show the "scroll to open" hint only where wheel-to-open is active (fine pointer) and
  // only until the overlay has been opened at least once.
  const [showScrollHint, setShowScrollHint] = useState(false);
  // Reveal as soon as the hero avatar is warm — it's the focal point. The floating
  // ASCII wall is ambient background, so it no longer holds the overlay hostage to its
  // ~3.3MB of figure JSON; it fades itself in a beat later behind the hero.
  // A hidden avatar can never report ready, so it must not hold the reveal either.
  const warm = avatarReady || timedOut || avatarHidden;

  // Cinematic intro state machine. Phases: swarm forms the headline ("forming",
  // doubling as the loading screen) -> face fades in behind it ("face") -> swarm
  // scatters ("disperse") -> gallery planes roam then settle ("roam") -> "done".
  // Reduced motion starts at "done" (plain cover fade instead).
  const [introPhase, setIntroPhase] = useState(
    REDUCED_MOTION ? "done" : "forming",
  );
  const [textFormed, setTextFormed] = useState(false);
  // Reduced-motion cover: unmounted after its fade-out transition ends.
  const [coverGone, setCoverGone] = useState(!REDUCED_MOTION);
  const introDone = introPhase === "done";
  const skipIntro = () => setIntroPhase("done");

  // forming -> face once the headline is assembled AND the avatar is warm; with the
  // avatar hidden there is no face phase — go straight to the scatter.
  useEffect(() => {
    if (introPhase !== "forming" || !textFormed) return;
    if (avatarHidden) {
      if (preloaded) setIntroPhase("disperse");
    } else if (warm) {
      setIntroPhase("face");
    }
  }, [introPhase, textFormed, warm, avatarHidden, preloaded]);

  // face -> disperse once the avatar's 1s opacity fade has landed (plus a beat).
  useEffect(() => {
    if (introPhase !== "face") return;
    const t = window.setTimeout(() => setIntroPhase("disperse"), 1400);
    return () => window.clearTimeout(t);
  }, [introPhase]);

  // Imperative handle into the eyeballz viewer — the intro drives its look-around
  // gesture and reveal distortion through the viewer's ref API. Neutral pose + mouse
  // lockout come from the `animationMode` prop instead (see the viewer element below):
  // while it's on, the face rests forward-facing and ignores the cursor entirely;
  // flipping it off arms the viewer's eased return to mouse tracking.
  const viewerRef = useRef(null);

  // During the roam the face looks around — a scripted sweep through every extreme
  // gaze pose (the viewer's own gesture engine), ending back at neutral. Skipping
  // mid-sweep aborts the gesture so mouse-look isn't locked for its remainder.
  useEffect(() => {
    if (introPhase !== "roam") return;
    viewerRef.current?.playGesture("lookAround");
    return () => viewerRef.current?.stopGesture();
  }, [introPhase]);

  // Reveal glitch: the face fades in under heavy shader glitch/noise/rgb-shift that
  // decays to the settings baseline over ~4s. The decay outlives the short "face"
  // phase (it keeps shimmering through disperse and into the roam), so the tween is
  // only killed on skip/unmount — and never leaves the face glitched.
  const distortTweenRef = useRef(null);
  useEffect(() => {
    if (introPhase === "face" && !distortTweenRef.current) {
      const proxy = { v: 1 };
      viewerRef.current?.setIntroDistortion(1);
      distortTweenRef.current = gsap.to(proxy, {
        v: 0,
        duration: 4,
        ease: "power2.out",
        onUpdate: () => viewerRef.current?.setIntroDistortion(proxy.v),
      });
    }
    if (introDone && distortTweenRef.current) {
      distortTweenRef.current.kill();
      distortTweenRef.current = null;
      viewerRef.current?.setIntroDistortion(0);
    }
  }, [introPhase, introDone]);
  useEffect(() => () => distortTweenRef.current?.kill(), []);

  // Build the wall's descriptor pool: the static clips are known synchronously,
  // and a tiny metadata call (~2KB — no frame data) blends in random approved
  // community figures. Each plane then fetches its own JSON lazily inside the
  // wall, so nothing heavy ever sits on the reveal's critical path. Re-running
  // this (the reroll button) produces a fresh random pick + a fresh random
  // plane assignment; already-seen figure JSONs come straight from cache.
  const loadPool = useCallback(async () => {
    let community = [];
    try {
      const { figures: rows } = await getRandomFigures(COMMUNITY_COUNT);
      community = rows.map((r) => ({
        key: r.id,
        name: r.name,
        author: r.author,
        url: `/api/figures/${r.id}/data`,
        createdAt: r.createdAt,
        framesCount: r.framesCount,
      }));
    } catch {
      // Backend unreachable (dev without wrangler, outage) — static-only wall.
    }
    setFigures([...STATIC_POOL, ...community]);
  }, []);

  useEffect(() => {
    loadPool();
  }, [loadPool]);

  // Scroll-to-open is now owned by the dissolve effect (useDissolveReveal inside
  // AboutOverlay): a downward wheel on the closed hero scrubs the overlay open. The old
  // one-shot deltaY>24 listener lived here; it's gone so the two don't fight.

  // Reveal the "^" open hint once the intro is over (both pointer types — it signals
  // the scroll/swipe-up-to-open gesture); hide it for good once the overlay opens.
  useEffect(() => {
    if (!introDone) return;
    setShowScrollHint(true);
  }, [introDone]);

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

  // With the avatar hidden there's nothing to warm — an empty list makes the
  // preload instant. Memoized: a fresh [] every render would re-trigger the
  // preload effect in a loop.
  const preloadUrls = useMemo(
    () => (avatarHidden ? [] : imageUrls),
    [avatarHidden, imageUrls],
  );

  // Warm the avatar assets (formerly the Loader's job). Lives here — not in the
  // intro overlay — so skipping the intro can never cancel the preload that gates
  // the scene mount.
  useEffect(() => {
    let cancelled = false;
    const tasks = preloadUrls.map((u) => () => preloadImage(u));
    // 24-wide: Cloudflare serves HTTP/2+ over one multiplexed connection, so a
    // wider pool just keeps the pipe full across ~200 small files.
    runPool(tasks, 24).then(() => {
      if (!cancelled) setPreloaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, [preloadUrls]);

  return (
    <>
      {/* Phases 1–3: swarm forms the headline, holds while the face fades in, then
          scatters. Unmounts for good once the roam starts (or on skip). */}
      {(introPhase === "forming" ||
        introPhase === "face" ||
        introPhase === "disperse") && (
        <IntroOverlay
          phase={introPhase === "disperse" ? "disperse" : "forming"}
          onFormed={() => setTextFormed(true)}
          onDispersed={() =>
            setIntroPhase((p) => (p === "disperse" ? "roam" : p))
          }
        />
      )}
      {!introDone && (
        <button
          type="button"
          className="corner-pill intro-skip"
          onClick={skipIntro}
        >
          skip intro
        </button>
      )}
      {/* Reduced motion: no swarm/roam — a plain cover that fades once warm. */}
      {REDUCED_MOTION && !coverGone && (
        <div
          className={`intro-cover${warm ? " is-hidden" : ""}`}
          onTransitionEnd={() => setCoverGone(true)}
          aria-hidden="true"
        />
      )}
      {preloaded && (
        // Chunks were fetched in parallel with the texture preload above, so this
        // Suspense almost never actually suspends; null keeps the intro clean if it does.
        <Suspense fallback={null}>
          {figures && figures.length > 0 && (
            // The wall builds (and lazy-fetches its figures) behind the intro, then
            // roams into place when the intro reaches the "roam" phase.
            <AsciiGallery
              figures={figures}
              onSelect={setDialogFigure}
              introState={
                introDone ? "done" : introPhase === "roam" ? "roam" : "waiting"
              }
              onSettled={() =>
                setIntroPhase((p) => (p === "roam" ? "done" : p))
              }
            />
          )}
          {!avatarHidden && (
            <div
              className={`hero-avatar${
                introPhase !== "forming" ? " is-revealed" : ""
              }`}
            >
              <EyeBallzViewer
                ref={viewerRef}
                photos={photoConfigs}
                urlFor={urlFor}
                status="neutral"
                autoBlink
                transparent
                // Intro: hold the face neutral and ignore the cursor until the intro
                // is over (the lookAround gesture still plays over this). Flipping to
                // false hands control back to the mouse with an eased first move.
                animationMode={!introDone}
                previewGrid={PREVIEW_GRID}
                // debug={true}
                // Show the forehead "rub to smile" trigger box for calibration. Set to false
                // once the FOREHEAD_* constants in EyeBallzViewer.jsx feel right.
                // debugForehead={true}
                onSettingsChange={() => {}}
                onReady={() => setAvatarReady(true)}
              />
            </div>
          )}
        </Suspense>
      )}
      {/* UI chrome appears only once the intro is over, with a soft fade-in. */}
      {preloaded && introDone && (
        <>
          <div className="ui-chrome">
            <Nav
              onHome={() => setAboutOpen(false)}
              onNavigate={(id) => {
                setAboutTarget(id);
                setAboutOpen(true);
              }}
            />
            {/* Bottom-right pills: avatar visibility + wall reroll. */}
            <div className="corner-triggers">
              <button
                type="button"
                className="corner-pill"
                onClick={toggleAvatar}
                title={avatarHidden ? "show the avatar" : "hide the avatar to see the wall"}
              >
                {avatarHidden ? "☻ show face" : "☻ hide face"}
              </button>
              <button
                type="button"
                className="corner-pill"
                onClick={loadPool}
                title="load a new random set of figures"
              >
                ↻ reroll
              </button>
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
          </div>
          <AboutOverlay
            open={aboutOpen}
            onOpenChange={setAboutOpen}
            ready={warm}
            scrollTarget={aboutTarget}
            onScrolled={() => setAboutTarget(null)}
          />
          {dialogFigure && (
            <FigureDialog
              figure={dialogFigure}
              onClose={() => setDialogFigure(null)}
            />
          )}
        </>
      )}
    </>
  );
}
