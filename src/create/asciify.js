/**
 * Core media→ASCII logic. Pure functions, no DOM, no React —
 * the same math the live preview and the bake step both use.
 * With every effect off (gamma 1, dither off) the
 * luma→glyph mapping is identical to the portfolio's Python bake
 * tool, so output from either is interchangeable.
 *
 * Pipeline: RGBA buffer → lumaGrid → adjustLuma →
 * quantizeLuma (optionally dithered) → indicesToFrame. convertFrame
 * runs the whole chain. Every stage works on the small cols×rows
 * grid, so per-frame cost stays trivial even inside a rAF loop.
 */

// Dark → dense. Keep this matching your drop animation's ramp.
export const DEFAULT_RAMP = ' .:-=+*#%@';

/**
 * Split a ramp into an array of glyphs. `Array.from` splits by code
 * point, so multi-byte glyphs count as one each. Pass an array through
 * untouched.
 */
export function toGlyphs(ramp) {
  return Array.isArray(ramp) ? ramp : Array.from(ramp);
}

/**
 * Rows are derived from the source's aspect ratio, halved (by default)
 * to compensate for monospace cells being ~2× taller than wide — so
 * the figure keeps real-world proportions instead of stretching.
 */
export function computeRows(videoW, videoH, cols, cellAspect = 2) {
  if (!videoW || !videoH) return 1;
  return Math.max(1, Math.round((cols * (videoH / videoW)) / cellAspect));
}

/**
 * Parse '#rgb' or '#rrggbb' (with or without the #) to [r,g,b], or null if the
 * string isn't a complete, valid hex color. Returning null lets a half-typed
 * value in the UI simply key nothing instead of throwing.
 */
export function hexToRgb(hex) {
  if (typeof hex !== 'string') return null;
  let h = hex.trim().replace(/^#/, '');
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  if (h.length !== 6 || /[^0-9a-f]/i.test(h)) return null;
  const num = parseInt(h, 16);
  return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
}

// Largest possible RGB distance: sqrt(255² × 3). Normalizes the custom-key
// distance into 0..1 so the threshold means the same thing as the other modes.
const MAX_RGB_DIST = Math.sqrt(3) * 255;

/**
 * Chroma / luma key: should this pixel be dropped to transparent (rendered as a
 * blank space, letting the background show through)?
 *
 * keyMode: 'off' | 'green' | 'black' | 'white' | 'custom'; t (threshold) in 0..1.
 * For 'custom', `target` is the [r,g,b] key color and a pixel is dropped when its
 * RGB distance to it is within t. Higher t removes MORE pixels in every mode.
 * Operates on the raw source RGB — deliberately before gamma/invert — so
 * "black background" means actually-dark source pixels regardless of display.
 */
export function isKeyed(r, g, b, keyMode, t, target) {
  if (!keyMode || keyMode === 'off') return false;
  if (keyMode === 'green') {
    // Greenness: ~1 for pure green, ~0 for any gray/neutral pixel.
    const excess = (g - Math.max(r, b)) / 255;
    return excess >= 1 - t;
  }
  if (keyMode === 'custom') {
    if (!target) return false;
    const dr = r - target[0], dg = g - target[1], db = b - target[2];
    return Math.sqrt(dr * dr + dg * dg + db * db) / MAX_RGB_DIST <= t;
  }
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  if (keyMode === 'black') return lum <= t;   // drop the dark background
  return lum >= 1 - t;                         // 'white' → drop the bright background
}

// A key spec is { mode, threshold, color } or null/undefined for no keying.
// Normalize once per frame — parsing the custom color here keeps the hex parse
// out of the per-pixel loop and lets the inner test stay branch-cheap.
const keyOf = (key) => {
  if (!key || !key.mode || key.mode === 'off') return null;
  return { mode: key.mode, threshold: key.threshold, target: hexToRgb(key.color) };
};

/**
 * Supersample factor used when block averaging is on: the frame is drawn
 * to a canvas SUPERSAMPLE× the ascii grid, then each cell averages its
 * SUPERSAMPLE×SUPERSAMPLE source pixels. Higher = smoother but heavier.
 */
export const SUPERSAMPLE = 2;

// Cells whose mean alpha falls below this are blank — the cut tool erases
// photo pixels to transparent and those must render as spaces, not black.
const ALPHA_CUTOFF = 128;

/**
 * Stage 1: RGBA buffer (srcW×srcH) → Rec. 601 luma grid (cols×rows,
 * Float32Array in 0..1). Handles both srcW===cols (one pixel per cell)
 * and larger buffers (each cell averages its block — the supersampled
 * path). Keyed cells and mostly-transparent cells get the sentinel -1:
 * they render blank and every later stage skips them.
 */
export function lumaGrid(data, srcW, srcH, cols, rows, key) {
  const k = keyOf(key);
  const luma = new Float32Array(cols * rows);
  const bw = srcW / cols;
  const bh = srcH / rows;
  for (let y = 0; y < rows; y++) {
    const y0 = Math.floor(y * bh);
    const y1 = Math.max(y0 + 1, Math.min(srcH, Math.floor((y + 1) * bh)));
    for (let x = 0; x < cols; x++) {
      const x0 = Math.floor(x * bw);
      const x1 = Math.max(x0 + 1, Math.min(srcW, Math.floor((x + 1) * bw)));
      // Mean RGBA over the block (a single pixel when srcW===cols). Luma is
      // derived from the same mean that feeds the key test, so block
      // averaging and keying always agree.
      let rs = 0, gs = 0, bs = 0, as = 0, count = 0;
      for (let yy = y0; yy < y1; yy++) {
        let p = (yy * srcW + x0) * 4;
        for (let xx = x0; xx < x1; xx++, p += 4) {
          rs += data[p]; gs += data[p + 1]; bs += data[p + 2]; as += data[p + 3];
          count++;
        }
      }
      const i = y * cols + x;
      const r = rs / count, g = gs / count, b = bs / count, a = as / count;
      if (a < ALPHA_CUTOFF || (k && isKeyed(r, g, b, k.mode, k.threshold, k.target))) {
        luma[i] = -1;
        continue;
      }
      luma[i] = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    }
  }
  return luma;
}

/** Stage 2: gamma + invert, in place. Blank (-1) cells are untouched. */
export function adjustLuma(luma, gamma, invert) {
  for (let i = 0; i < luma.length; i++) {
    let v = luma[i];
    if (v < 0) continue;
    if (gamma !== 1) v = Math.pow(v, gamma);
    if (invert) v = 1 - v;
    luma[i] = v;
  }
  return luma;
}

// 4×4 Bayer matrix, row-major. (v + 0.5)/16 - 0.5 gives a threshold offset
// in -0.47..0.47 that tiles across the grid.
const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

/**
 * Stage 4: quantize luma to glyph indices (Int16Array; blank cells stay -1).
 * dither: 'off' | 'floyd' | 'bayer'.
 * - floyd: serpentine Floyd–Steinberg. The error of quantizing each cell to
 *   one of glyphCount levels is diffused to unvisited neighbors — but never
 *   into blank cells, so keyed/cut regions don't grow glyph fringes.
 *   Mutates `luma` (it's the last consumer).
 * - bayer: ordered dithering; a tiled threshold offset scaled to one
 *   quantization step. Stable frame-to-frame (no crawl on video).
 */
export function quantizeLuma(luma, cols, rows, glyphCount, dither) {
  const n = Math.max(1, glyphCount - 1);
  const out = new Int16Array(cols * rows);
  const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

  if (dither === 'floyd') {
    for (let y = 0; y < rows; y++) {
      const ltr = (y & 1) === 0; // serpentine: alternate direction per row
      for (let i = 0; i < cols; i++) {
        const x = ltr ? i : cols - 1 - i;
        const p = y * cols + x;
        if (luma[p] < 0) { out[p] = -1; continue; }
        const v = clamp01(luma[p]);
        const idx = Math.round(v * n);
        out[p] = idx;
        const err = v - idx / n;
        const dir = ltr ? 1 : -1;
        const spread = (xx, yy, e) => {
          if (xx < 0 || xx >= cols || yy >= rows) return;
          const q = yy * cols + xx;
          if (luma[q] >= 0) luma[q] += e;
        };
        spread(x + dir, y, err * (7 / 16));
        spread(x - dir, y + 1, err * (3 / 16));
        spread(x, y + 1, err * (5 / 16));
        spread(x + dir, y + 1, err * (1 / 16));
      }
    }
    return out;
  }

  const bayer = dither === 'bayer';
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const p = y * cols + x;
      if (luma[p] < 0) { out[p] = -1; continue; }
      let t = clamp01(luma[p]) * n;
      if (bayer) t += (BAYER4[(y & 3) * 4 + (x & 3)] + 0.5) / 16 - 0.5;
      const idx = Math.round(t);
      out[p] = idx < 0 ? 0 : idx > n ? n : idx;
    }
  }
  return out;
}

/** Stage 5: glyph indices → frame string. -1 → ' ' (transparent cell). */
export function indicesToFrame(indices, cols, rows, glyphs) {
  const lines = new Array(rows);
  for (let y = 0; y < rows; y++) {
    let line = '';
    for (let x = 0; x < cols; x++) {
      const idx = indices[y * cols + x];
      line += idx < 0 ? ' ' : glyphs[idx];
    }
    lines[y] = line;
  }
  return lines.join('\n');
}

/**
 * The whole chain in one call — what the live preview and the bake use.
 * data: Uint8ClampedArray from ctx.getImageData(...).data, srcW×srcH.
 * opts: { cols, rows, ramp, invert, gamma, key, dither }.
 */
export function convertFrame(data, srcW, srcH, opts) {
  const { cols, rows, ramp, invert, gamma, key, dither = 'off' } = opts;
  const glyphs = toGlyphs(ramp);
  const luma = lumaGrid(data, srcW, srcH, cols, rows, key);
  adjustLuma(luma, gamma, invert);
  const indices = quantizeLuma(luma, cols, rows, glyphs.length, dither);
  return indicesToFrame(indices, cols, rows, glyphs);
}

/** Estimate gzipped size using the browser's CompressionStream. */
export async function gzipSize(str) {
  if (typeof CompressionStream === 'undefined') return null;
  const stream = new Blob([str]).stream().pipeThrough(new CompressionStream('gzip'));
  const buf = await new Response(stream).arrayBuffer();
  return buf.byteLength;
}

export function formatBytes(bytes) {
  if (bytes == null) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}
