import { useEffect, useState } from 'react';
import { convertFrame, computeRows, SUPERSAMPLE } from '../create/asciify.js';
import { RAMP_PRESETS } from '../create/createConstants.js';
import { downsampleFigure } from '../lib/downsampleFigure.js';
import { LIGHT_CHARS, FALLBACK_POOL } from './useAsciiDecode.js';

// Converts a raster image into the pair of figures the gallery decode effect
// (useAsciiDecode) consumes: a dense single-frame `display` figure plus the
// sparse thumb it sharpens up from. Same pipeline as the Create tool's bake
// (supersampled draw → block-averaging convertFrame), so the About portrait
// reads like a gallery figure rather than a one-off renderer.
//
// The source portrait (an eyeballz face texture) is dark features on a
// near-white ground, so the conversion inverts: features → dense glyphs,
// ground → blank — the right polarity for white-on-black. gamma/contrast push
// the inverted background below the first quantization step so it renders as
// clean space (chroma-keying the white would eat the skin highlights instead).

const RAMP = RAMP_PRESETS.classic;
const GAMMA = 1.4;
const CONTRAST = 1.15;

// Ambient boil: the figure ships as a short loop instead of one still frame —
// frame 0 is the clean bake (what the decode targets, and what reduced motion
// pins to), the rest keep a small share of dense cells flickering. The decode
// hands the real figure over when it finishes, and AsciiPlayer autoplays any
// multi-frame figure, so the reveal settles straight into the loop: the "last
// stage" of the boil, held forever.
const BOIL_FRAMES = 12; // loop length (plus the clean frame 0)
const BOIL_SHARE = 0.02; // share of dense cells boiling at any moment
const BOIL_FPS = 10; // ≈ the decode's ~90ms re-roll cadence

// Bake the loop frames. Boils flicker in place for 1–3 frames then move on
// (matching the decode's localized boiling spots, not per-frame confetti);
// the pool is the figure's own dense glyphs so the texture stays its own.
function buildBoilFrames(baseFrame, cols, rows) {
  const lines = baseFrame.split('\n');
  const dense = [];
  const poolSet = new Set();
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const ch = lines[r][c] ?? ' ';
      if (!LIGHT_CHARS.has(ch)) {
        dense.push(r * cols + c);
        poolSet.add(ch);
      }
    }
  }
  if (dense.length === 0) return []; // nothing dense enough to boil
  const pool = poolSet.size > 0 ? [...poolSet] : [...FALLBACK_POOL];
  const target = Math.max(1, Math.round(dense.length * BOIL_SHARE));

  const active = new Map(); // cell index -> frames left to boil
  const frames = [];
  for (let f = 0; f < BOIL_FRAMES; f++) {
    for (const [idx, left] of [...active]) {
      if (left <= 1) active.delete(idx);
      else active.set(idx, left - 1);
    }
    while (active.size < target) {
      const idx = dense[Math.floor(Math.random() * dense.length)];
      if (!active.has(idx)) active.set(idx, 1 + Math.floor(Math.random() * 3));
    }
    const grid = lines.map((l) => l.split(''));
    for (const idx of active.keys()) {
      grid[Math.floor(idx / cols)][idx % cols] =
        pool[Math.floor(Math.random() * pool.length)];
    }
    frames.push(grid.map((row) => row.join('')).join('\n'));
  }
  return frames;
}

export function useAsciiPortrait(src, { cols = 120, thumbCols = 30 } = {}) {
  const [data, setData] = useState(null);

  useEffect(() => {
    let alive = true;
    setData(null);
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => {
      if (!alive) return;
      const rows = computeRows(img.naturalWidth, img.naturalHeight, cols);
      const w = cols * SUPERSAMPLE;
      const h = rows * SUPERSAMPLE;
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      // Squashing the image onto the half-height grid IS the cell-aspect
      // compensation — computeRows already halved the rows for it.
      ctx.drawImage(img, 0, 0, w, h);
      const frame = convertFrame(ctx.getImageData(0, 0, w, h).data, w, h, {
        cols,
        rows,
        ramp: RAMP,
        invert: true,
        gamma: GAMMA,
        contrast: CONTRAST,
        dither: 'floyd',
      });
      const display = {
        cols,
        rows,
        fps: BOIL_FPS,
        color: false,
        frames: [frame, ...buildBoilFrames(frame, cols, rows)],
      };
      // The thumb stays a single clean frame: it renders while the overlay is
      // closed (hidden but mounted), and a multi-frame thumb would keep an
      // AsciiPlayer rAF loop rewriting glyphs nobody can see.
      const thumbFigure = downsampleFigure(
        { ...display, fps: 1, frames: [frame] },
        thumbCols,
      );
      // One setState for all three shapes → stable identities. item/display
      // are useAsciiDecode effect deps; a fresh object per render would
      // restart the decode mid-boil.
      setData({
        display,
        thumbFigure,
        item: {
          thumb: thumbFigure.frames[0],
          thumbCols: thumbFigure.cols,
          thumbRows: thumbFigure.rows,
        },
      });
    };
    // Decorative portrait — a failed load just leaves the column empty.
    img.onerror = () => {};
    img.src = src;
    return () => {
      alive = false;
    };
  }, [src, cols, thumbCols]);

  return data;
}
