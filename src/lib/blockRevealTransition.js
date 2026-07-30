// Block-reveal route transition, styled after the About overlay's glyph
// dissolve (useDissolveReveal.js): 16px cells flash in as blue tiles with
// random white ASCII glyphs at the animation frontier, then settle to solid
// black to cover the screen while RouteTransition swaps the outlet; the
// reveal reverses it. One canvas instead of DOM blocks — at this cell size a
// full viewport is thousands of cells. Registers itself into the
// pageTransitions seam on import — main.jsx pulls it in for the side effect.
import gsap from "gsap";
import { setPageTransitions } from "./pageTransitions.js";
import { clampedDpr, prefersReducedMotion } from "./utils.js";
import { CELL_SIZE, paintGlyphCell, randChar, setGlyphFont } from "./dissolveTheme.js";

const COVER_FILL = "#0f0f0f";
// Fraction of normalized progress a cell spends as a glyph tile before
// settling; the per-cell random thresholds supply the scatter.
const FLASH = 0.15;

let canvas = null;
let ctx = null;
let cols = 0;
let rows = 0;
let thresholds = null; // Float32Array — per-cell random reveal order
let chars = []; // per-cell glyph
let black = null; // Uint8Array — is the cell currently part of the cover?
let currentTween = null;
let pendingResolve = null;
let tweenEndCovered = false;
// Whole-screen cover state between tweens (e.g. during enter's await gap) —
// a resize rebuild must repaint it, not assume the grid is idle-clear.
let covered = false;

function paintFromState() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = COVER_FILL;
  for (let i = 0; i < black.length; i++) {
    if (black[i]) {
      ctx.fillRect((i % cols) * CELL_SIZE, Math.floor(i / cols) * CELL_SIZE, CELL_SIZE, CELL_SIZE);
    }
  }
}

function setAll(coveredState) {
  covered = coveredState;
  black.fill(coveredState ? 1 : 0);
  paintFromState();
}

// Size of the last build — lets pinch-driven resize events (which don't change
// the layout viewport) bail out instead of rebuilding.
let builtW = 0;
let builtH = 0;
let builtDpr = 0;

function buildGrid() {
  // Layout viewport, NOT window.innerWidth/Height: iOS Safari reports the
  // visual viewport there and fires resize during pinch zoom, so zooming into
  // the ascii art used to rebuild the grid at the zoomed-in size — the fixed
  // 100%-sized canvas then stretched those few cells across the whole screen
  // (giant blocks on the next route change). clientWidth/Height of the root
  // element are pinch-immune; rotation and address-bar changes still differ.
  const vw = document.documentElement.clientWidth;
  const vh = document.documentElement.clientHeight;
  // Cap at 2: this full-viewport singleton's backing store lives for the whole
  // session, and at raw DPR 3 a phone holds ~12MB of GPU memory (and paints
  // 2.25× the pixels per transition frame) for chunky cells that can't show
  // the extra resolution anyway.
  const dpr = clampedDpr(2);
  // Same geometry as the current grid: keep it — a rebuild here would also
  // kill an in-flight tween via settle() for nothing.
  if (vw === builtW && vh === builtH && dpr === builtDpr) return;
  builtW = vw;
  builtH = vh;
  builtDpr = dpr;
  canvas.width = vw * dpr;
  canvas.height = vh * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  cols = Math.ceil(vw / CELL_SIZE);
  rows = Math.ceil(vh / CELL_SIZE);
  const count = cols * rows;
  thresholds = new Float32Array(count);
  chars = new Array(count);
  black = new Uint8Array(count);
  for (let i = 0; i < count; i++) {
    thresholds[i] = Math.random();
    chars[i] = randChar();
  }

  // Resize mid-tween: the grid the tween was painting is gone, so jump-cut to
  // where it was heading and release the awaiting RouteTransition run.
  const target = currentTween ? tweenEndCovered : covered;
  if (currentTween) settle();
  setAll(target);
}

function ensureGrid() {
  if (canvas) return;
  canvas = document.createElement("canvas");
  canvas.className = "transition-grid";
  document.body.appendChild(canvas);
  ctx = canvas.getContext("2d");
  buildGrid();
  // Singleton for the app's lifetime — never torn down, so no removal needed.
  window.addEventListener("resize", buildGrid);
}

// Killed tweens never fire onComplete, so resolve the abandoned await
// ourselves — RouteTransition's stale run bails right after it.
function settle() {
  currentTween?.kill();
  currentTween = null;
  pendingResolve?.();
  pendingResolve = null;
}

// One frame at progress p ∈ [0, 1+FLASH]. Cells the frontier hasn't reached
// keep their current black[] state (not an assumed empty/full screen) — that's
// what makes a leave that interrupts a half-finished reveal seamless.
function draw(p, cover) {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  setGlyphFont(ctx);
  for (let i = 0; i < black.length; i++) {
    const t = thresholds[i];
    const x = (i % cols) * CELL_SIZE;
    const y = Math.floor(i / cols) * CELL_SIZE;
    if (p >= t + FLASH) black[i] = cover ? 1 : 0;
    if (p >= t && p < t + FLASH) {
      paintGlyphCell(ctx, x, y, chars[i]);
    } else if (black[i]) {
      ctx.fillStyle = COVER_FILL;
      ctx.fillRect(x, y, CELL_SIZE, CELL_SIZE);
    }
  }
}

function run(cover, delay) {
  tweenEndCovered = cover;
  return new Promise((resolve) => {
    pendingResolve = resolve;
    const state = { p: 0 };
    currentTween = gsap.to(state, {
      p: 1 + FLASH,
      duration: 0.6,
      delay,
      // Linear on purpose — the random per-cell thresholds are the stagger,
      // same as useDissolveReveal's band tween.
      ease: "none",
      onUpdate: () => draw(state.p, cover),
      onComplete: () => {
        covered = cover;
        currentTween = null;
        pendingResolve = null;
        resolve();
      },
    });
  });
}

function leave(_el, _ctx) {
  ensureGrid();
  settle();
  if (prefersReducedMotion()) {
    setAll(true);
    return Promise.resolve();
  }
  return run(true, 0);
}

function enter(_el, _ctx) {
  ensureGrid();
  settle();
  // Full cover before revealing — heals any partial state from an interrupt.
  setAll(true);
  if (prefersReducedMotion()) {
    setAll(false);
    return Promise.resolve();
  }
  // The 0.3s hold keeps the cover up while the new page mounts (and typically
  // masks the lazy Gallery chunk load).
  return run(false, 0.3);
}

// Navigation snapped back to the page already shown (back button mid-leave):
// no enter() will ever reveal, so drop the in-flight cover entirely.
function cancel() {
  if (!canvas) return;
  settle();
  setAll(false);
}

setPageTransitions({ leave, enter, cancel });
