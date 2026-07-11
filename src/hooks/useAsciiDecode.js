import { useEffect, useState } from 'react';
import { prefersReducedMotion } from '../lib/utils.js';

// Scramble-decode reveal for gallery cards, after the CodeGrid ascii-reveal
// effect (cells resolve in a random order; "dense" cells boil through random
// glyphs before settling; light cells snap straight to their final char) —
// minus its final image swap, and starting from the card's visible thumb
// instead of an empty canvas: the low-res art is nearest-neighbor upscaled
// onto the full-resolution grid, so the card never goes blank — it sharpens.
//
// The animation drives AsciiPlayer from the outside: each tick produces a
// synthetic single-frame copy of `display` (same cols/rows/style, so the
// player's measured scale never changes mid-decode) and the finished reveal
// hands the real `display` over — multi-frame figures then autoplay in place.
//
// All progression is WALL-CLOCK based, not tick-count based: on phones the
// per-tick <pre> relayout (× several cards decoding at once) stretches the
// interval well past TICK_MS, and a tick-counted boil then churned for many
// seconds without ever reaching the settled art. Deadlines in ms make the
// whole decode land in ~REVEAL_MS + BOIL_MAX_MS regardless of tick lag —
// laggy devices just see fewer, bigger steps.

const TICK_MS = 45; // target cadence of composed <pre> rewrites (~22fps)
const REVEAL_MS = 550; // the random cell sweep, end to end
const SCRAMBLE_EVERY = 2; // boiling cells re-roll every Nth tick (~90ms)
const BOIL_MIN_MS = 220; // how long a dense cell boils before settling…
const BOIL_MAX_MS = 550; // …randomized per cell within this window
const MAX_DECODE_MS = 5000; // wall-clock safety net (throttled/background tabs)

// Characters that read as "light" — they appear instantly, like the sparse
// half of the reference ramp; everything else scrambles before settling.
const LIGHT_CHARS = new Set([' ', '.', ',', ':', ';', "'", '`', '^', '"', '-', '_']);
const FALLBACK_POOL = '#@$%&*+=xX0369';

// Nearest-neighbor upscale of a small text grid onto rows×cols — the blocky
// starting state that matches what the thumb already shows on the card.
function upscaleGrid(srcText, srcCols, srcRows, cols, rows) {
  const src = String(srcText ?? '').split('\n');
  const out = [];
  for (let r = 0; r < rows; r++) {
    const sr = src[Math.floor((r * srcRows) / rows)] ?? '';
    const row = new Array(cols);
    for (let c = 0; c < cols; c++) {
      row[c] = sr[Math.floor((c * srcCols) / cols)] ?? ' ';
    }
    out.push(row);
  }
  return out;
}

function gridFromText(text, cols, rows) {
  const lines = String(text ?? '').split('\n');
  const out = [];
  for (let r = 0; r < rows; r++) {
    const line = lines[r] ?? '';
    const row = new Array(cols);
    for (let c = 0; c < cols; c++) row[c] = line[c] ?? ' ';
    out.push(row);
  }
  return out;
}

// Fisher–Yates over a cell-index array — the random reveal order.
function shuffledIndices(count) {
  const order = new Uint32Array(count);
  for (let i = 0; i < count; i++) order[i] = i;
  for (let i = count - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const t = order[i];
    order[i] = order[j];
    order[j] = t;
  }
  return order;
}

/**
 * `active`  — the card is hovered (fine pointer) / in view (coarse pointer)
 * `item`    — gallery row (thumb, thumbCols/Rows, optional edgeThumb)
 * `display` — the figure the card should settle on (full or mobile-capped),
 *             null while the fetch is in flight
 *
 * Returns the data object AsciiPlayer should render right now, or null for
 * "show the thumb" (idle, or full JSON still loading).
 */
export function useAsciiDecode({ active, item, display }) {
  const [shown, setShown] = useState(null);

  useEffect(() => {
    if (!active || !display) {
      setShown(null);
      return;
    }
    // Color figures are HTML span runs (no per-char access) and reduced
    // motion wants no boil — instant swap, the pre-decode behavior.
    if (display.color || prefersReducedMotion()) {
      setShown(display);
      return;
    }

    const { cols, rows } = display;
    const target = gridFromText(display.frames[0], cols, rows);
    const hasEdges = Array.isArray(display.edgeFrames) && display.edgeFrames.length > 0;
    const edgeTarget = hasEdges ? gridFromText(display.edgeFrames[0], cols, rows) : null;

    // Start = the thumb the card is already showing, upscaled to the target
    // grid (never a blank card). The edge layer starts from its own thumb
    // when one shipped, else builds up from nothing as cells settle.
    const grid = upscaleGrid(item.thumb, item.thumbCols, item.thumbRows, cols, rows);
    const edgeGrid = hasEdges
      ? item.edgeThumb
        ? upscaleGrid(item.edgeThumb, item.thumbCols, item.thumbRows, cols, rows)
        : gridFromText('', cols, rows)
      : null;

    // Scramble pool: the dense glyphs of the figure itself, so the boil keeps
    // its texture (fallback for figures made entirely of light chars).
    const poolSet = new Set();
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const ch = target[r][c];
        if (!LIGHT_CHARS.has(ch)) poolSet.add(ch);
      }
    }
    const pool = poolSet.size > 0 ? [...poolSet] : [...FALLBACK_POOL];

    const total = cols * rows;
    const order = shuffledIndices(total);
    // Per-cell boil deadline (ms since t0): -1 = not yet revealed, 0 =
    // settled, >0 = boiling until that time.
    const settleAt = new Float64Array(total).fill(-1);

    let revealed = 0;
    let boiling = 0;
    let tickCount = 0;
    const t0 = performance.now();

    const compose = () => ({
      ...display,
      fps: 1,
      frames: [grid.map((row) => row.join('')).join('\n')],
      ...(hasEdges
        ? { edgeFrames: [edgeGrid.map((row) => row.join('')).join('\n')] }
        : {}),
    });

    const settle = (idx) => {
      const r = Math.floor(idx / cols);
      const c = idx % cols;
      grid[r][c] = target[r][c];
      if (edgeGrid) edgeGrid[r][c] = edgeTarget[r][c];
      settleAt[idx] = 0;
    };

    const timer = setInterval(() => {
      tickCount++;
      const elapsed = performance.now() - t0;
      const forceFinish = elapsed > MAX_DECODE_MS;
      let dirty = false;

      // Random-order sweep, positioned by elapsed time: light cells settle on
      // arrival, dense cells start boiling with a per-cell deadline.
      const sweepTarget = forceFinish
        ? total
        : Math.min(total, Math.ceil((elapsed / REVEAL_MS) * total));
      while (revealed < sweepTarget) {
        const idx = order[revealed++];
        const r = Math.floor(idx / cols);
        const c = idx % cols;
        if (forceFinish || LIGHT_CHARS.has(target[r][c])) {
          settle(idx);
        } else {
          grid[r][c] = pool[Math.floor(Math.random() * pool.length)];
          if (edgeGrid) edgeGrid[r][c] = ' ';
          settleAt[idx] =
            elapsed + BOIL_MIN_MS + Math.random() * (BOIL_MAX_MS - BOIL_MIN_MS);
          boiling++;
        }
        dirty = true;
      }

      // Boil pass: re-roll scrambling cells, settling the ones whose deadline
      // has passed — however late the tick arrives.
      if (boiling > 0) {
        const reroll = forceFinish || tickCount % SCRAMBLE_EVERY === 0;
        for (let idx = 0; idx < total; idx++) {
          const at = settleAt[idx];
          if (at <= 0) continue;
          if (forceFinish || elapsed >= at) {
            settle(idx);
            boiling--;
            dirty = true;
          } else if (reroll) {
            grid[Math.floor(idx / cols)][idx % cols] =
              pool[Math.floor(Math.random() * pool.length)];
            dirty = true;
          }
        }
      }

      if (revealed >= total && boiling === 0) {
        clearInterval(timer);
        setShown(display); // the real figure — clips take over and play
        return;
      }
      if (dirty) setShown(compose());
    }, TICK_MS);

    return () => clearInterval(timer);
  }, [active, display, item]);

  return shown;
}
