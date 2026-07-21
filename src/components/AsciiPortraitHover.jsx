import { useEffect, useRef } from "react";
import { clamp01, isCoarsePointer, prefersReducedMotion } from "../lib/utils.js";

// Canvas ascii portrait for the About spread, ported from the codegrid
// "lukebaffait animated footer" hand effect: the image is sampled into a
// square-cell glyph grid, and cursor proximity ignites short-lived clusters
// of cells (solid fill + inverted glyph) that random-walk out from the
// nearest cell and decay ~300ms later. Adaptations from the reference:
// alpha-keyed background (the portrait is a transparent-bg cutout, so cells
// drop on alpha, not brightness), bright→dense polarity (figure sits on
// black), pointer events scoped to the canvas instead of window, a
// map-lookup neighbourhood search instead of scanning every cell per move,
// and a rAF loop that only runs while something is animating.
//
// The `active` prop replays the same role `revealed` played for the old
// text portrait: false shows a sparse dot scatter (the "thumb"), flipping
// true runs a decode-in (random per-cell delays behind a short noise
// flicker), and the hover effect arms only once the decode settles.

// ── Tunables ────────────────────────────────────────────────────────────
const RAMP = "........:::=+xX#0369"; // sparse→dense, codegrid's ramp
const NOISE_POOL = ":=+xX#0369";
const COLS = 40; // chunky: ~⅓ the glyphs of the 72-col first pass
const CELL = 14; // canvas-space px per cell (CSS scales the whole grid down)
const FONT_SIZE = 12.5;
const FONT_FAMILY = '"PP Neue Montreal Mono", ui-monospace, monospace';
const MAX_DPR = 3; // upper cap; a floor of 2 is enforced at build so the fine
// face glyphs stay crisp on non-retina screens at the larger display size
const ALPHA_MIN = 128; // cells more transparent than this don't exist
const GAMMA = 1.15; // >1 thins the dark sweater, keeps the face dense

const BASE_COLOR = "#2b2bd6"; // dimmed site blue for the resting glyphs
const FACE_COLOR = "#7f7fff"; // brighter blue for the face overlay so the face
// reads clearly against black instead of blending into the dim body
const HOVER_FILL = "#0000ff"; // the site blue — nav pills / dissolve band
const HOVER_CHAR = "#ffffff"; // white glyph reversed out of the blue fill

const HOVER_RADIUS = 5; // grid cells — 8 would be a fifth of the 40-col grid
const CLUSTER_SIZE = 8;
const HIGHLIGHT_LIFETIME = 300; // ms
const DECODE_MS = 900; // spread of per-cell reveal delays
const NOISE_MS = 140; // per-cell flicker before settling on its glyph
const SPARSE_SHARE = 0.12; // share of cells shown while !active

// Face detail patch: a finer overlay sampled from just the face crop and
// composited over the chunky base grid, so the face reads (eyes/brows/mouth)
// while the body — and the hair frame around the face — stays big-glyph
// chunky. Bbox tightened to just the face (measured off the source) so every
// fine col lands on the face, not hair/sweater. Fractions of the SOURCE
// image; all eyeball-tunable.
const FACE_TOP = 0.01;
const FACE_BOTTOM = 0.18;
const FACE_LEFT = 0.38;
const FACE_RIGHT = 0.62;
const FACE_COLS = 84; // now all across the face itself → much finer features
const FACE_CONTRAST = 1.9; // strong: skin stays dense, features drop to blank
// holes so eyes/brows/mouth read as defined negative space (pivot 0.5)

const key = (col, row) => `${col},${row}`;

export function AsciiPortraitHover({
  src,
  active,
  label,
  className,
  onContour,
}) {
  const canvasRef = useRef(null);
  const stateRef = useRef(null);
  const activeRef = useRef(active);
  const rafRef = useRef(0);
  // Latest callback without retriggering the build effect.
  const onContourRef = useRef(onContour);
  onContourRef.current = onContour;

  // Everything imperative lives on stateRef; these three helpers close over
  // refs only, so the effects below can share them without dependencies.
  const draw = (now) => {
    const st = stateRef.current;
    if (!st) return;
    const { ctx } = st;
    ctx.clearRect(0, 0, COLS * CELL, st.rows * CELL);

    if (!activeRef.current) {
      // Overlay closed / mid-dissolve: sparse scatter, mirroring the old
      // portrait's low-res thumb.
      ctx.fillStyle = BASE_COLOR;
      for (const cell of st.cellList) {
        if (!cell.sparse) continue;
        ctx.fillText(
          ".",
          cell.col * CELL + CELL / 2,
          cell.row * CELL + st.baseline,
        );
      }
      return;
    }

    // Base chunky grid.
    ctx.font = st.baseFont;
    for (const cell of st.cellList) {
      if (cell.revealAt > now) continue; // not decoded in yet
      const inNoise = now < cell.revealAt + NOISE_MS;
      const ch = inNoise
        ? NOISE_POOL[(Math.random() * NOISE_POOL.length) | 0]
        : cell.char;
      const x = cell.col * CELL;
      const y = cell.row * CELL;
      const lit = cell.highlightEnd > now;
      if (lit) {
        ctx.fillStyle = HOVER_FILL;
        ctx.fillRect(x, y, CELL, CELL);
      }
      ctx.fillStyle = lit ? HOVER_CHAR : BASE_COLOR;
      ctx.fillText(ch, x + CELL / 2, y + st.baseline);
    }

    // Finer face overlay on top — each fine glyph reveals with the base cell
    // beneath it (same decode), and is skipped where that base cell is lit so
    // the chunky blue hover block reads cleanly over the face.
    if (st.faceList.length) {
      ctx.font = st.faceFont;
      ctx.fillStyle = FACE_COLOR;
      for (const f of st.faceList) {
        const base = st.cells.get(f.baseKey);
        if (base && (base.revealAt > now || base.highlightEnd > now)) continue;
        ctx.fillText(f.char, f.cx, f.top + st.faceBaseline);
      }
    }
  };

  const ensureLoop = () => {
    if (rafRef.current) return;
    const tick = () => {
      const st = stateRef.current;
      const now = Date.now();
      draw(now);
      const busy =
        st &&
        activeRef.current &&
        (now < st.decodeEndsAt || now < st.lastHighlightEnd);
      rafRef.current = busy ? requestAnimationFrame(tick) : 0;
    };
    rafRef.current = requestAnimationFrame(tick);
  };

  // Sync the grid with the `active` prop: assign decode delays on open,
  // reset to the sparse scatter on close.
  const syncActive = () => {
    const st = stateRef.current;
    if (!st) return;
    const now = Date.now();
    if (activeRef.current) {
      const still = prefersReducedMotion();
      for (const cell of st.cellList) {
        // `1` = revealed in the distant past (skips the noise window too).
        cell.revealAt = still ? 1 : now + Math.random() * DECODE_MS;
        cell.highlightEnd = 0;
      }
      st.decodeEndsAt = still ? 0 : now + DECODE_MS + NOISE_MS;
      st.lastHighlightEnd = 0;
      if (still) draw(now);
      else ensureLoop();
    } else {
      for (const cell of st.cellList) {
        cell.revealAt = 0;
        cell.highlightEnd = 0;
      }
      st.decodeEndsAt = 0;
      st.lastHighlightEnd = 0;
      draw(now);
    }
  };

  // Build the cell grid from the image (codegrid buildCells, alpha-keyed).
  useEffect(() => {
    let alive = true;
    const canvas = canvasRef.current;
    const img = new Image();
    img.decoding = "async";
    img.onload = () => {
      if (!alive || !canvas) return;
      const rows = Math.round(
        COLS / (img.naturalWidth / img.naturalHeight),
      );
      const sample = document.createElement("canvas");
      sample.width = COLS;
      sample.height = rows;
      const sctx = sample.getContext("2d", { willReadFrequently: true });
      sctx.drawImage(img, 0, 0, COLS, rows);
      const px = sctx.getImageData(0, 0, COLS, rows).data;

      const cells = new Map();
      for (let row = 0; row < rows; row++) {
        for (let col = 0; col < COLS; col++) {
          const o = (row * COLS + col) * 4;
          if (px[o + 3] < ALPHA_MIN) continue;
          const b =
            (px[o] * 0.299 + px[o + 1] * 0.587 + px[o + 2] * 0.114) / 255;
          const idx = Math.min(
            RAMP.length - 1,
            Math.round(Math.pow(b, GAMMA) * (RAMP.length - 1)),
          );
          cells.set(key(col, row), {
            col,
            row,
            char: RAMP[idx],
            highlightEnd: 0,
            revealAt: 0,
            sparse: Math.random() < SPARSE_SHARE,
          });
        }
      }

      // Report the drawn figure's per-row opaque extents (fractions of the
      // full grid box) so the About layout can auto-generate shape-outside
      // polygons that wrap text along the real silhouette — no hand-tuned
      // contours. Every 2nd row keeps the payload small.
      if (onContourRef.current) {
        const bands = [];
        for (let row = 0; row < rows; row += 2) {
          let min = Infinity;
          let max = -1;
          for (let col = 0; col < COLS; col++) {
            if (!cells.has(key(col, row))) continue;
            if (col < min) min = col;
            if (col > max) max = col;
          }
          if (max < 0) continue;
          bands.push({
            y: row / rows,
            left: min / COLS,
            right: (max + 1) / COLS,
          });
        }
        onContourRef.current({ bands });
      }

      // Finer face sampling from the head crop (source-image fractions →
      // base-canvas logical coords). Contrast-boosted so features read; each
      // fine cell remembers the base cell beneath it (baseKey) for the
      // decode gate + hover suppression.
      const faceList = [];
      const cropL = Math.round(FACE_LEFT * img.naturalWidth);
      const cropT = Math.round(FACE_TOP * img.naturalHeight);
      const cropW = Math.round((FACE_RIGHT - FACE_LEFT) * img.naturalWidth);
      const cropH = Math.round((FACE_BOTTOM - FACE_TOP) * img.naturalHeight);
      const faceRows = Math.max(1, Math.round(FACE_COLS * (cropH / cropW)));
      const faceSample = document.createElement("canvas");
      faceSample.width = FACE_COLS;
      faceSample.height = faceRows;
      const fsx = faceSample.getContext("2d", { willReadFrequently: true });
      fsx.drawImage(img, cropL, cropT, cropW, cropH, 0, 0, FACE_COLS, faceRows);
      const fpx = fsx.getImageData(0, 0, FACE_COLS, faceRows).data;
      const rectX = FACE_LEFT * COLS * CELL;
      const rectY = FACE_TOP * rows * CELL;
      const fcw = ((FACE_RIGHT - FACE_LEFT) * COLS * CELL) / FACE_COLS;
      const fch = ((FACE_BOTTOM - FACE_TOP) * rows * CELL) / faceRows;
      for (let r = 0; r < faceRows; r++) {
        for (let c = 0; c < FACE_COLS; c++) {
          const o = (r * FACE_COLS + c) * 4;
          if (fpx[o + 3] < ALPHA_MIN) continue;
          let b =
            (fpx[o] * 0.299 + fpx[o + 1] * 0.587 + fpx[o + 2] * 0.114) / 255;
          b = clamp01((b - 0.5) * FACE_CONTRAST + 0.5);
          const idx = Math.min(
            RAMP.length - 1,
            Math.round(Math.pow(b, GAMMA) * (RAMP.length - 1)),
          );
          const top = rectY + r * fch;
          const cx = rectX + c * fcw + fcw / 2;
          faceList.push({
            cx,
            top,
            char: RAMP[idx],
            baseKey: key(
              Math.floor(cx / CELL),
              Math.floor((top + fch / 2) / CELL),
            ),
          });
        }
      }
      const faceFont = `${(FONT_SIZE * fcw) / CELL}px ${FONT_FAMILY}`;

      const dpr = Math.min(Math.max(window.devicePixelRatio || 1, 2), MAX_DPR);
      canvas.width = COLS * CELL * dpr;
      canvas.height = rows * CELL * dpr;

      const ctx = canvas.getContext("2d");
      const setupCtx = () => {
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.textAlign = "center";
        ctx.textBaseline = "alphabetic";
        ctx.font = st.baseFont;
        const m = ctx.measureText("X");
        const glyphH =
          m.actualBoundingBoxAscent + m.actualBoundingBoxDescent;
        st.baseline = CELL / 2 + glyphH / 2 - m.actualBoundingBoxDescent;
        if (st.faceList.length) {
          ctx.font = st.faceFont;
          const fm = ctx.measureText("X");
          const fH = fm.actualBoundingBoxAscent + fm.actualBoundingBoxDescent;
          st.faceBaseline = fch / 2 + fH / 2 - fm.actualBoundingBoxDescent;
        }
      };

      const st = {
        ctx,
        rows,
        cells,
        cellList: [...cells.values()],
        baseFont: `${FONT_SIZE}px ${FONT_FAMILY}`,
        baseline: 0,
        faceList,
        faceFont,
        faceBaseline: 0,
        decodeEndsAt: 0,
        lastHighlightEnd: 0,
      };
      stateRef.current = st;
      setupCtx();
      syncActive();
      // The mono face may land after first paint — remeasure and redraw.
      document.fonts?.ready?.then(() => {
        if (!alive || stateRef.current !== st) return;
        setupCtx();
        draw(Date.now());
      });
    };
    // Decorative — a failed load just leaves the slot empty.
    img.onerror = () => {};
    img.src = src;
    return () => {
      alive = false;
      stateRef.current = null;
      cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src]);

  useEffect(() => {
    activeRef.current = active;
    syncActive();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  // Hover: nearest cell within HOVER_RADIUS ignites a random-walk cluster
  // (codegrid highlightCluster verbatim, incl. the +10ms/step decay stagger).
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || prefersReducedMotion() || isCoarsePointer()) return;

    const igniteCluster = (st, startCell, now) => {
      startCell.highlightEnd = now + HIGHLIGHT_LIFETIME;
      st.lastHighlightEnd = Math.max(
        st.lastHighlightEnd,
        startCell.highlightEnd,
      );
      const steps = ((Math.random() * CLUSTER_SIZE) | 0) + 1;
      const lit = new Set([startCell]);
      let current = startCell;
      for (let step = 0; step < steps; step++) {
        const neighbours = [];
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue;
            const n = st.cells.get(key(current.col + dx, current.row + dy));
            if (n && !lit.has(n)) neighbours.push(n);
          }
        }
        if (neighbours.length === 0) break;
        const next = neighbours[(Math.random() * neighbours.length) | 0];
        next.highlightEnd = now + HIGHLIGHT_LIFETIME + step * 10;
        st.lastHighlightEnd = Math.max(st.lastHighlightEnd, next.highlightEnd);
        lit.add(next);
        current = next;
      }
    };

    const onMove = (e) => {
      const st = stateRef.current;
      if (!st || !activeRef.current) return;
      const now = Date.now();
      if (now < st.decodeEndsAt) return; // let the decode finish first
      const rect = canvas.getBoundingClientRect();
      if (rect.width === 0) return;
      const mouseCol = ((e.clientX - rect.left) / rect.width) * COLS;
      const mouseRow = ((e.clientY - rect.top) / rect.height) * st.rows;

      const c0 = Math.round(mouseCol);
      const r0 = Math.round(mouseRow);
      let closest = null;
      let closestDist = Infinity;
      for (let dy = -HOVER_RADIUS; dy <= HOVER_RADIUS; dy++) {
        for (let dx = -HOVER_RADIUS; dx <= HOVER_RADIUS; dx++) {
          const cell = st.cells.get(key(c0 + dx, r0 + dy));
          if (!cell) continue;
          const d = Math.hypot(mouseCol - cell.col, mouseRow - cell.row);
          if (d < closestDist) {
            closestDist = d;
            closest = cell;
          }
        }
      }
      if (closest && closestDist <= HOVER_RADIUS) {
        igniteCluster(st, closest, now);
        ensureLoop();
      }
    };

    canvas.addEventListener("pointermove", onMove);
    return () => canvas.removeEventListener("pointermove", onMove);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className={className}
      role="img"
      aria-label={label}
    />
  );
}
