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
// as split chunks — kicked off from the warmupOk effect below (not on first
// render) to download in parallel with the multi-second texture preload instead
// of after it. Memoized starters instead of module-scope import(): a bare
// import() here fired ~140KB gz of hero-only chunks on EVERY route, so a
// deep-linked /gallery or /create paid for three.js while its own assets
// loaded — the exact contention warmupOk exists to prevent for textures.
import { generateSteps, subsampleSteps } from "./eye-ballz-viewer/steps.js";
let eyeBallzImportP = null;
const startEyeBallzImport = () => {
  if (!eyeBallzImportP) eyeBallzImportP = import("./eye-ballz-viewer");
  return eyeBallzImportP;
};
const EyeBallzViewer = lazy(() =>
  startEyeBallzImport().then((m) => ({ default: m.EyeBallzViewer })),
);
let asciiGalleryImportP = null;
const startAsciiGalleryImport = () => {
  if (!asciiGalleryImportP)
    asciiGalleryImportP = import("./components/AsciiGallery");
  return asciiGalleryImportP;
};
const AsciiGallery = lazy(() =>
  startAsciiGalleryImport().then((m) => ({ default: m.AsciiGallery })),
);
import { photos } from "./photos";
import { Nav } from "./components/Nav";
import { BrandLogo } from "./components/BrandLogo";
import { UploadsToggle } from "./components/UploadsToggle";
import { IntroOverlay } from "./components/IntroOverlay";
import { AboutOverlay } from "./components/AboutOverlay";
import FigureDialog from "./components/FigureDialog";
import { IntroSkipPrompt } from "./components/IntroSkipPrompt";
import { getRandomFigures } from "./lib/api";
import { preloadImage, runPool } from "./lib/preload";
import { getIntroSkipPref } from "./lib/introPref.js";
import {
  isCoarsePointer,
  prefersReducedMotion,
  queryNumber,
  queryParam,
} from "./lib/utils.js";

// Map photos.js entries into the viewer's photo-config shape (same as the bundled
// demo). No thumbnail: it only fed the debug panel's photo switcher, and the
// public/photos copy no longer ships.
const photoConfigs = Object.entries(photos).map(([key, p]) => ({
  key,
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
//
// `url` points at the prebuilt wall thumb (scripts/generate-wall-thumbs.mjs);
// `fullUrl` is the full figure, fetched only on desktop hover and in the dialog.
const STATIC_POOL = FIGURES.map((name) => ({
  key: `static:${name}`,
  name,
  author: "Christian Bianchi",
  url: `/data/thumbs/${name}.json`,
  fullUrl: `/data/${name}.json`,
}));

// How many random approved community figures to pull into each roll. Sized to
// fill the widest wall (desktop 7×7 = 49 planes) so that, once enough hero
// figures exist, the wall can give every plane a distinct one and drop the
// static seeds entirely (see AsciiGallery's assignments). Capped server-side at
// 64 (functions/api/figures/random.js).
const COMMUNITY_COUNT = 49;

// Dev/preview knob: `?grid=5` renders the avatar on a 5×5 sub-sample of the rendered
// 10×10 grid (coarser head tracking, ~¼ the frames), `?grid=5x3` for a rectangle.
// Absent/invalid → null → the full source grid (production behavior, unchanged).
const PREVIEW_GRID = (() => {
  const raw = queryParam("grid");
  if (!raw) return null;
  const [x, y = x] = raw.split("x").map((n) => parseInt(n, 10));
  return Number.isInteger(x) && x > 0 && Number.isInteger(y) && y > 0
    ? { x, y }
    : null;
})();

// Dev/preview knob: `?slowload=300` pads each preload task by ~300ms so the
// corner progress readout is watchable on localhost (cached loads finish in
// under a second otherwise — same spirit as `?grid=`). Absent/invalid → 0
// (production behavior, unchanged).
const SLOW_LOAD_MS = queryNumber("slowload", { min: 0, max: 2000, fallback: 0 });

// Reduced motion: skip the cinematic intro entirely — a plain black cover fades
// out once the scene is warm. Evaluated once; mid-session OS toggles are rare
// and a reload picks the change up.
const REDUCED_MOTION = prefersReducedMotion();

// Corner-slot loading readout: `[####______]  42%` — ten slots. floor, not
// round: the bar only fills at a true 100, which never renders (the corner
// swaps to the skip pill at warm). padStart keeps the mono line width stable
// (paired with white-space: pre on .intro-progress).
const BAR_SLOTS = 10;
const asciiBar = (pct) => {
  const filled = Math.floor((pct / 100) * BAR_SLOTS);
  const bar = "#".repeat(filled) + "_".repeat(BAR_SLOTS - filled);
  return `[${bar}] ${String(pct).padStart(3, " ")}%`;
};

// Code-side toggle: play the face's scripted look-around gesture while the
// containers fly through the intro tunnel. Off for now — the circular gaze was
// choreographed for the old orbit roam; flip to true to bring it back.
const INTRO_LOOK_AROUND = false;

// `suspended` (from HeroLayout): a routed page (/create, /gallery) covers the
// hero. The layer above is already visibility:hidden + inert; this prop pauses
// everything that would still run underneath — render loops, blinking, the
// intro, and the ui-chrome's window-level wheel/touch listeners.
export default function App({ suspended = false }) {
  // Staged reveal so the hero's GPU warm-up (shader compile + texture uploads) happens
  // behind the intro: preload HTTP assets -> mount scene hidden -> wait until the
  // avatar reports GPU-warm -> reveal. Avoids post-reveal jank on the focal point.
  const [preloaded, setPreloaded] = useState(false);
  const [avatarReady, setAvatarReady] = useState(false);
  const [timedOut, setTimedOut] = useState(false);
  const [figures, setFigures] = useState(null);
  // Figure tapped on the wall → info dialog (name, author, downloads).
  const [dialogFigure, setDialogFigure] = useState(null);
  // Hide the eyeballz avatar so the ASCII wall is unobstructed. The corner-pill
  // toggle moved out of the hero (destined for a future settings section), so
  // this is pinned to false for now — the plumbing below (intro skip, preload
  // short-circuit, conditional mount) stays wired for when the control returns.
  const [avatarHidden] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  // True while the About overlay is fully settled open (opaque over the hero).
  // Reported by the overlay's dissolve settle; used to freeze the hero's
  // render loops while nothing of it is visible. `aboutOpen && aboutSettled`
  // (not settled alone) so a button/Escape close — which flips aboutOpen
  // before the close dissolve — resumes the hero the moment it starts to show.
  const [aboutSettled, setAboutSettled] = useState(false);
  // Freeze signal for the hero renderers only (wall + face). App's own
  // `suspended` consumers (intro, preload, chrome listeners) stay keyed to
  // the route cover alone.
  const heroFrozen = suspended || (aboutOpen && aboutSettled);
  // Section the About overlay should scroll to once open (set by the header shortcuts).
  const [aboutTarget, setAboutTarget] = useState(null);
  // Reveal as soon as the hero avatar is warm — it's the focal point. The floating
  // ASCII wall is ambient background, so it no longer holds the overlay hostage to its
  // ~3.3MB of figure JSON; it fades itself in a beat later behind the hero.
  // A hidden avatar can never report ready, so it must not hold the reveal either.
  const warm = avatarReady || timedOut || avatarHidden;

  // Cinematic intro state machine. Phases: swarm forms the headline ("forming",
  // doubling as the loading screen) -> face fades in behind it ("face") -> swarm
  // scatters ("disperse") -> gallery planes roam then settle ("roam") -> "done".
  // Reduced motion starts at "done" (plain cover fade instead) — and so do
  // returning visitors who opted out via the post-skip prompt. The pref is read
  // once per mount (lazy initializer, not module scope, so dev HMR remounts
  // pick up a cleared pref without a reload).
  const [introPrefSkip] = useState(getIntroSkipPref);
  const startedDone = REDUCED_MOTION || introPrefSkip;
  const [introPhase, setIntroPhase] = useState(
    startedDone ? "done" : "forming",
  );
  const [textFormed, setTextFormed] = useState(false);
  // No-cinematic cover (reduced motion + persisted skip pref): unmounted after
  // its fade-out transition ends.
  const [coverGone, setCoverGone] = useState(!startedDone);
  const introDone = introPhase === "done";
  // Corner progress readout: 0–90 = stage A (HTTP preload, counted per file);
  // 90–99 = timed creep while the viewer re-decodes + GPU-uploads (stage B,
  // deliberately uninstrumented). The corner swaps to the skip pill at `warm`.
  const [loadPct, setLoadPct] = useState(0);
  // Post-skip preference prompt. Opened ONLY by an explicit skip click — the
  // suspend-forces-done effect below calls setIntroPhase directly so leaving
  // mid-intro never asks.
  const [skipPromptOpen, setSkipPromptOpen] = useState(false);
  // Stable identity: the prompt keys its auto-dismiss countdown on this.
  const closeSkipPrompt = useCallback(() => setSkipPromptOpen(false), []);
  const skipIntro = () => {
    setIntroPhase("done");
    setSkipPromptOpen(true);
  };

  // Leaving mid-intro = skipping. Once the intro has actually been on screen
  // (first unsuspended render), navigating away jumps it to "done" so a
  // half-formed swarm is never resumed on return. Direct setIntroPhase, NOT
  // skipIntro — this path must never open the preference prompt.
  const introStartedRef = useRef(false);
  useEffect(() => {
    if (!suspended) {
      introStartedRef.current = true;
    } else if (introStartedRef.current && !introDone) {
      setIntroPhase("done");
    }
  }, [suspended, introDone]);

  // Deep-link warm-up: when the session starts on /create or /gallery, hold the
  // ~200-frame avatar preload until that page has settled (load + idle) so it
  // never competes with the page's own assets. Any unsuspend wins immediately —
  // the user is heading home and the preload gates the scene mount.
  const [warmupOk, setWarmupOk] = useState(!suspended);
  useEffect(() => {
    if (warmupOk) return;
    if (!suspended) {
      setWarmupOk(true);
      return;
    }
    let idleId = 0;
    let timerId = 0;
    const arm = () => {
      if (typeof window.requestIdleCallback === "function") {
        idleId = window.requestIdleCallback(() => setWarmupOk(true), {
          timeout: 4000,
        });
      } else {
        // Safari: no requestIdleCallback — a flat delay after load is close enough.
        timerId = window.setTimeout(() => setWarmupOk(true), 3000);
      }
    };
    if (document.readyState === "complete") {
      arm();
    } else {
      window.addEventListener("load", arm, { once: true });
    }
    return () => {
      window.removeEventListener("load", arm);
      if (idleId) window.cancelIdleCallback?.(idleId);
      if (timerId) window.clearTimeout(timerId);
    };
  }, [suspended, warmupOk]);

  // Hero chunk kickoff rides the same deferral as the texture preload: on "/"
  // warmupOk is true from the first render, so the viewer + wall chunks start
  // downloading immediately (parallel with the preload, as before); on a deep
  // link they wait for the routed page to settle. The lazy() factories call
  // the same starters, so a mount can never find an unstarted import.
  useEffect(() => {
    if (!warmupOk) return;
    startEyeBallzImport();
    startAsciiGalleryImport();
  }, [warmupOk]);

  // A page covering the hero closes anything that could reopen in a stale state.
  useEffect(() => {
    if (!suspended) return;
    setAboutOpen(false);
    setDialogFigure(null);
    setSkipPromptOpen(false);
  }, [suspended]);

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

  // Optional (INTRO_LOOK_AROUND): during the tunnel the face looks around — a
  // scripted sweep through every extreme gaze pose (the viewer's own gesture
  // engine), ending back at neutral. Skipping mid-sweep aborts the gesture so
  // mouse-look isn't locked for its remainder. With the toggle off the face
  // holds its neutral forward pose until the intro ends.
  useEffect(() => {
    if (!INTRO_LOOK_AROUND || introPhase !== "roam") return;
    viewerRef.current?.playGesture("lookAround");
    return () => viewerRef.current?.stopGesture();
  }, [introPhase]);

  // Reveal glitch: the face fades in under heavy shader glitch/noise/rgb-shift that
  // decays to the settings baseline over ~4s. The decay outlives the short "face"
  // phase (it keeps shimmering through disperse and into the roam), so the tween is
  // only killed on skip/unmount — and never leaves the face glitched.
  // Phones decay faster: while any distortion uniform is non-zero the avatar keeps
  // re-rendering (render + asciify) continuously, and that window overlaps the wall
  // roam — 2.5s trims the contention without losing the reveal moment.
  const distortTweenRef = useRef(null);
  useEffect(() => {
    if (introPhase === "face" && !distortTweenRef.current) {
      const proxy = { v: 1 };
      viewerRef.current?.setIntroDistortion(1);
      distortTweenRef.current = gsap.to(proxy, {
        v: 0,
        duration: isCoarsePointer() ? 2.5 : 4,
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
  // this (a future reroll control in the settings section) produces a fresh
  // random pick + plane assignment; seen figure JSONs come straight from cache.
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

  // Scroll-to-open is owned by the dissolve effect (useDissolveReveal inside
  // AboutOverlay): a downward wheel on the closed hero scrubs the overlay open.
  // The open hint itself is permanent — it rides .ui-chrome, which already mounts
  // only once the intro is over, and stays put after the overlay has been opened.

  // Safety net: never let the overlay hang if a ready signal fails to fire (e.g. an
  // asset error). Once the scene is mounted, reveal after at most 12s regardless.
  // Paused while suspended: a user parked on /gallery must not accumulate a fake
  // "warm" that would skip the face reveal when they finally come home.
  useEffect(() => {
    if (!preloaded || suspended) return;
    const t = window.setTimeout(() => setTimedOut(true), 12000);
    return () => window.clearTimeout(t);
  }, [preloaded, suspended]);

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
  // the scene mount. `warmupOk` defers this on deep-linked page loads.
  useEffect(() => {
    if (!warmupOk) return;
    let cancelled = false;
    let done = 0;
    // Only read inside onEach, which can't fire when the list is empty (the
    // avatarHidden case — warm is true from boot there, so the corner readout
    // never mounts either).
    const total = preloadUrls.length;
    const tasks = preloadUrls.map((u) => () => {
      const p = preloadImage(u);
      // ?slowload dev knob: stretch stage A so the readout is observable.
      return SLOW_LOAD_MS
        ? p.then(() => new Promise((r) => setTimeout(r, SLOW_LOAD_MS)))
        : p;
    });
    // 24-wide: Cloudflare serves HTTP/2+ over one multiplexed connection, so a
    // wider pool just keeps the pipe full across ~200 small files.
    runPool(tasks, 24, () => {
      // StrictMode dev double-mount: the torn-down twin's pool keeps resolving
      // (promises don't cancel) — the guard stops it bumping the live counter.
      if (cancelled) return;
      done += 1;
      // Stage A owns 0–90. Math.max keeps the readout monotonic; rounding to
      // whole percents collapses ~200 calls into ≤91 distinct values, and
      // React bails on same-value setState — no throttle needed (the heavy
      // scene subtree isn't even mounted until `preloaded`).
      setLoadPct((p) => Math.max(p, Math.round((done / total) * 90)));
    }).then(() => {
      if (!cancelled) setPreloaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, [preloadUrls, warmupOk]);

  // Stage B tail: between "assets in HTTP cache" (preloaded) and "avatar warm"
  // the viewer re-reads the same URLs into three.js textures and uploads them —
  // seconds on phones, deliberately uninstrumented. Creep the readout 90 -> 99
  // so the bar keeps moving, park at 99 until `warm` swaps the corner over.
  useEffect(() => {
    if (!preloaded || warm) return;
    const id = window.setInterval(
      () => setLoadPct((p) => Math.min(99, Math.max(p, 90) + 1)),
      350,
    );
    return () => window.clearInterval(id);
  }, [preloaded, warm]);

  return (
    <>
      {/* Phases 1–3: swarm forms the headline, holds while the face fades in, then
          scatters. Unmounts for good once the roam starts (or on skip). Suspension
          holds it back entirely: a deep-linked session must not run (or finish) the
          swarm behind the covering page — it starts on the first visit home. */}
      {!suspended &&
        (introPhase === "forming" ||
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
      {/* Corner slot, one occupant at a time: ascii progress while the hero
          loads -> skip pill once warm (the swap IS the ready signal) -> the
          skip-preference prompt after an explicit skip. The progress line also
          serves the cover path (reduced motion / persisted pref): z-11 paints
          above the z-10 cover, so those starts aren't a mute black screen. On
          touch the prompt un-docks from the corner (see global.css) — the
          bottom-right anchor belongs to the About hint there. */}
      {!suspended && !warm && (
        <div
          className="intro-progress"
          role="progressbar"
          aria-label="loading"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={loadPct}
        >
          <span aria-hidden="true">{asciiBar(loadPct)}</span>
        </div>
      )}
      {warm && !introDone && !suspended && (
        <button
          type="button"
          className="corner-pill intro-skip"
          onClick={skipIntro}
        >
          skip intro
        </button>
      )}
      {/* No introDone term here: the skip click that opens the prompt also
          flips introDone — gating on it would unmount the prompt instantly. */}
      {skipPromptOpen && !suspended && (
        <IntroSkipPrompt onClose={closeSkipPrompt} />
      )}
      {/* No-cinematic starts (reduced motion OR persisted skip pref): a plain
          cover that fades once warm. coverGone initializes true for everyone
          else, so this never renders on cinematic boots. */}
      {!coverGone && (
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
              // Also frozen while the About overlay fully covers the hero —
              // stops the compositor AND all wall players' rAF loops.
              suspended={heroFrozen}
              // The live phase flows through (forming/face/disperse/roam/done)
              // so the wall can time its own work: figure fetches/parses hold
              // during "forming" (the main thread belongs to the swarm) and
              // flush in the face/disperse gap before the tunnel.
              introState={introPhase}
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
                // Covered by a page OR the settled About overlay: stop
                // blinking (the existing autoBlink effect tears the timer
                // down and reopens the eyes) and pause the render loop +
                // cursor tracking via `suspended`.
                autoBlink={!heroFrozen}
                suspended={heroFrozen}
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
      {/* UI chrome appears only once the intro is over, with a soft fade-in.
          Unmounted while a page covers the hero: AboutOverlay's dissolve hook
          binds wheel/touch to window with preventDefault, and those listeners
          must never react to (or block) scrolling on the page above. */}
      {preloaded && introDone && !suspended && (
        <>
          <div className="ui-chrome">
            <Nav
              onNavigate={(id) => {
                setAboutTarget(id);
                setAboutOpen(true);
              }}
            />
            <div className="about-trigger-group">
              {/* Scroll hint doubling as the overlay's open button. */}
              <button
                type="button"
                className="about-trigger"
                onClick={() => setAboutOpen(true)}
              >
                {isCoarsePointer() ? "swipe" : "scroll"}
              </button>
              <span className="about-trigger-line" aria-hidden="true" />
            </div>
            {/* Renders nothing unless the admin secret in localStorage checks
                out against the API — visitors never see it. */}
            <UploadsToggle />
          </div>
          {/* Brand mark, centered in the appbar but a SIBLING of .ui-chrome:
              the chrome's fill-mode opacity animation makes it a permanent
              stacking context, which would trap the logo's z-25 below the
              About overlay (z-20). Out here the logo really paints above the
              overlay, and clicking it closes it — on the bare hero it's a
              no-op. It carries its own ui-chrome-in fade to enter in sync.
              On hover the two quadrant glyphs part and the revealed text
              cycles through phrases with a scramble swap (BrandLogo.jsx; the
              split-reveal itself is CSS, see .brand-logo in global.css). */}
          <BrandLogo onClick={() => setAboutOpen(false)} />
          <AboutOverlay
            open={aboutOpen}
            onOpenChange={setAboutOpen}
            onSettledChange={setAboutSettled}
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
