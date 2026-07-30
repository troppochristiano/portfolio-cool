import { useEffect, useRef } from "react";
import { lastPointer } from "../lib/lastPointer.js";
import { clamp, prefersReducedMotion } from "../lib/utils.js";

// Interactive ascii liquid for the Contact footer: a classic two-buffer
// wave-equation ripple grid rendered as glyphs. The surface is invisible at
// rest — moving the pointer over the section presses the surface down and
// the rebound rings out as ascii ripples that decay to black in ~2s. The
// rAF loop is gated on the fluid's remaining energy, so the sim structurally
// cannot run at idle (the effects-on-interaction-only house rule).
//
// The canvas is pointer-events:none and the pointer listeners sit on the
// overlay's inner wrapper, so the mailto/social links stay fully clickable
// and still stir the liquid as the cursor crosses them. Mouse and touch
// both play: move/drag = wake, click/tap = splash, scroll-under-a-resting-
// mouse = wake (touch is exempt from scroll-stir — no finger, no contact).

// ── Tunables ────────────────────────────────────────────────────────────
const CELL = 14; // px per grid cell (matches the portrait's chunk size)
const FONT_SIZE = 12.5;
const FONT_FAMILY = '"PP Neue Montreal Mono", ui-monospace, monospace';
const MAX_DPR = 2;

const DAMPING = 0.93; // energy retained per step; ~2s ring-out after a stir
const STOP_EPS = 0.008; // max |height| below which the loop stops itself
const AMP_MAX = 1.2; // |height| that maps to the densest glyph
const GLYPH_GAMMA = 0.7; // <1 lifts faint ripples into visibility

const SPLAT_RADIUS = 2; // grid cells; cosine-falloff press per stamp
const SPEED_AMP = 0.35; // pointer speed (cells/event) → press amplitude
const AMP_MIN = 0.15;
const AMP_PEAK = 2.0;
const CLICK_AMP = 3.0; // a click plunges deeper than any drag…
const CLICK_RADIUS = 4; // …and wider, so it throws a full ring

const RAMP = " ·:;+=xX#@"; // index 0 = empty water, never drawn
const COLOR_LOW = "#2b2bd6"; // dim blue — faint outer rings
const COLOR_MID = "#0000ff"; // site blue — body of the wake, troughs
const COLOR_HIGH = "#7f7fff"; // bright blue — cresting peaks

export function ContactLiquid({ active }) {
  // Touch is welcome here (tap = splash, drag = wake — scrolling still
  // wins vertical gestures via the scroller's touch-action); only reduced
  // motion opts the whole effect out.
  const disabled = prefersReducedMotion();

  const canvasRef = useRef(null);
  const stateRef = useRef(null);
  const activeRef = useRef(active);
  const rafRef = useRef(0);
  const lastRef = useRef(null); // previous pointer cell, null when outside

  // Imperative helpers close over refs only (portrait-hover structure).

  // One wave-equation pass: neighbour average minus previous height, damped.
  // Writes into prev then swaps, keeping a 1-cell dead border so waves die
  // at the edges without per-cell bounds checks. Returns the peak amplitude
  // so the loop knows when the surface has settled.
  const step = (st) => {
    const { curr, prev, cols, rows } = st;
    let maxAmp = 0;
    for (let r = 1; r < rows - 1; r++) {
      let i = r * cols + 1;
      for (let c = 1; c < cols - 1; c++, i++) {
        const v =
          ((curr[i - 1] + curr[i + 1] + curr[i - cols] + curr[i + cols]) / 2 -
            prev[i]) *
          DAMPING;
        prev[i] = v;
        const a = v < 0 ? -v : v;
        if (a > maxAmp) maxAmp = a;
      }
    }
    st.prev = curr;
    st.curr = prev;
    return maxAmp;
  };

  const draw = (st) => {
    const { ctx, curr, cols, rows } = st;
    ctx.clearRect(0, 0, st.w, st.h);
    // Bucket draws by colour so each frame pays three fillStyle swaps, not
    // one per glyph. Buckets are flat [x, y, char] triples, reused.
    const [low, mid, high] = st.buckets;
    low.length = mid.length = high.length = 0;
    const maxIdx = RAMP.length - 1;
    for (let r = 1; r < rows - 1; r++) {
      let i = r * cols + 1;
      // -1: grid cell (1,1) paints at the canvas origin (overscan border).
      const y = (r - 1) * CELL + st.baseline;
      for (let c = 1; c < cols - 1; c++, i++) {
        const hgt = curr[i];
        const a = hgt < 0 ? -hgt : hgt;
        const t = a >= AMP_MAX ? 1 : a / AMP_MAX;
        const idx = Math.round(Math.pow(t, GLYPH_GAMMA) * maxIdx);
        if (idx === 0) continue;
        // Crest/trough split on the hot tier keeps peaks reading as light
        // catching the surface while troughs stay solid blue.
        const bucket = t < 0.35 ? low : t < 0.7 ? mid : hgt > 0 ? high : mid;
        bucket.push((c - 1) * CELL + CELL / 2, y, RAMP[idx]);
      }
    }
    ctx.font = st.font;
    ctx.fillStyle = COLOR_LOW;
    for (let j = 0; j < low.length; j += 3)
      ctx.fillText(low[j + 2], low[j], low[j + 1]);
    ctx.fillStyle = COLOR_MID;
    for (let j = 0; j < mid.length; j += 3)
      ctx.fillText(mid[j + 2], mid[j], mid[j + 1]);
    ctx.fillStyle = COLOR_HIGH;
    for (let j = 0; j < high.length; j += 3)
      ctx.fillText(high[j + 2], high[j], high[j + 1]);
  };

  const ensureLoop = () => {
    if (rafRef.current) return;
    const tick = () => {
      const st = stateRef.current;
      if (!st || !activeRef.current) {
        rafRef.current = 0;
        return;
      }
      const maxAmp = step(st);
      draw(st);
      if (maxAmp > STOP_EPS) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        // Settled: wipe the sub-visible residue and stop. Next pointermove
        // restarts the loop.
        st.ctx.clearRect(0, 0, st.w, st.h);
        rafRef.current = 0;
      }
    };
    rafRef.current = requestAnimationFrame(tick);
  };

  // Disturb the surface at a viewport position — shared by real pointermove
  // and the no-move triggers (scroll sliding the section under a resting
  // cursor, the overlay revealing under it). Outside the canvas: just
  // forget the trail so re-entry doesn't stamp a cross-section segment.
  const stir = (clientX, clientY) => {
    const st = stateRef.current;
    const canvas = canvasRef.current;
    if (!st || !canvas || !activeRef.current) return;
    const rect = canvas.getBoundingClientRect();
    if (rect.width === 0) return;
    if (
      clientX < rect.left ||
      clientX > rect.right ||
      clientY < rect.top ||
      clientY > rect.bottom
    ) {
      lastRef.current = null;
      return;
    }
    // +1: the visible canvas starts at grid cell 1 (overscan border).
    const col = (clientX - rect.left) / CELL + 1;
    const row = (clientY - rect.top) / CELL + 1;
    const last = lastRef.current;
    if (last) {
      const dc = col - last.col;
      const dr = row - last.row;
      const speed = Math.hypot(dc, dr);
      // A scroll tick elsewhere can fire with zero relative motion here —
      // still water stays still.
      if (speed > 0) {
        const amp = clamp(speed * SPEED_AMP, AMP_MIN, AMP_PEAK);
        // Stamp along the segment from the last position so fast sweeps
        // leave a continuous wake instead of beads.
        const steps = Math.max(1, Math.ceil(speed));
        for (let s = 1; s <= steps; s++) {
          const t = s / steps;
          stamp(st, last.col + dc * t, last.row + dr * t, amp);
        }
        ensureLoop();
      }
    } else {
      stamp(st, col, row, AMP_MIN);
      ensureLoop();
    }
    lastRef.current = { col, row };
  };

  // Press the surface down around (col,row) with a cosine falloff.
  const stamp = (st, col, row, amp, radius = SPLAT_RADIUS) => {
    const { curr, cols, rows } = st;
    const c0 = Math.round(col);
    const r0 = Math.round(row);
    for (let dy = -radius; dy <= radius; dy++) {
      const r = r0 + dy;
      if (r < 1 || r >= rows - 1) continue;
      for (let dx = -radius; dx <= radius; dx++) {
        const c = c0 + dx;
        if (c < 1 || c >= cols - 1) continue;
        const d = Math.hypot(dx, dy);
        if (d > radius) continue;
        curr[r * cols + c] -=
          amp * Math.cos((d / (radius + 0.5)) * (Math.PI / 2));
      }
    }
  };

  // A click is a plunge: one deep, wide press at the point — the rebound
  // throws a full ring regardless of whether the pointer was moving.
  const splash = (clientX, clientY) => {
    const st = stateRef.current;
    const canvas = canvasRef.current;
    if (!st || !canvas || !activeRef.current) return;
    const rect = canvas.getBoundingClientRect();
    if (rect.width === 0) return;
    if (
      clientX < rect.left ||
      clientX > rect.right ||
      clientY < rect.top ||
      clientY > rect.bottom
    )
      return;
    const col = (clientX - rect.left) / CELL + 1;
    const row = (clientY - rect.top) / CELL + 1;
    stamp(st, col, row, CLICK_AMP, CLICK_RADIUS);
    // Seed the trail at the press point so a touch-drag wakes from here
    // instead of stamping a segment from wherever the last touch ended.
    lastRef.current = { col, row };
    ensureLoop();
  };

  // Build the grid from the canvas's own box (it bleeds past the section
  // into the overlay gutters); rebuild (fresh, flat surface) on resize —
  // dropping in-flight ripples there is fine.
  useEffect(() => {
    if (disabled) return undefined;
    const canvas = canvasRef.current;
    if (!canvas) return undefined;

    const setupCtx = (st) => {
      const { ctx } = st;
      ctx.setTransform(st.dpr, 0, 0, st.dpr, 0, 0);
      ctx.textAlign = "center";
      ctx.textBaseline = "alphabetic";
      ctx.font = st.font;
      const m = ctx.measureText("X");
      const glyphH = m.actualBoundingBoxAscent + m.actualBoundingBoxDescent;
      st.baseline = CELL / 2 + glyphH / 2 - m.actualBoundingBoxDescent;
    };

    const build = () => {
      lastRef.current = null;
      const rect = canvas.getBoundingClientRect();
      // Overlay hidden / not laid out yet: wait for a real box (the resize
      // observer fires again once there is one).
      if (rect.width < CELL * 4 || rect.height < CELL * 4) {
        stateRef.current = null;
        return;
      }
      // Overscan one cell past every edge: the sim's dead border and the
      // cell-rounding leftover land OFF-canvas, so the water reaches every
      // visible pixel (on phones the ~2-cell dark rim read as a margin).
      const cols = Math.ceil(rect.width / CELL) + 2;
      const rows = Math.ceil(rect.height / CELL) + 2;
      const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
      canvas.width = Math.round(rect.width * dpr);
      canvas.height = Math.round(rect.height * dpr);
      const st = {
        ctx: canvas.getContext("2d"),
        cols,
        rows,
        dpr,
        w: rect.width,
        h: rect.height,
        curr: new Float32Array(cols * rows),
        prev: new Float32Array(cols * rows),
        buckets: [[], [], []],
        font: `${FONT_SIZE}px ${FONT_FAMILY}`,
        baseline: 0,
      };
      stateRef.current = st;
      setupCtx(st);
    };

    build();
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
      build();
    });
    ro.observe(canvas);

    // The mono font may land after first build — remeasure the baseline.
    let alive = true;
    document.fonts?.ready?.then(() => {
      if (alive && stateRef.current) setupCtx(stateRef.current);
    });

    return () => {
      alive = false;
      ro.disconnect();
      cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
      stateRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [disabled]);

  // Pointer + scroll → disturbance. The pointer listener sits on the
  // overlay's inner wrapper so the gutter strips the canvas bleeds into
  // still feed the sim (the canvas itself is pointer-events:none). The
  // capture-phase scroll listener is the no-move trigger: the section
  // sliding under a resting cursor is relative motion too.
  useEffect(() => {
    if (disabled) return undefined;
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const host =
      canvas.closest(".about-overlay__inner") || canvas.parentElement;
    if (!host) return undefined;

    const onMove = (e) => stir(e.clientX, e.clientY);
    const onDown = (e) => splash(e.clientX, e.clientY);
    const onScroll = () => {
      // Scroll-under-stir is a hover nicety: a mouse is still there after
      // the event, a lifted finger isn't — momentum scrolling must not
      // churn water at a stale touch point.
      const p = lastPointer();
      if (p && p.type !== "touch") stir(p.x, p.y);
    };
    // A gone pointer forgets the trail. Mouse: only on leave (it keeps
    // hovering after a click release). Touch: on up, and on cancel — the
    // scroller claiming a vertical drag ends the water contact too.
    const onGone = () => {
      lastRef.current = null;
    };
    const onUp = (e) => {
      if (e.pointerType !== "mouse") lastRef.current = null;
    };

    host.addEventListener("pointermove", onMove);
    host.addEventListener("pointerdown", onDown);
    host.addEventListener("pointerleave", onGone);
    host.addEventListener("pointerup", onUp);
    host.addEventListener("pointercancel", onGone);
    document.addEventListener("scroll", onScroll, {
      capture: true,
      passive: true,
    });
    return () => {
      host.removeEventListener("pointermove", onMove);
      host.removeEventListener("pointerdown", onDown);
      host.removeEventListener("pointerleave", onGone);
      host.removeEventListener("pointerup", onUp);
      host.removeEventListener("pointercancel", onGone);
      document.removeEventListener("scroll", onScroll, { capture: true });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [disabled]);

  // Hard stop when the overlay closes mid-ripple: flatten the surface and
  // clear, so reopening shows still water.
  useEffect(() => {
    activeRef.current = active;
    if (active) {
      // A cursor already resting over the water when the overlay settles
      // counts as contact — stir once without waiting for a move. Not for
      // touch: a past tap doesn't mean a finger is there now.
      const p = lastPointer();
      if (p && p.type !== "touch") stir(p.x, p.y);
    } else {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
      lastRef.current = null;
      const st = stateRef.current;
      if (st) {
        st.curr.fill(0);
        st.prev.fill(0);
        st.ctx.clearRect(0, 0, st.w, st.h);
      }
    }
  }, [active]);

  if (disabled) return null;
  return <canvas ref={canvasRef} className="contact-liquid" aria-hidden="true" />;
}
