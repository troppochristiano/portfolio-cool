import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import {
  Scene,
  PerspectiveCamera,
  WebGLRenderer,
  PlaneGeometry,
  MeshStandardMaterial,
  Mesh,
  AmbientLight,
  TextureLoader,
  DoubleSide,
  SRGBColorSpace,
  LinearFilter,
} from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { PhraseAsciiEffect } from "./PhraseAsciiEffect.js";
import { applyShader, createUniforms } from "./shader.js";
import { generateSteps, subsampleSteps } from "./steps.js";
import { listGestures, sampleGesture, startGesture } from "./gestures.js";
import { mergeSettings } from "./settings.js";
import { easeInOutCubic, isCoarsePointer } from "../lib/utils.js";
import {
  applyTexture,
  resolveBase,
  isBlinkVariant,
  disposeExpr,
} from "./avatarState.js";
import { useAutoBlink } from "./useAutoBlink.js";
import { useWindowChrome } from "./useWindowChrome.js";
import {
  GridPanel,
  ExpressionPanel,
  AsciiPanel,
  DistortionPanel,
  TiltPanel,
  CRTPanel,
} from "./EyeBallzDebugPanels.jsx";
import "./EyeBallzViewer.css";

const FPS = 24;

// Touch device — evaluated once. Phones get a flat 30fps cap on all active
// renders (see the render gate): the render+asciify pass is the single
// heaviest per-frame cost on mobile, and above ~30fps the ASCII grid
// quantizes the difference away anyway.
const COARSE_POINTER = isCoarsePointer();

// Device pixel ratio to render at. Cap at 2 so high-DPI displays don't rasterize 4–9× the
// pixels for no visible gain. When ASCII is on the WebGL canvas is invisible (opacity:0)
// and only sampled by AsciiEffect at its low character resolution, so 1 is plenty.
// DPR 1 when the canvas is invisible (ASCII on, no backplate). When a backplate fill is
// shown behind the glyphs, render at the capped DPR so it isn't blocky.
const pixelRatioFor = (asciiEnabled, backplate = 0) =>
  asciiEnabled && !(backplate > 0) ? 1 : Math.min(window.devicePixelRatio, 2);

// The ASCII column count is containerWidth(css) × resolution, so a smaller container (mobile)
// yields fewer columns and a coarser face at the same resolution. To keep detail roughly
// constant across screens, scale the resolution up as the container shrinks below this
// reference width (the desktop cap), never below the base value, and capped so tiny screens
// don't blow up the per-frame asciify cost. (A mobile-only density cut was tried
// and reverted — the flat 30fps render cap is what fixes phone lag; the grid
// density itself wasn't the bottleneck and the face is the site's centerpiece.)
const ASCII_REF_WIDTH = 480;
const ASCII_MAX_RESOLUTION = 0.5;
const effectiveAsciiResolution = (baseRes, containerWidth) =>
  containerWidth
    ? Math.min(
        ASCII_MAX_RESOLUTION,
        Math.max(baseRes, (baseRes * ASCII_REF_WIDTH) / containerWidth),
      )
    : baseRes;

// Displacement mesh density (segments per side). The depth maps are low-frequency:
// A/B via screenshots showed even 128 is indistinguishable from 256 through the ASCII
// output; 192 keeps headroom for the raw-canvas/backplate modes at ~44% less vertex
// work than 256. Overridable for A/B testing via ?seg=128 (same pattern as App's ?grid).
const PLANE_SEGMENTS =
  Number(new URLSearchParams(window.location.search).get("seg")) || 192;

// How long a look "sweep" takes when easing through the grid cells — used by the touch
// sweep, the animation-mode recenter, and the one-shot eased return to mouse tracking.
const LOOK_TRANSITION_MS = 300;

// "Rub the forehead to smile" easter-egg. While the pointer is held and circling over the
// forehead, the avatar smiles; it reverts shortly after the motion stops or on release.
// All tunable for feel:
const CIRCLE_WINDOW_MS = 500; // sliding window of pointer samples the circle is measured over
const CIRCLE_MIN_SAMPLES = 6; // need at least this many samples before judging a circle
const CIRCLE_MIN_RADIUS = 16; // px — mean radius must exceed this (rejects jitter / a held still finger)
const CIRCLE_TURN_THRESHOLD = Math.PI * 1.5; // total turned angle to count as circling (~¾ turn)
const SMILE_STOP_MS = 250; // revert this long after the circular motion stops
// The forehead as a box in container-normalized coords (origin = container center, y negative
// = up). The avatar is centered and the head fills the middle, so the forehead is a band just
// above center — not the very top, which is empty space above the head. Calibrated by feel.
const FOREHEAD_X_HALF = 0.4; // half-width of the brow zone
const FOREHEAD_Y_TOP = -0.95; // upper edge — above this is the top of the head / empty space
const FOREHEAD_Y_BOTTOM = -0.2; // lower edge — below this is the eyes / face center

// Default resolver for each grid cell's image + depth-map URL. Matches the repo's
// ./outputs/<prefix>/... layout. Override via the `urlFor` prop to host elsewhere.
const defaultUrlFor = (prefix, step, exprFolder) => ({
  // Color frame: per-expression subfolder when given, else the flat prefix folder.
  photo: exprFolder
    ? `./outputs/${prefix}/expressions/${exprFolder}/${step.filename}`
    : `./outputs/${prefix}/${step.filename}`,
  // Depth/displacement is shared across all expressions (head geometry is identical),
  // so it lives once under the avatar's prefix folder regardless of expression.
  depth: `./outputs/${prefix}/depth/${step.filename}.depth.webp`,
});

/**
 * Standalone 3D "eye-ballz" viewer. Drop the whole `eye-ballz-viewer/` folder into a
 * project (peer deps: react, three) and `import { EyeBallzViewer } from './eye-ballz-viewer'`.
 * See README.md for the full guide.
 *
 * Props:
 *   photos             Array of { key, thumbnail, prefix, xSteps, ySteps, expressions? }.
 *   urlFor             (prefix, step, exprFolder?) => { photo, depth }. Defaults to
 *                      ./outputs/<prefix>/...
 *   width, height      Viewer size in px (default 800; also the windowed restore size).
 *   initialSettings    Partial settings object (paste an exported config here).
 *   onSettingsChange   (settings) => void, fires on every tweak.
 *   status             Base expression name, parent-controlled (default "neutral").
 *   autoBlink          Run the auto-blink loop (default true).
 *   animationMode      Ignore the cursor and rest forward-facing (default false).
 *   debug              Reveal the built-in tweak + Export/Import panels (default false).
 *   windowed           Render as a draggable/resizable desktop window (default false).
 *   anchored           Windowed-only: start pinned to the viewport (default true).
 *   showTitlebarButtons  Windowed-only: show the ⚙/📌/⟲ title-bar buttons (default true).
 *   transparent        See-through background (no opaque ASCII/window fill) (default false).
 *   previewGrid        Dev: sub-sample the rendered grid to a coarser display grid —
 *                      number (N×N) or { x, y }; null = full source grid (default null).
 *
 * Imperative ref API (useRef + ref={...}):
 *   playGesture(name)      Play a gesture ("nodYes" | "nodNo"); see getGestures().
 *   setExpression(name)    Set the base expression by name; see getExpressions().
 *   setAnimationMode(on)   Toggle animation mode.
 *   getGestures()          -> string[] of registered gesture names.
 *   getExpressions()       -> string[] of the avatar's selectable expression names.
 */
function EyeBallzViewerInner(
  {
    photos,
    urlFor = defaultUrlFor,
    width = 800,
    height = 800,

    initialSettings = {
      displacementScale: 0.5,
      ascii: {
        enabled: true,
        characters: " .:-+*=%@#",
        invert: true,
        color: false,
        resolution: 0.27,
        fgColor: "#0000ff",
        bgColor: "#000000",
      },
      distortion: {
        waveAmp: 0.003,
        waveSpeed: 2,
        swirl: 0,
        glitch: 0,
        noise: 0,
        rgbShift: 0,
      },
      tilt: {
        enabled: true,
        maxTiltX: 6,
        maxTiltY: 6,
      },
    },
    onSettingsChange,
    status: statusProp = "neutral",
    autoBlink: autoBlinkProp = true,
    // When true the avatar ignores the cursor and rests forward-facing, so scripted
    // animations play cleanly. Toggleable at runtime via the ref API / debug panel.
    animationMode: animationModeProp = false,
    debug = false,
    // Treat the viewer as a draggable / resizable desktop window (fixed-position,
    // title bar drag handle, edge/corner resize handles, smooth "restore" button).
    // Off by default so the component stays embeddable inline; `width`/`height`
    // become the default (restore) size.
    windowed = false,
    // In windowed mode: start anchored to the viewport (position:fixed, stays on screen
    // when the page scrolls). false starts "scrolling with the page" (position:absolute).
    // Toggleable at runtime via the title-bar pin button.
    anchored = true,
    // In windowed mode: show the title-bar action buttons (⚙ debug toggle, 📌 pin,
    // ⟲ restore). Off hides all three — the title bar + drag handle stay, but there's no
    // way to open the debug overlay at runtime.
    showTitlebarButtons = true,
    // Render with a see-through background: the ASCII overlay's opaque bg becomes
    // transparent (the canvas is already alpha-cleared) so the viewer composites over
    // whatever is behind it.
    transparent = false,
    // Fired once after the active avatar's full grid set (depth + every expression) has
    // finished loading AND uploading to the GPU. Lets a parent hold a loading overlay
    // until the avatar is fully warm, so no upload jank shows after reveal.
    onReady,
    // Draw the "rub the forehead to smile" trigger zone (the FOREHEAD_* box) over the avatar
    // so it can be calibrated by eye. Dev-only; leave off in production.
    debugForehead = false,
    // Dev/preview: sub-sample each avatar's rendered grid down to a coarser display grid
    // to feel how it tracks at fewer poses (and load only those frames). Number => square
    // N×N; { x, y } => rectangular. null/undefined or a size >= the rendered grid keeps
    // the full source grid (production default).
    previewGrid = null,
    // Parent signal that the viewer is hidden behind other content (e.g. a routed
    // page over the persistent hero): the animation loop and the document-level
    // cursor tracking early-return, so nothing renders or reacts until unsuspended.
    suspended = false,
  },
  ref,
) {
  const containerRef = useRef(null);
  // Dev grid-size override set from the debug GridPanel; when null the `previewGrid` prop
  // (seeded by ?grid=) wins. Lets sizes be hot-swapped live to feel their load speed.
  const [gridOverride, setGridOverride] = useState(null);
  // Stats from the last completed grid load, shown in the GridPanel ({ grid, frames, ms }).
  const [loadStats, setLoadStats] = useState(null);
  const effPreviewGrid = gridOverride ?? previewGrid;
  // Stable primitive form of the effective grid so the load effect re-runs on a value change
  // (e.g. 5 -> 3) but not on a new object identity with the same dimensions.
  const previewGridKey =
    effPreviewGrid == null
      ? ""
      : typeof effPreviewGrid === "number"
        ? `${effPreviewGrid}`
        : `${effPreviewGrid.x}x${effPreviewGrid.y}`;
  // Mutable Three.js handles kept outside React's render cycle.
  const three = useRef(null);
  // Holds the latest playGesture closure so the (mount-stable) imperative handle always
  // calls the current one without re-creating the handle.
  const playGestureRef = useRef(() => {});

  // Bridge so the imperative forehead-circle detector (which lives on the Three.js handle,
  // outside React) can drive the smile expression on/off through React state. Set once below.
  const foreheadSmileRef = useRef(() => {});

  const [settings, setSettings] = useState(() =>
    mergeSettings(initialSettings),
  );
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  const [activeKey, setActiveKey] = useState(photos[0]?.key);
  const [importText, setImportText] = useState("");
  const [exportText, setExportText] = useState("");

  const {
    isAnchored,
    onTitlebarPointerDown,
    onHandlePointerDown,
    restoreWindow,
    toggleAnchor,
  } = useWindowChrome({ containerRef, windowed, width, height, anchored });

  // Mirrored so the mount effect's createAscii closure reads the live transparent flag
  // without becoming a dependency (which would re-create the whole Three.js scene).
  const transparentRef = useRef(transparent);
  transparentRef.current = transparent;

  // Mirrored for the same reason: the animation loop and onMouseMove read the live
  // suspended flag without re-creating the scene. On unsuspend, one forced render
  // repaints whatever state changes (e.g. a texture swap) landed while paused.
  const suspendedRef = useRef(suspended);
  suspendedRef.current = suspended;
  useEffect(() => {
    if (!suspended && three.current) three.current.needsRender = true;
  }, [suspended]);

  // Latest onReady, mirrored so the load effect can fire it without re-subscribing.
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;

  // Base expression (parent-controlled via `status`) and whether the auto-blink loop
  // runs. Mirrored into local state so the debug panel can drive them too; props win
  // whenever the parent changes them.
  const [status, setStatus] = useState(statusProp);
  const [autoBlink, setAutoBlink] = useState(autoBlinkProp);
  const [animMode, setAnimMode] = useState(animationModeProp);
  useEffect(() => setStatus(statusProp), [statusProp]);
  useEffect(() => setAutoBlink(autoBlinkProp), [autoBlinkProp]);
  useEffect(() => setAnimMode(animationModeProp), [animationModeProp]);
  // Mirrored so the mount effect can seed the freshly created handles with the live
  // mode. The drive-effect below is declared before the mount effect, so on first
  // render it runs against a null handle and can't apply an initially-true prop.
  const animModeRef = useRef(animMode);
  animModeRef.current = animMode;

  // Drive animation mode onto the Three.js handle. Enabling eases the avatar into a
  // neutral, forward-facing pose (flat tilt + centered look); disabling arms the
  // one-shot eased return so the next cursor move glides back before snapping resumes.
  useEffect(() => {
    const h = three.current;
    if (!h) return;
    h.animMode = animMode;
    if (animMode) {
      h.tiltTargetX = 0;
      h.tiltTargetY = 0;
      if (h.steps.length) {
        const cx = Math.round((h.xSteps - 1) / 2);
        const cy = Math.round((h.ySteps - 1) / 2);
        if (cx !== h.xIndex || cy !== h.yIndex) {
          h.look.from = { x: h.xIndex, y: h.yIndex };
          h.look.to = { x: cx, y: cy };
          h.look.start = performance.now();
          h.look.animating = true;
        }
      }
    } else {
      h.easeNextLook = true;
    }
    h.needsRender = true; // demand rendering: pose reset must reach the screen
  }, [animMode]);

  // Imperative control surface for parent code (chat replies, events, etc.): trigger a
  // gesture or switch expression without prop round-trips, and discover what's available.
  useImperativeHandle(
    ref,
    () => ({
      // Play a registered gesture (e.g. "nodYes", "nodNo"). The avatar eases back to
      // the neutral center cell, then nods by sweeping the grid. No-op if unknown.
      playGesture: (name) => playGestureRef.current(name),
      // Set the long-lived base expression by name (any loaded, non-blink expression).
      setExpression: (name) => setStatus(name),
      // Toggle animation mode: when on, the avatar ignores the cursor and faces forward;
      // when off, it eases back to the cursor once, then resumes normal mouse tracking.
      setAnimationMode: (on) => setAnimMode(Boolean(on)),
      // Names of registered gestures and of the avatar's selectable expressions.
      getGestures: () => listGestures(),
      getExpressions: () => {
        const h = three.current;
        return h ? Object.keys(h.expr).filter((n) => !isBlinkVariant(n)) : [];
      },
      // Abort the active gesture (if any) mid-flight and arm the eased return, so the
      // next pointer move glides back to mouse tracking. Used when the site intro is
      // skipped while the lookAround gesture is still sweeping.
      stopGesture: () => {
        const h = three.current;
        if (!h || !h.gesture) return;
        h.gesture = null;
        h.easeNextLook = true;
      },
      // Intro reveal effect: scale the shader's glitch/noise/rgb-shift from a strong
      // peak (amount=1) back down to the user's settings baseline (amount=0). Mutates
      // uniforms directly — no settings state writes, no re-renders; the settings
      // panel simply re-stomps these on its next change.
      setIntroDistortion: (amount) => {
        const h = three.current;
        if (!h) return;
        const a = Math.max(0, Math.min(1, amount));
        const base = settingsRef.current.distortion;
        h.uniforms.uGlitch.value = base.glitch + (0.12 - base.glitch) * a;
        h.uniforms.uNoise.value = base.noise + (0.06 - base.noise) * a;
        h.uniforms.uRGBShift.value = base.rgbShift + (0.02 - base.rgbShift) * a;
        // The loop renders on its own while these are nonzero; this catches the tween's
        // final step back to an all-zero baseline so the clean frame reaches the screen.
        h.needsRender = true;
      },
    }),
    [],
  );

  // Whether the debug overlay shows. Seeded from the `debug` prop but also toggleable
  // live from the window's title-bar button.
  const [isDebug, setIsDebug] = useState(debug);
  useEffect(() => setIsDebug(debug), [debug]);
  // Read inside the (status-independent) texture-load effect without making it a dep.
  const statusRef = useRef(status);
  statusRef.current = status;

  // (Re)create the AsciiEffect from the current ascii settings. characters/resolution/
  // color are constructor-time params, so changing them requires a full rebuild.
  // Kept in a ref so both the rebuild effect and mount-time setup can call it.
  const buildAscii = useRef(() => {});

  // ---- Mount: build the Three.js scene once. ------------------------------------
  useEffect(() => {
    const container = containerRef.current;
    const canvas = document.createElement("canvas");
    canvas.className = "eye-ballz-canvas";
    container.appendChild(canvas);

    const scene = new Scene();
    const camera = new PerspectiveCamera(30, width / height, 0.01, 10);
    camera.position.z = 2.4;
    scene.add(camera);

    // alpha + transparent clear color so the margin around the plane reads as alpha 0
    // (blank) in the ASCII effect instead of a black border of dense chars.
    const renderer = new WebGLRenderer({
      canvas,
      // MSAA only where it's visible: at DPR>=2 the capped-DPR supersampling already
      // smooths edges (and in ASCII mode the canvas is downsampled to glyphs anyway),
      // so skipping it frees fill rate on exactly the devices that need it.
      antialias: window.devicePixelRatio < 2,
      alpha: true,
    });
    renderer.setSize(width, height);
    renderer.setPixelRatio(
      pixelRatioFor(
        settingsRef.current.ascii.enabled,
        settingsRef.current.ascii.backplate,
      ),
    );
    renderer.setClearColor(0x000000, 0);

    scene.add(new AmbientLight(0xffffff, 2));

    const uniforms = createUniforms();
    const material = new MeshStandardMaterial({
      side: DoubleSide,
      displacementScale: settingsRef.current.displacementScale,
    });
    applyShader(material, uniforms);

    // 256×256 (~131k tris) is well past the perceptible threshold for the low-frequency
    // depth maps and the default ASCII output, at ¼ the vertex work of 512×512.
    const geometry = new PlaneGeometry(1, 1, PLANE_SEGMENTS, PLANE_SEGMENTS);
    const mesh = new Mesh(geometry, material);
    scene.add(mesh);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    // Demand rendering: user orbit input (and damping inertia) re-dirties the frame.
    controls.addEventListener("change", () => {
      if (three.current) three.current.needsRender = true;
    });

    const handles = {
      renderer,
      scene,
      camera,
      material,
      mesh,
      controls,
      canvas,
      container,
      uniforms,
      // Normalized [-1,1] cursor position the mesh eases its tilt toward each frame.
      tiltTargetX: 0,
      tiltTargetY: 0,
      asciiEffect: null,
      asciiEnabled: settingsRef.current.ascii.enabled,
      // Last responsive ASCII resolution actually built (see effectiveAsciiResolution); the
      // resize observer compares against it to rebuild only when the column count changes.
      asciiRes: 0,
      // Per-expression resident color textures: { [expression]: Map<filename, tex> }.
      // All loaded expressions stay resident so swapping between them never reloads.
      expr: {},
      // Shared displacement textures, keyed by filename and reused by every expression
      // (only the color frame changes between neutral/blink/smile/smileBlink).
      depth: new Map(),
      hasExpressions: false,
      baseExpression: "default", // long-lived expression (from status)
      displayExpression: "default", // what's on screen now (base, or its blink variant)
      blinking: false,
      // Bitmask of which maps are currently bound (1=color, 2=displacement). Lets
      // applyTexture force a shader re-eval only when a map's presence toggles.
      mapState: 0,
      steps: [],
      xSteps: 0,
      ySteps: 0,
      xIndex: 0,
      yIndex: 0,
      // Touch only: tween the displayed grid cell through intermediate look phases
      // instead of snapping (a tap is one discrete pointer update, not a hover sweep).
      look: {
        animating: false,
        from: { x: 0, y: 0 },
        to: { x: 0, y: 0 },
        start: 0,
      },
      // Active scripted gesture (nod yes/no), or null. Driven each frame in the
      // animation loop; sweeps the grid look-cell so the face turns, and feeds the
      // tilt targets so the mesh carries the same subtle lean as mouse-look.
      gesture: null,
      // Animation mode: when true the avatar ignores the cursor entirely (so scripted
      // animations play cleanly) and rests in a neutral, forward-facing pose. Seeded
      // from the live prop so a parent mounting with animationMode already on (the
      // site intro) is respected from the first frame.
      animMode: animModeRef.current,
      // One-shot: when true the next cursor reacquire eases (smooth look-sweep) instead
      // of snapping, then reverts to normal snap behavior. Set on gesture-end / mode-off.
      easeNextLook: false,
      // "Rub the forehead to smile" detector state. pointerDown gates sampling; circle is a
      // sliding ring buffer of recent {x,y,t} pointer samples; smiling is the current toggle;
      // lastCircleTime stamps the last qualifying circular frame.
      pointerDown: false,
      circle: [],
      smiling: false,
      lastCircleTime: 0,
      lastFrameTime: 0,
      loadToken: 0,
      disposed: false,
      // Demand rendering: the loop only calls renderer.render() when something changed.
      // Every mutation site (texture swap, settings push, resize, controls, intro
      // distortion) sets this; continuous motion (gesture/look/tilt/time-driven
      // distortion) is detected per-frame in the loop instead.
      needsRender: true,
      lastRenderTime: 0,
    };
    three.current = handles;

    buildAscii.current = () => {
      const h = three.current;
      if (!h) return;
      const a = settingsRef.current.ascii;
      if (h.asciiEffect?.domElement.parentElement) {
        h.container.removeChild(h.asciiEffect.domElement);
      }
      // Scale the resolution to the live container so mobile keeps desktop-like detail.
      const cw = h.container.clientWidth || width;
      const resolution = effectiveAsciiResolution(a.resolution, cw);
      h.asciiRes = resolution; // remembered so the resize observer only rebuilds on a real change
      // invert is handled in the material shader, not here (see uInvert).
      const effect = new PhraseAsciiEffect(h.renderer, a.characters, {
        color: a.color,
        resolution,
        phrase: a.phrase,
      });
      // Size from the live container, not the width/height props — keeps the ASCII
      // grid in sync after the window is resized.
      effect.setSize(cw, h.container.clientHeight || height);
      effect.domElement.classList.add("eye-ballz-ascii");
      effect.domElement.style.display = a.enabled ? "" : "none";
      effect.domElement.style.color = a.fgColor;
      effect.domElement.style.backgroundColor = transparentRef.current
        ? "transparent"
        : a.bgColor;
      h.container.appendChild(effect.domElement);
      h.asciiEffect = effect;
      h.needsRender = true; // fresh ASCII DOM is empty until the next render
    };

    renderer.setAnimationLoop(() => {
      const h = three.current;
      if (!h || h.disposed) return;
      // Hidden behind a routed page — skip everything (uTime freezes too, so a
      // time-based distortion resumes where it left off instead of jumping).
      if (suspendedRef.current) return;
      h.uniforms.uTime.value = performance.now() / 1000;

      // Subtle mouse-follow tilt: ease the mesh rotation toward the cursor (or back
      // to flat when disabled). Independent of the OrbitControls-owned camera.
      const tilt = settingsRef.current.tilt;
      const maxX = tilt.enabled ? (tilt.maxTiltX * Math.PI) / 180 : 0;
      const maxY = tilt.enabled ? (tilt.maxTiltY * Math.PI) / 180 : 0;
      const tx = h.tiltTargetY * maxY; // rotate.y follows horizontal cursor
      const ty = h.tiltTargetX * maxX; // rotate.x follows vertical cursor
      const tiltActive =
        Math.abs(tx - h.mesh.rotation.y) > 1e-4 ||
        Math.abs(ty - h.mesh.rotation.x) > 1e-4;
      if (tiltActive) {
        h.mesh.rotation.y += (tx - h.mesh.rotation.y) * 0.1;
        h.mesh.rotation.x += (ty - h.mesh.rotation.x) * 0.1;
      }

      // Scripted gesture (nod yes/no): sweep the grid look-cell along the gesture's
      // keyframe path so the face turns through the pre-rendered frames. Owns the look
      // while it runs (the touch sweep below and pointer look are gated on !h.gesture).
      if (h.gesture) {
        const g = sampleGesture(h.gesture, performance.now(), h);
        // Drive the same subtle mesh tilt the cursor does, from the gesture's
        // continuous look offsets — so the intro look-around and nods carry the
        // slight lean instead of playing on a perfectly flat mesh. g.done resets
        // both to 0, easing the mesh back flat.
        h.tiltTargetX = g.oy;
        h.tiltTargetY = g.ox;
        if (g.xIndex !== h.xIndex || g.yIndex !== h.yIndex) {
          h.xIndex = g.xIndex;
          h.yIndex = g.yIndex;
          applyTexture(h, h.steps[g.yIndex][g.xIndex]);
        }
        if (g.done) {
          h.gesture = null;
          // Ease (not snap) the look back to the cursor when tracking resumes. If still
          // in animation mode, the flag waits until the mode is turned off.
          h.easeNextLook = true;
        }
      }

      // Touch look sweep: ease the displayed grid cell from `from` to `to`, stepping
      // through each intermediate look phase rather than snapping (mouse/pen snap in
      // onMouseMove). Updating h.xIndex/yIndex as we go keeps auto-blink on the live cell.
      if (!h.gesture && h.look.animating) {
        const p = Math.min(
          1,
          (performance.now() - h.look.start) / LOOK_TRANSITION_MS,
        );
        const e = easeInOutCubic(p);
        const nx = Math.round(
          h.look.from.x + (h.look.to.x - h.look.from.x) * e,
        );
        const ny = Math.round(
          h.look.from.y + (h.look.to.y - h.look.from.y) * e,
        );
        if (nx !== h.xIndex || ny !== h.yIndex) {
          h.xIndex = nx;
          h.yIndex = ny;
          applyTexture(h, h.steps[ny][nx]);
        }
        if (p >= 1) h.look.animating = false;
      }

      // Forehead-smile falling edge: revert once the circular motion has stalled (no
      // qualifying frame for SMILE_STOP_MS). The rising edge is set in onMouseMove; pointerup
      // forces it off immediately.
      if (h.smiling && performance.now() - h.lastCircleTime > SMILE_STOP_MS) {
        h.smiling = false;
        foreheadSmileRef.current(false);
      }

      // Render only when something can have changed on screen: a continuous animation
      // is running, a mutation site flagged needsRender, or the 500ms safety fallback
      // fires (belt-and-suspenders against a missed dirty site — an idle frame is the
      // common case and costs nothing). animMode covers the whole site intro, where
      // choreography (fade-in, distortion decay, gestures) overlaps unpredictably.
      const distorting =
        h.uniforms.uWaveAmp.value !== 0 ||
        h.uniforms.uSwirl.value !== 0 ||
        h.uniforms.uGlitch.value !== 0 ||
        h.uniforms.uNoise.value !== 0 ||
        h.uniforms.uRGBShift.value !== 0;
      const now = performance.now();
      // Interaction/choreography renders every frame; the ambient distortion (the
      // default settings ship a subtle waveAmp so the face never fully freezes) only
      // needs ~30fps — the ASCII grid quantizes to glyphs, so faster is invisible.
      // Fully static scenes just heartbeat at 2fps as a missed-dirty-site safety net.
      const hardActive =
        h.animMode || h.gesture || h.look.animating || tiltActive || h.needsRender;
      // Phones: cap EVERY active render at 30fps — look-around easing, tilt,
      // gestures, the intro choreography, and texture-swap dirty flags alike.
      // A render here is not just WebGL: the asciify pass does a synchronous
      // getImageData readback + glyph-string rebuild, and at the display's
      // native 60–120Hz that alone janks the page. The ASCII glyph grid
      // quantizes away anything above ~30fps, and pointer-driven grid swaps
      // are already throttled to 24Hz, so nothing visible is lost — a capped
      // frame keeps its needsRender flag and lands ≤33ms later. Desktop
      // renders every frame exactly as before.
      const phoneCapped = COARSE_POINTER
        ? now - h.lastRenderTime >= 1000 / 30
        : true;
      const shouldRender = hardActive
        ? phoneCapped
        : now - h.lastRenderTime >= (distorting ? 1000 / 30 : 500);
      if (shouldRender) {
        h.needsRender = false;
        h.lastRenderTime = now;
        if (h.asciiEnabled && h.asciiEffect) {
          h.asciiEffect.render(scene, camera);
        } else {
          renderer.render(scene, camera);
        }
      }
      controls.update();
    });

    const onMouseMove = (e) => {
      const h = three.current;
      if (!h || h.xSteps === 0) return;
      // Document-level listener: while a routed page covers the hero the cursor
      // belongs to that page — no look tracking, no tilt, no texture swaps.
      if (suspendedRef.current) return;
      // A scripted gesture or animation mode owns the avatar — ignore the cursor entirely
      // (no grid look, no tilt) while either is active.
      if (h.gesture || h.animMode) return;
      // Track held state for the forehead-circle detector. Set before the FPS throttle so a
      // pointerdown is never dropped (it can arrive right after a throttled pointermove).
      if (e.type === "pointerdown") {
        h.pointerDown = true;
        h.circle.length = 0;
      }
      const now = performance.now();
      if (now - h.lastFrameTime < 1000 / FPS) return;
      h.lastFrameTime = now;

      const rect = h.container.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const nx = Math.max(-1, Math.min(1, (e.clientX - cx) / (rect.width / 2)));
      const ny = Math.max(
        -1,
        Math.min(1, (e.clientY - cy) / (rect.height / 2)),
      );

      // Record the tilt target before the grid-cell early-return below, so the
      // tilt stays smooth even when the cursor hasn't crossed into a new cell.
      h.tiltTargetX = ny; // pitch from vertical cursor pos
      h.tiltTargetY = nx; // yaw from horizontal cursor pos

      const xIndex = Math.round(((nx + 1) / 2) * (h.xSteps - 1));
      const yIndex = Math.round(((ny + 1) / 2) * (h.ySteps - 1));

      // "Rub the forehead to smile": while the pointer is held, sample its path and look for a
      // sustained circular motion (net turned angle past the threshold, with a real radius so
      // jitter/holding-still doesn't count) whose center sits on the forehead. Runs before the
      // same-cell early-return below so small circles within one cell still count.
      if (h.pointerDown && h.steps.length) {
        const c = h.circle;
        c.push({ x: e.clientX, y: e.clientY, t: now });
        while (c.length && now - c[0].t > CIRCLE_WINDOW_MS) c.shift();
        if (c.length >= CIRCLE_MIN_SAMPLES) {
          let mx = 0;
          let my = 0;
          for (const p of c) {
            mx += p.x;
            my += p.y;
          }
          mx /= c.length;
          my /= c.length;
          let turned = 0;
          let radius = 0;
          for (let i = 1; i < c.length; i++) {
            const ax = c[i - 1].x - mx;
            const ay = c[i - 1].y - my;
            const bx = c[i].x - mx;
            const by = c[i].y - my;
            // signed angle from a→b (atan2 of cross, dot) — accumulates either direction.
            turned += Math.atan2(ax * by - ay * bx, ax * bx + ay * by);
            radius += Math.hypot(bx, by);
          }
          radius /= c.length - 1;
          // Gate on where the circle is *centered*, in container-normalized coords (origin =
          // center, y negative = up). The head is centered, so the forehead is a band just
          // above center — this rejects circles above the head and in the top corners.
          const nmx = (mx - cx) / (rect.width / 2);
          const nmy = (my - cy) / (rect.height / 2);
          const onForehead =
            Math.abs(nmx) <= FOREHEAD_X_HALF &&
            nmy >= FOREHEAD_Y_TOP &&
            nmy <= FOREHEAD_Y_BOTTOM;
          const circling =
            radius >= CIRCLE_MIN_RADIUS &&
            Math.abs(turned) >= CIRCLE_TURN_THRESHOLD &&
            onForehead;
          if (circling) {
            h.lastCircleTime = now; // keeps the smile alive; loop reverts after SMILE_STOP_MS
            if (!h.smiling) {
              h.smiling = true;
              foreheadSmileRef.current(true);
            }
          }
        }
      }

      if (xIndex === h.xIndex && yIndex === h.yIndex) return;

      // A touch *tap* (initial contact, pointerdown) eases a sweep to the tapped cell; a
      // touch *drag* (continuous pointermove) snaps so the look tracks the finger 1:1 with
      // no ~300ms lag. The easeNextLook one-shot (eased return after a gesture/anim-mode
      // exit) still eases regardless of input.
      const touchTap = e.pointerType === "touch" && e.type !== "pointermove";
      if (touchTap || h.easeNextLook) {
        // Touch tap, or the one-shot eased return after an animation: tween from the current
        // cell toward the target; the animation loop steps through the intermediate look
        // phases. Retargets cleanly mid-sweep since h.xIndex/yIndex track the live cell.
        h.look.from = { x: h.xIndex, y: h.yIndex };
        h.look.to = { x: xIndex, y: yIndex };
        h.look.start = performance.now();
        h.look.animating = true;
        h.easeNextLook = false; // consume the one-shot; subsequent mouse moves snap again
        return;
      }

      // Mouse / pen: snap the look instantly to the cell under the cursor.
      h.xIndex = xIndex;
      h.yIndex = yIndex;
      applyTexture(h, h.steps[yIndex][xIndex]);
    };
    // Pointer events (not mousemove) so the look behavior follows the input actually used
    // per interaction — mouse/trackpad snaps, touch sweeps — even on hybrid touchscreen
    // devices. pointerdown covers a stationary touch tap that emits no pointermove.
    document.addEventListener("pointermove", onMouseMove);
    document.addEventListener("pointerdown", onMouseMove);

    // Release ends the forehead-circle gesture: drop the held state, clear the sample buffer,
    // and force the smile off immediately (don't wait out SMILE_STOP_MS).
    const onPointerUp = () => {
      const h = three.current;
      if (!h) return;
      h.pointerDown = false;
      h.circle.length = 0;
      if (h.smiling) {
        h.smiling = false;
        foreheadSmileRef.current(false);
      }
    };
    document.addEventListener("pointerup", onPointerUp);
    document.addEventListener("pointercancel", onPointerUp);

    // Keep camera / renderer / ASCII effect in sync with the container's content box.
    // One ResizeObserver covers manual drag-resize, the restore tween, and inline
    // (non-windowed) embedding where the host sizes the element via CSS.
    const resizeViewer = (w, hgt) => {
      if (w === 0 || hgt === 0) return;
      camera.aspect = w / hgt;
      camera.updateProjectionMatrix();
      renderer.setSize(w, hgt);
      three.current?.asciiEffect?.setSize(w, hgt);
      if (three.current) three.current.needsRender = true; // setSize cleared the canvas
    };
    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const cr = entry.contentRect;
        resizeViewer(cr.width, cr.height);
        // The responsive ASCII resolution depends on width; when it shifts enough (e.g. an
        // orientation change or crossing the mobile/desktop size), rebuild so the column
        // count — and the face's detail — stays consistent. Guarded so a continuous resize
        // (drag/restore tween) doesn't rebuild every frame.
        const h = three.current;
        if (h?.asciiEnabled && cr.width) {
          const next = effectiveAsciiResolution(
            settingsRef.current.ascii.resolution,
            cr.width,
          );
          if (Math.abs(next - h.asciiRes) > 0.01) buildAscii.current();
        }
      }
    });
    resizeObserver.observe(container);

    return () => {
      handles.disposed = true;
      document.removeEventListener("pointermove", onMouseMove);
      document.removeEventListener("pointerdown", onMouseMove);
      document.removeEventListener("pointerup", onPointerUp);
      document.removeEventListener("pointercancel", onPointerUp);
      resizeObserver.disconnect();
      renderer.setAnimationLoop(null);
      controls.dispose();
      disposeExpr(handles);
      geometry.dispose();
      material.dispose();
      handles.asciiEffect?.domElement.remove();
      renderer.dispose();
      canvas.remove();
      three.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [width, height]);

  // ---- Rebuild AsciiEffect when constructor-time params change (and on first mount). --
  useEffect(() => {
    buildAscii.current();
  }, [
    settings.ascii.characters,
    settings.ascii.resolution,
    settings.ascii.color,
    settings.ascii.phrase,
  ]);

  // ---- Push live settings into Three (no rebuild). -------------------------------
  useEffect(() => {
    const h = three.current;
    if (!h) return;
    h.material.displacementScale = settings.displacementScale;
    h.material.needsUpdate = true;

    h.uniforms.uInvert.value = settings.ascii.invert ? 1 : 0;
    h.uniforms.uWaveAmp.value = settings.distortion.waveAmp;
    h.uniforms.uWaveSpeed.value = settings.distortion.waveSpeed;
    h.uniforms.uSwirl.value = settings.distortion.swirl;
    h.uniforms.uGlitch.value = settings.distortion.glitch;
    h.uniforms.uNoise.value = settings.distortion.noise;
    h.uniforms.uRGBShift.value = settings.distortion.rgbShift;

    // ASCII mode renders the (invisible) canvas at DPR 1; plain mode needs the capped DPR
    // for a crisp visible canvas. Re-apply on toggle, then resize to take effect.
    const nextRatio = pixelRatioFor(
      settings.ascii.enabled,
      settings.ascii.backplate,
    );
    if (h.renderer.getPixelRatio() !== nextRatio) {
      h.renderer.setPixelRatio(nextRatio);
      const w = h.container.clientWidth || width;
      const hgt = h.container.clientHeight || height;
      h.renderer.setSize(w, hgt);
    }

    h.asciiEnabled = settings.ascii.enabled;
    if (h.asciiEffect) {
      const el = h.asciiEffect.domElement;
      el.style.display = settings.ascii.enabled ? "" : "none";
      el.style.backgroundColor = transparent
        ? "transparent"
        : settings.ascii.bgColor;
      // Gradient glyph color: paint the block with a linear-gradient and clip it to the
      // text. Mutually exclusive with per-pixel `color` mode (which sets its own spans),
      // so it only applies when color mode is off.
      const g = settings.ascii.gradient;
      if (g?.enabled && !settings.ascii.color) {
        el.style.backgroundImage = `linear-gradient(${g.angle}deg, ${g.from}, ${g.to})`;
        el.style.webkitBackgroundClip = "text";
        el.style.backgroundClip = "text";
        el.style.webkitTextFillColor = "transparent";
        el.style.color = "transparent";
      } else {
        el.style.backgroundImage = "";
        el.style.webkitBackgroundClip = "";
        el.style.backgroundClip = "";
        el.style.webkitTextFillColor = "";
        el.style.color = settings.ascii.fgColor;
      }
    }
    // Hide the canvas visually but keep it interactive (opacity, not display) so
    // OrbitControls stays bound and AsciiEffect still reads its bitmap. In ASCII mode a
    // non-zero `backplate` reveals the keyed model behind the glyphs (fills the model
    // silhouette only — the keyed background stays transparent).
    h.canvas.style.opacity = settings.ascii.enabled
      ? String(settings.ascii.backplate ?? 0)
      : "";
    // The revealed backplate is a solid accent-blue silhouette, not the photographic
    // render: brightness(0) flattens the keyed head to black (alpha untouched), the
    // rest of the chain tints that black to #0000ff. Display-only — AsciiEffect
    // samples the framebuffer, not the CSS-filtered canvas. Raw-canvas mode (ASCII
    // off) must stay photographic, so the filter clears with the reveal.
    h.canvas.style.filter =
      settings.ascii.enabled && (settings.ascii.backplate ?? 0) > 0
        ? "brightness(0) invert(8%) sepia(94%) saturate(7481%) hue-rotate(247deg) brightness(97%) contrast(147%)"
        : "";
    h.needsRender = true; // demand rendering: repaint with the new settings
  }, [settings, transparent]);

  // ---- Notify parent of settings changes. ----------------------------------------
  useEffect(() => {
    onSettingsChange?.(settings);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings]);

  // ---- Load the active avatar's expression grids whenever it changes. -------------
  // Every available expression is preloaded AND GPU-warmed up front and kept resident,
  // so blink/smile/eye-tracking are all the same instant material.map swap with no
  // network, decode, or first-upload hitch.
  useEffect(() => {
    const photo = photos.find((p) => p.key === activeKey);
    if (!photo) return;
    let cancelled = false;

    const t0 = performance.now(); // load-speed readout for the debug GridPanel

    (async () => {
      const h = three.current;
      if (!h) return;
      const token = ++h.loadToken;

      // Generate the full rendered grid (filenames must match the source resolution's
      // angles), then optionally thin it to a coarser preview grid. `gridX`/`gridY` are
      // the *display* dimensions — used for interaction granularity and indexing — while
      // each cell keeps its real on-disk filename.
      const source = generateSteps({
        X_STEPS: photo.xSteps,
        Y_STEPS: photo.ySteps,
        PREFIX: photo.prefix,
      });
      const pg =
        typeof effPreviewGrid === "number"
          ? { x: effPreviewGrid, y: effPreviewGrid }
          : effPreviewGrid;
      const grid = pg ? subsampleSteps(source, pg.x, pg.y) : source;
      const dispSteps = grid.steps;
      const gridX = grid.X_STEPS;
      const gridY = grid.Y_STEPS;

      // Expression name -> color subfolder under expressions/. Avatars without an
      // `expressions` map load a single `default` color grid (flat-folder behavior).
      const exprFolders = photo.expressions ?? { default: null };

      const loader = new TextureLoader();
      const all = dispSteps.flat();
      const batchSize = 10;

      // Probe each expression's color folder by loading one representative (center)
      // frame; only grids whose files actually exist get preloaded, so a missing
      // variant (e.g. smileBlink) is simply skipped instead of erroring.
      const center = dispSteps[Math.floor(gridY / 2)][Math.floor(gridX / 2)];
      const present = {};
      await Promise.all(
        Object.entries(exprFolders).map(async ([name, folder]) => {
          const { photo: url } = urlFor(photo.prefix, center, folder);
          present[name] = await new Promise((res) => {
            loader.load(
              url,
              () => res(true),
              undefined,
              () => res(false),
            );
          });
        }),
      );
      if (cancelled || token !== h.loadToken) return;

      const available = Object.entries(exprFolders).filter(
        ([name]) => present[name],
      );
      // If every probe failed (e.g. offline), still attempt the flat grid so the
      // viewer tries to render rather than going blank.
      const toLoad = available.length ? available : [["default", null]];

      // Dispose the previous avatar's grids (color sets + shared depth) before loading.
      disposeExpr(h);
      for (const [name] of toLoad) h.expr[name] = new Map();

      // Count the textures actually fetched this run (shared depth + each color grid) for
      // the debug load-speed readout. Starts with the one shared depth set.
      let frameCount = all.length;

      // --- Shared depth set: loaded once, keyed by filename, reused by every grid. ---
      for (let i = 0; i < all.length; i += batchSize) {
        if (cancelled || token !== h.loadToken) return;
        await Promise.all(
          all.slice(i, i + batchSize).map(
            (step) =>
              new Promise((resolve) => {
                const { depth: depthUrl } = urlFor(
                  photo.prefix,
                  step,
                  toLoad[0][1],
                );
                loader.load(
                  depthUrl,
                  (depthTexture) => {
                    // Plane renders ~1:1, so mipmaps add ~33% VRAM + gen time for no
                    // visible gain across the hundreds of preloaded textures.
                    depthTexture.generateMipmaps = false;
                    depthTexture.minFilter = LinearFilter;
                    h.renderer.initTexture(depthTexture); // pre-upload to GPU
                    h.depth.set(step.filename, depthTexture);
                    resolve();
                  },
                  undefined,
                  () => resolve(),
                );
              }),
          ),
        );
      }

      // --- Color sets. Load the base expression first and reveal the avatar as soon
      // as it (plus shared depth) is ready, so first paint isn't blocked on all four
      // grids. The rest keep loading behind it so later swaps are still instant. ------
      // Named expressions loaded (not the single-grid fallback) → expression mode on.
      h.hasExpressions = !toLoad.some(([name]) => name === "default");
      const baseName = resolveBase(h, statusRef.current); // empty maps exist → valid
      const ordered = [...toLoad].sort(
        (a, b) => (a[0] === baseName ? -1 : 0) - (b[0] === baseName ? -1 : 0),
      );

      let revealed = false;
      for (const [name, folder] of ordered) {
        // Once the avatar is revealed the remaining grids (blink/smile/smileBlink) are
        // nice-to-haves — wait for an idle slot so they don't compete with the intro
        // roam (gallery figure fetches, GSAP choreography) for bandwidth and decode.
        if (revealed) {
          await new Promise((r) =>
            "requestIdleCallback" in window
              ? requestIdleCallback(r, { timeout: 4000 })
              : setTimeout(r, 1500),
          );
          if (cancelled || token !== h.loadToken) return;
        }
        const colors = h.expr[name];
        // Some expressions (e.g. smile/smileBlink, only shown by the forehead easter-egg)
        // load just their top N rows — the look-up poses — to skip ~60% of the textures.
        const rowLimit = photo.topRowsOnly?.[name];
        const frames = rowLimit ? all.filter((s) => s.y < rowLimit) : all;
        frameCount += frames.length;
        for (let i = 0; i < frames.length; i += batchSize) {
          if (cancelled || token !== h.loadToken) return;
          await Promise.all(
            frames.slice(i, i + batchSize).map(
              (step) =>
                new Promise((resolve) => {
                  const { photo: photoUrl } = urlFor(
                    photo.prefix,
                    step,
                    folder,
                  );
                  loader.load(
                    photoUrl,
                    (texture) => {
                      texture.colorSpace = SRGBColorSpace;
                      texture.generateMipmaps = false; // see depth note above
                      texture.minFilter = LinearFilter;
                      h.renderer.initTexture(texture); // pre-upload to GPU
                      colors.set(step.filename, texture);
                      resolve();
                    },
                    undefined,
                    () => resolve(),
                  );
                }),
            ),
          );
        }
        // Reveal the avatar the moment the base expression's grid finishes loading.
        if (!revealed && name === baseName) {
          h.steps = dispSteps;
          h.xSteps = gridX;
          h.ySteps = gridY;
          h.xIndex = Math.floor(gridX / 2);
          h.yIndex = Math.floor(gridY / 2);
          // Reset the mobile look tween so a freshly loaded avatar starts centered
          // and doesn't carry a stale sweep from the previous one.
          h.look.animating = false;
          h.look.from = { x: h.xIndex, y: h.yIndex };
          h.look.to = { x: h.xIndex, y: h.yIndex };
          h.blinking = false;
          h.baseExpression = baseName;
          h.displayExpression = baseName;
          applyTexture(h, dispSteps[h.yIndex][h.xIndex]);
          revealed = true;
          // Signal ready the moment the base grid (+ shared depth) is up — that's all
          // the user sees. The remaining expression grids (blink/smile/smileBlink) keep
          // loading behind the revealed avatar; the blink loop and forehead easter-egg
          // tolerate a not-yet-loaded variant (applyTexture/blinkVariantOf no-op on a
          // missing cell), so there's no need to gate first paint on them. Neutral+depth
          // are already HTTP-cached by the loader, so this is just a GPU upload away.
          onReadyRef.current?.();
        }
      }

      // The remaining expression grids have now finished warming behind the avatar; no
      // second ready signal — the parent already dropped the overlay at reveal above.
      if (!cancelled && token === h.loadToken) {
        setLoadStats({
          grid: `${gridX}×${gridY}`,
          frames: frameCount,
          ms: Math.round(performance.now() - t0),
        });
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeKey, photos, previewGridKey]);

  // ---- Status -> base expression. Swap the resident grid at the live (x,y) cell. --
  useEffect(() => {
    const h = three.current;
    if (!h || !h.steps.length) return;
    h.baseExpression = resolveBase(h, status);
    // Reflect the new base now unless a blink is currently showing — the blink loop
    // restores to h.baseExpression on eye-open, so the change is picked up there.
    if (!h.blinking) {
      h.displayExpression = h.baseExpression;
      applyTexture(h, h.steps[h.yIndex][h.xIndex]);
    }
  }, [status]);

  // ---- Auto-blink: flash the current base's blink variant on a random cadence. ----
  useAutoBlink(three, autoBlink, activeKey);

  // ---- Hold "c" to smile: smile while held, return to the prior expression on release. --
  useEffect(() => {
    const prev = { current: null };
    const isTyping = (t) =>
      t &&
      (t.tagName === "INPUT" ||
        t.tagName === "TEXTAREA" ||
        t.isContentEditable);
    const down = (e) => {
      if (e.key !== "c" || e.repeat || e.metaKey || e.ctrlKey || e.altKey)
        return;
      if (isTyping(e.target)) return;
      if (prev.current == null) prev.current = statusRef.current; // remember current
      setStatus("smile");
    };
    const up = (e) => {
      if (e.key !== "c") return;
      if (prev.current != null) {
        setStatus(prev.current);
        prev.current = null;
      }
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, []);

  // ---- "Rub the forehead to smile": let the imperative circle detector toggle the smile. --
  // Mirrors the hold-"c" logic: remember the current base on the rising edge, restore it on
  // the falling edge. setStatus("smile") degrades safely — if the smile grid isn't loaded,
  // resolveBase falls back to neutral, so the gesture is simply a no-op.
  useEffect(() => {
    const prev = { current: null };
    foreheadSmileRef.current = (on) => {
      if (on) {
        if (prev.current == null) prev.current = statusRef.current;
        setStatus("smile");
      } else if (prev.current != null) {
        setStatus(prev.current);
        prev.current = null;
      }
    };
  }, []);

  // ---- Control helpers ------------------------------------------------------------
  const setDepth = (displacementScale) =>
    setSettings((s) => ({ ...s, displacementScale }));
  const updateAscii = (patch) =>
    setSettings((s) => ({ ...s, ascii: { ...s.ascii, ...patch } }));
  const updateDistortion = (patch) =>
    setSettings((s) => ({ ...s, distortion: { ...s.distortion, ...patch } }));
  const updateTilt = (patch) =>
    setSettings((s) => ({ ...s, tilt: { ...s.tilt, ...patch } }));
  const updateCrt = (patch) =>
    setSettings((s) => ({ ...s, crt: { ...s.crt, ...patch } }));

  // The active avatar exposes expression controls only if it declares them. The
  // selectable bases are every declared expression that isn't a blink variant (those
  // are flashed by the auto-blink loop, not chosen directly).
  const activePhoto = photos.find((p) => p.key === activeKey);
  const hasExpressions = !!activePhoto?.expressions;
  const expressionNames = Object.keys(activePhoto?.expressions ?? {}).filter(
    (n) => !isBlinkVariant(n),
  );
  const gestureNames = listGestures();

  // Start a gesture imperatively (shared by the debug panel and the ref handle).
  const playGesture = (name) => {
    const h = three.current;
    if (!h || !h.steps.length) return;
    const inst = startGesture(name, h);
    if (inst) h.gesture = inst;
  };
  playGestureRef.current = playGesture;

  const handleExport = async () => {
    const json = JSON.stringify(settings, null, 2);
    setExportText(json);
    try {
      await navigator.clipboard.writeText(json);
    } catch {
      /* clipboard may be unavailable (insecure context) — textarea still shows it */
    }
  };
  const handleImport = () => {
    try {
      setSettings(mergeSettings(JSON.parse(importText)));
    } catch {
      /* ignore malformed JSON */
    }
  };

  // Windowed mode keeps the debug controls inline (their absolute coords are relative to the
  // draggable window). Embedded/non-windowed, portal them onto <body> in a flow-laid HUD:
  // `.hero-avatar`'s transform would otherwise trap even fixed-position panels inside the
  // small avatar box, collapsing them onto each other. The portal escapes that so all panels
  // stay visible (see .eye-ballz-debug in the CSS).
  const renderDebug = (controls) =>
    windowed
      ? controls
      : createPortal(
          <div className="eye-ballz-debug">{controls}</div>,
          document.body,
        );

  return (
    <div
      ref={containerRef}
      className={`eye-ballz${windowed ? " eye-ballz--windowed" : ""}${
        windowed && !isAnchored ? " eye-ballz--scrolls" : ""
      }${settings.crt.enabled ? " eye-ballz--crt" : ""}${
        settings.crt.enabled && settings.crt.curvature
          ? " eye-ballz--crt-curved"
          : ""
      }${settings.crt.enabled && settings.crt.glow ? " glow-on" : ""}${
        transparent ? " eye-ballz--transparent" : ""
      }`}
      // In windowed mode geometry is owned imperatively (see useWindowChrome); leave
      // the style prop off so React never overwrites the live left/top/width/height.
      style={windowed ? undefined : { width, height }}
    >
      {/* Calibration overlay: the forehead trigger zone, derived from the FOREHEAD_* box
          constants (container-normalized → CSS %). Origin is the center, y negative = up. */}
      {debugForehead && (
        <div
          className="eye-ballz-forehead-debug"
          style={{
            left: `${((1 - FOREHEAD_X_HALF) / 2) * 100}%`,
            width: `${FOREHEAD_X_HALF * 100}%`,
            top: `${((FOREHEAD_Y_TOP + 1) / 2) * 100}%`,
            height: `${((FOREHEAD_Y_BOTTOM - FOREHEAD_Y_TOP) / 2) * 100}%`,
          }}
        >
          <span>
            forehead zone — x±{FOREHEAD_X_HALF} y[{FOREHEAD_Y_TOP},{" "}
            {FOREHEAD_Y_BOTTOM}]
          </span>
        </div>
      )}
      {settings.crt.enabled && (
        <div
          className={`eye-ballz-crt${settings.crt.scanBar ? "" : " no-bar"}`}
          style={{
            "--crt-scanline-opacity": settings.crt.scanlineOpacity,
            "--crt-scanline-size": `${settings.crt.scanlineSize}px`,
          }}
        />
      )}
      {/* CRT bezel clip shape (after njbair's #crtPath) — always present so the
          clip-path url() resolves; only referenced when curvature is on. */}
      <svg
        className="eye-ballz-crt-defs"
        width="0"
        height="0"
        aria-hidden="true"
      >
        <clipPath
          id="eye-ballz-crt-path"
          clipPathUnits="objectBoundingBox"
          transform="scale(0.01065 0.01312)"
        >
          <path d="M47.78.5c11.65,0,38,.92,41.81,4,3.59,3,3.79,22.28,3.79,34.19,0,11.67-.08,27.79-3.53,31.24S60.3,75.69,47.78,75.69c-11.2,0-39.89-1.16-44-5.27S.57,52.42.57,38.73.31,8.56,4,4.88,34.77.5,47.78.5Z" />
        </clipPath>
      </svg>
      {windowed && (
        <>
          <div
            className="eye-ballz-titlebar"
            onPointerDown={onTitlebarPointerDown}
          >
            <span className="eye-ballz-titlebar-title">all eyez on me</span>
            {showTitlebarButtons && (
              <div className="eye-ballz-titlebar-actions">
                <button
                  className={`eye-ballz-debug-toggle${isDebug ? " active" : ""}`}
                  onClick={() => setIsDebug((d) => !d)}
                  title="Toggle debug panels"
                >
                  ⚙
                </button>
                <button
                  className="eye-ballz-pin"
                  onClick={toggleAnchor}
                  title={
                    isAnchored
                      ? "Pinned to screen — click to scroll with the page"
                      : "Scrolls with the page — click to pin to screen"
                  }
                >
                  {isAnchored ? "📌" : "📍"}
                </button>
                <button
                  className="eye-ballz-restore"
                  onClick={restoreWindow}
                  title="Restore default size & position"
                >
                  ⟲ Restore
                </button>
              </div>
            )}
          </div>
          {["n", "s", "e", "w", "ne", "nw", "se", "sw"].map((dir) => (
            <div
              key={dir}
              className={`eye-ballz-resize-handle ${dir}`}
              onPointerDown={onHandlePointerDown(dir)}
            />
          ))}
        </>
      )}
      {isDebug && renderDebug(
        <>
          <input
            className="eye-ballz-depth"
            type="range"
            min={0}
            max={5}
            step={0.1}
            value={settings.displacementScale}
            onChange={(e) => setDepth(parseFloat(e.target.value))}
          />

          <button
            className={`eye-ballz-ascii-toggle${settings.ascii.enabled ? " active" : ""}`}
            onClick={() => updateAscii({ enabled: !settings.ascii.enabled })}
          >
            ASCII: {settings.ascii.enabled ? "on" : "off"}
          </button>

          <button
            className={`eye-ballz-crt-toggle${settings.crt.enabled ? " active" : ""}`}
            onClick={() => updateCrt({ enabled: !settings.crt.enabled })}
          >
            CRT: {settings.crt.enabled ? "on" : "off"}
          </button>

          <ExpressionPanel
            expressions={hasExpressions ? expressionNames : []}
            status={status}
            onStatus={setStatus}
            gestures={gestureNames}
            onGesture={playGesture}
            autoBlink={autoBlink}
            onAutoBlink={setAutoBlink}
            animMode={animMode}
            onAnimMode={setAnimMode}
          />

          <AsciiPanel ascii={settings.ascii} onChange={updateAscii} />
          <DistortionPanel
            distortion={settings.distortion}
            onChange={updateDistortion}
          />
          <TiltPanel tilt={settings.tilt} onChange={updateTilt} />
          <CRTPanel crt={settings.crt} onChange={updateCrt} />
          <GridPanel
            value={effPreviewGrid}
            onChange={setGridOverride}
            stats={loadStats}
          />

          <div className="eye-ballz-panel eye-ballz-panel--export">
            <span className="eye-ballz-title">settings</span>
            <div className="eye-ballz-buttons">
              <button className="eye-ballz-btn" onClick={handleExport}>
                Export
              </button>
              <button className="eye-ballz-btn" onClick={handleImport}>
                Import
              </button>
            </div>
            <textarea
              className="eye-ballz-export-text"
              spellCheck={false}
              placeholder="Export copies JSON here (and to your clipboard). Paste a config and click Import."
              value={exportText || importText}
              onChange={(e) => {
                setImportText(e.target.value);
                setExportText("");
              }}
            />
          </div>

          {photos.length > 1 && (
            <div className="eye-ballz-switcher">
              {photos.map((p) => (
                <button
                  key={p.key}
                  className={`eye-ballz-switcher-btn${p.key === activeKey ? " active" : ""}`}
                  onClick={() => setActiveKey(p.key)}
                >
                  {p.thumbnail && <img src={p.thumbnail} alt={p.key} />}
                  <span>{p.key}</span>
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// forwardRef so parents can grab an imperative handle (playGesture / setExpression /
// getGestures / getExpressions) while the component stays a normal named export.
export const EyeBallzViewer = forwardRef(EyeBallzViewerInner);
