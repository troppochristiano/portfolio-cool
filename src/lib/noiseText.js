// The site's shared text-noise engine. One alphabet, one flicker cadence, and
// one width-lock protocol for every glyph-scramble effect (nav pill hover,
// menu ⇄ close swap, About headline type-on, works-title burst, brand-mark
// phrase cycler, cursor pet glitches) — "same cadence as ScrambleText" is now
// structural instead of a promise repeated in comments.

// Caps + digits + the classic ASCII luminance ramp's glyphs (createConstants
// RAMP_PRESETS.classic) — the same noise the site renders media with. The
// pills are text-transform:uppercase, so lowercase would display as caps
// anyway; the pool stays caps to keep measurements honest.
export const POOL = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789:-=+*#%@$&";

// Flicker cadence: min hold per random glyph, plus per-glyph jitter so cells
// don't flip in lockstep.
export const SWAP_MS = 34;
export const SWAP_JITTER_MS = 26;

export const randGlyph = () => POOL[(Math.random() * POOL.length) | 0];

// ── width lock ───────────────────────────────────────────────────────────
// The main face is mono, but its fallbacks aren't guaranteed to be, so noise
// glyphs could nudge their neighbours mid-effect. While an effect runs, every
// cell is frozen at the advance measured from the real laid-out glyphs; idle,
// the cells are plain inline text with zero layout impact.

// Measure every cell (one layout pass, before any write) and freeze it at its
// natural advance. Returns the rects, or null when the cells aren't laid out
// (hidden/unsized frame) — locking to 0px would collapse the label, so
// callers skip the effect instead.
export function lockCellWidths(cells) {
  const rects = cells.map((c) => c.getBoundingClientRect());
  if (!rects.length || rects[0].width === 0) return null;
  cells.forEach((c, i) => {
    c.style.width = `${rects[i].width}px`;
  });
  return rects;
}

export function clearCellWidths(cells) {
  for (const c of cells) c.style.width = "";
}

// Flood every non-space cell with pool noise — the resting state a resolve
// front then sweeps over.
export function floodNoise(cells, target) {
  cells.forEach((c, i) => {
    if (target[i] !== " ") c.textContent = randGlyph();
  });
}

// ── sweep resolve ────────────────────────────────────────────────────────
// Wall-clock left→right front (a throttled tab still lands the swap in
// ~sweepMs): resolved text behind it, flickering noise ahead of it. With
// `fringe` ({head, opacityMax, opacityMin}) only a short window ahead of the
// front flickers, fading toward its tip, and everything beyond it is hidden —
// DecryptText's type-on. Returns a cancel function; `onDone` fires once the
// front has crossed the last cell (not on cancel).
export function sweepResolve({ cells, target, sweepMs, fringe = null, onDone }) {
  const n = cells.length;
  const t0 = performance.now();
  const nextSwap = new Array(n).fill(0);
  let rafId = 0;
  const tick = (now) => {
    const front = ((now - t0) / sweepMs) * n;
    for (let i = 0; i < n; i++) {
      const c = cells[i];
      if (i < front) {
        // Behind the front: the real glyph, solid — no per-cell boil.
        if (c.textContent !== target[i]) c.textContent = target[i];
        if (fringe && c.style.opacity !== "") c.style.opacity = "";
      } else if (!fringe) {
        if (target[i] !== " " && now >= nextSwap[i]) {
          c.textContent = randGlyph();
          nextSwap[i] = now + SWAP_MS + Math.random() * SWAP_JITTER_MS;
        }
      } else if (i < front + fringe.head && target[i] !== " ") {
        // The fringe: flickering noise, dimming toward its tip.
        if (now >= nextSwap[i]) {
          c.textContent = randGlyph();
          nextSwap[i] = now + SWAP_MS + Math.random() * SWAP_JITTER_MS;
        }
        const fade = (i - front) / fringe.head; // 0 at the front → 1 at the tip
        c.style.opacity = String(
          fringe.opacityMax - fade * (fringe.opacityMax - fringe.opacityMin)
        );
      } else if (c.style.opacity !== "0") {
        c.style.opacity = "0"; // not reached yet (or a fringe space): empty
      }
    }
    if (front < n) {
      rafId = requestAnimationFrame(tick);
    } else {
      rafId = 0;
      onDone?.();
    }
  };
  rafId = requestAnimationFrame(tick);
  return () => {
    if (rafId) cancelAnimationFrame(rafId);
    rafId = 0;
  };
}
