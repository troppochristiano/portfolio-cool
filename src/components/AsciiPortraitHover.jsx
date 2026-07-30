import { useEffect, useRef } from "react";
import { lastPointer } from "../lib/lastPointer.js";
import {
  clamp01,
  clampedDpr,
  luma601,
  prefersReducedMotion,
} from "../lib/utils.js";
import { useLiveRef } from "../hooks/useLiveRef.js";

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
const COLS = 52; // chunky, but finer than the first pass — enough body
// resolution to show the sweater folds / jean creases, not just a dot blob
const CELL = 14; // canvas-space px per cell (CSS scales the whole grid down)
const FONT_SIZE = 12.5;
const FONT_FAMILY = '"PP Neue Montreal Mono", ui-monospace, monospace';
const MAX_DPR = 3; // upper cap; a floor of 2 is enforced at build so the fine
// face glyphs stay crisp on non-retina screens at the larger display size
const ALPHA_MIN = 128; // cells more transparent than this don't exist
const GAMMA = 1.15; // >1 thins the dark sweater, keeps the face dense

const BASE_COLOR = "#2b2bd6"; // dimmed site blue for the resting glyphs
const DETAIL_COLOR = "#7f7fff"; // brighter blue for the detail overlays so they
// read clearly against black instead of blending into the dim body
const HOVER_FILL = "#0000ff"; // the site blue — nav pills / dissolve band
const HOVER_CHAR = "#ffffff"; // white glyph reversed out of the blue fill

const HOVER_RADIUS = 6; // grid cells — scaled with COLS to hold the halo's
const CLUSTER_SIZE = 10; // physical size (~⅛ of the grid) at the finer res
const HIGHLIGHT_LIFETIME = 300; // ms
// While a cell is lit, its glyph keeps re-rolling (a "decode" flicker) rather
// than showing the figure char — each cell swaps on its own jittered cadence.
const SCRAMBLE_MS = 38; // min hold per random glyph in a lit cell
const SCRAMBLE_JITTER = 28; // per-cell jitter so they don't swap in lockstep
const DECODE_MS = 900; // spread of per-cell reveal delays
const NOISE_MS = 140; // per-cell flicker before settling on its glyph
const SPARSE_SHARE = 0.12; // share of cells shown while !active

// Detail patches: finer overlays sampled from one crop of the source and
// composited over the chunky base grid, so a feature reads while everything
// around it stays big-glyph chunky. Bboxes are tightened to the feature itself
// (measured off the source) so every fine col lands on it — the face patch
// must not spill into hair/sweater, the shoes patch must not spill into jeans.
//
// Bboxes are fractions of the SOURCE image, which is also the base-grid box:
// buildCells stretches the whole image across the whole COLS×rows grid, so a
// source fraction and a grid fraction are the same number. `cols` is the fine
// column count across the crop; rows are derived from the crop's aspect.
//
// Sizing rule: match the on-screen glyph size, NOT a fixed linear density. The
// About layout displays these crops at different scales (the phone head crop
// lands at ~0.64× canvas scale, the legs crop at ~0.42×), so a patch shown
// smaller needs FEWER columns or it oversamples into sub-pixel mush.
const PATCHES = {
  // Eyes/brows/mouth. Contrast is deliberately brutal: skin stays dense and the
  // features drop to blank holes, so they read as defined negative space.
  face: {
    top: 0.01,
    bottom: 0.18,
    left: 0.38,
    right: 0.62,
    cols: 84,
    contrast: 1.9,
  },
  // The sneakers, measured off the source: mean row luma holds at 45–62 through
  // y 0.923 (dark denim) then jumps to ~200 by y 0.935 — that step is the shoe
  // line. Opaque extent widens to 0.295→0.74 as the feet splay.
  // Gentler contrast than the face: 1.9 would blow a white sneaker to solid
  // fill, losing the laces and sole line that are the whole point here.
  shoes: {
    top: 0.92,
    bottom: 1,
    left: 0.28,
    right: 0.75,
    cols: 108,
    contrast: 1.35,
  },
};

const key = (col, row) => `${col},${row}`;

export function AsciiPortraitHover({
  src,
  active,
  label,
  className,
  // Which PATCHES to build, by name. Each About crop asks only for the patch it
  // actually shows — the head crop can't see the shoes and vice versa, so
  // building both on both canvases would be pure waste.
  detail = ["face"],
  onContour,
}) {
  const canvasRef = useRef(null);
  const stateRef = useRef(null);
  const activeRef = useRef(active);
  const rafRef = useRef(0);
  // Latest callback without retriggering the build effect.
  const onContourRef = useLiveRef(onContour);
  // Read once per build. A ref so a new array identity on every render doesn't
  // retrigger the (expensive) image sample.
  const detailRef = useLiveRef(detail);

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
      const x = cell.col * CELL;
      const y = cell.row * CELL;
      const lit = cell.highlightEnd > now;
      let ch;
      if (lit) {
        // Highlighted cell: paint the blue block and keep re-rolling the glyph
        // (each cell on its own cadence) so the cluster reads as decoding text.
        if (now >= cell.scrAt) {
          cell.scr = NOISE_POOL[(Math.random() * NOISE_POOL.length) | 0];
          cell.scrAt = now + SCRAMBLE_MS + Math.random() * SCRAMBLE_JITTER;
        }
        ch = cell.scr;
        ctx.fillStyle = HOVER_FILL;
        ctx.fillRect(x, y, CELL, CELL);
        ctx.fillStyle = HOVER_CHAR;
      } else {
        // Fresh-decoded cells flicker briefly, then settle on the figure glyph.
        const inNoise = now < cell.revealAt + NOISE_MS;
        ch = inNoise
          ? NOISE_POOL[(Math.random() * NOISE_POOL.length) | 0]
          : cell.char;
        ctx.fillStyle = BASE_COLOR;
      }
      ctx.fillText(ch, x + CELL / 2, y + st.baseline);
    }

    // Finer overlays on top — each fine glyph reveals with the base cell
    // beneath it (same decode), and is skipped where that base cell is lit so
    // the chunky blue hover block reads cleanly over the detail. Font and
    // colour are set per patch, outside the cell loop: patches have different
    // cell widths and so different font sizes.
    ctx.fillStyle = DETAIL_COLOR;
    for (const p of st.patches) {
      ctx.font = p.font;
      for (const f of p.list) {
        const base = st.cells.get(f.baseKey);
        // No base cell at all → no decode timing to borrow, so skip rather
        // than paint it early and through hover clusters.
        if (!base || base.revealAt > now || base.highlightEnd > now) continue;
        ctx.fillText(f.char, f.cx, f.top + p.baseline);
      }
    }
  };

  const ensureLoop = () => {
    if (rafRef.current) return;
    // Repaint at ~30fps, not every rAF: a draw() clears and refills the whole
    // DPR≥2 grid (~5-7k fillText, measured 9-12ms a frame) while the scramble
    // itself only rerolls on the SCRAMBLE_MS (38ms) cadence — display-rate
    // repaints rasterize identical cells. The parking frame always paints so
    // the resting grid never holds a stale mid-decay cell.
    let lastDraw = 0;
    const tick = () => {
      const st = stateRef.current;
      const now = Date.now();
      const busy =
        st &&
        activeRef.current &&
        (now < st.decodeEndsAt || now < st.lastHighlightEnd);
      if (!busy || now - lastDraw >= 33) {
        lastDraw = now;
        draw(now);
      }
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
          const b = luma601(px[o], px[o + 1], px[o + 2]) / 255;
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
            scr: RAMP[idx], // current scramble glyph while lit
            scrAt: 0, // next reroll time
          });
        }
      }

      // Report the drawn figure's opaque geometry (fractions of the full grid
      // box) so the About layout can auto-generate shape-outside polygons that
      // wrap text along the real silhouette — no hand-tuned contours.
      //
      //   bands — per row, the OUTER left/right extent. Every 2nd row keeps it
      //           small. Drives the upright wraps.
      //   runs  — per row, every ink span. A superset of bands, and the only
      //           form that survives rotation: the phone crops are turned 90°,
      //           so their wrap contour is a per-COLUMN extent taken inside a
      //           crop window, which outer row extents can't reconstruct (they
      //           span the gap between the legs as if it were solid).
      if (onContourRef.current) {
        const bands = [];
        const runs = [];
        for (let row = 0; row < rows; row++) {
          const spans = [];
          let start = -1;
          for (let col = 0; col <= COLS; col++) {
            const ink = col < COLS && cells.has(key(col, row));
            if (ink && start < 0) start = col;
            if (!ink && start >= 0) {
              spans.push([start / COLS, col / COLS]);
              start = -1;
            }
          }
          if (!spans.length) continue;
          runs.push({ y: row / rows, spans });
          if (row % 2 === 0) {
            bands.push({
              y: row / rows,
              left: spans[0][0],
              right: spans[spans.length - 1][1],
            });
          }
        }
        // rowH lets consumers reason about a run's BOTTOM edge, not just the
        // top one `y` reports — a contour taken from the last inked row would
        // otherwise stop one cell short of the glyphs.
        onContourRef.current({ bands, runs, rowH: 1 / rows });
      }

      // Finer sampling from one crop of the source (source-image fractions →
      // base-canvas logical coords). Contrast-boosted so the feature reads;
      // each fine cell remembers the base cell beneath it (baseKey) for the
      // decode gate + hover suppression.
      const buildPatch = (spec) => {
        const list = [];
        const cropL = Math.round(spec.left * img.naturalWidth);
        const cropT = Math.round(spec.top * img.naturalHeight);
        const cropW = Math.round((spec.right - spec.left) * img.naturalWidth);
        const cropH = Math.round((spec.bottom - spec.top) * img.naturalHeight);
        const pRows = Math.max(1, Math.round(spec.cols * (cropH / cropW)));
        const sample = document.createElement("canvas");
        sample.width = spec.cols;
        sample.height = pRows;
        const sx = sample.getContext("2d", { willReadFrequently: true });
        sx.drawImage(img, cropL, cropT, cropW, cropH, 0, 0, spec.cols, pRows);
        const px2 = sx.getImageData(0, 0, spec.cols, pRows).data;
        const rectX = spec.left * COLS * CELL;
        const rectY = spec.top * rows * CELL;
        const cellW = ((spec.right - spec.left) * COLS * CELL) / spec.cols;
        const cellH = ((spec.bottom - spec.top) * rows * CELL) / pRows;
        // A fine cell whose base cell was alpha-culled has no decode timing to
        // borrow, and draw() would paint it unconditionally — popping in ahead
        // of the decode and showing through hover clusters. Snap those to the
        // nearest base cell that does exist rather than dropping the glyph;
        // thin features at the grid's edge (shoes especially) hit this often.
        const nearestKey = (col, row) => {
          if (cells.has(key(col, row))) return key(col, row);
          for (let r2 = 1; r2 <= 2; r2++) {
            for (let dy = -r2; dy <= r2; dy++) {
              for (let dx = -r2; dx <= r2; dx++) {
                if (cells.has(key(col + dx, row + dy))) {
                  return key(col + dx, row + dy);
                }
              }
            }
          }
          return key(col, row); // genuinely orphaned; draw() skips it
        };
        for (let r = 0; r < pRows; r++) {
          for (let c = 0; c < spec.cols; c++) {
            const o = (r * spec.cols + c) * 4;
            if (px2[o + 3] < ALPHA_MIN) continue;
            let b = luma601(px2[o], px2[o + 1], px2[o + 2]) / 255;
            b = clamp01((b - 0.5) * spec.contrast + 0.5);
            const idx = Math.min(
              RAMP.length - 1,
              Math.round(Math.pow(b, GAMMA) * (RAMP.length - 1)),
            );
            const top = rectY + r * cellH;
            const cx = rectX + c * cellW + cellW / 2;
            list.push({
              cx,
              top,
              char: RAMP[idx],
              baseKey: nearestKey(
                Math.floor(cx / CELL),
                Math.floor((top + cellH / 2) / CELL),
              ),
            });
          }
        }
        return {
          list,
          cellH,
          font: `${(FONT_SIZE * cellW) / CELL}px ${FONT_FAMILY}`,
          baseline: 0,
        };
      };
      const patches = (detailRef.current ?? [])
        .map((name) => PATCHES[name])
        .filter(Boolean)
        .map(buildPatch)
        .filter((p) => p.list.length);

      const dpr = clampedDpr(MAX_DPR, 2);
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
        // Per patch: each has its own cell height and font size, so each needs
        // its own baseline. (This used to close over the build-scope `fch`,
        // which with more than one patch would measure them all against
        // whichever was sampled last.)
        for (const p of st.patches) {
          ctx.font = p.font;
          const fm = ctx.measureText("X");
          const fH = fm.actualBoundingBoxAscent + fm.actualBoundingBoxDescent;
          p.baseline = p.cellH / 2 + fH / 2 - fm.actualBoundingBoxDescent;
        }
      };

      const st = {
        ctx,
        rows,
        cells,
        cellList: [...cells.values()],
        baseFont: `${FONT_SIZE}px ${FONT_FAMILY}`,
        baseline: 0,
        patches,
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
  // Touch counts too (reduced motion is the only gate): taps and drags ignite
  // under the finger — pointerdown covers the tap, pointermove the drag
  // (touch-action: pan-y on the canvas keeps horizontal drags ours), and the
  // scroll path below treats the last touch point as a short-lived resting
  // cursor while the figure slides beneath it.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || prefersReducedMotion()) return;

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

    // Screen → canvas-grid coordinates, honouring whatever transform CSS has
    // put on the canvas. The About phone crops turn it a quarter turn, and
    // getBoundingClientRect reports the TRANSFORMED bbox — 781×467 where the
    // canvas is really 467×781 — so reading col/row straight off that rect
    // lands every touch on the wrong cell and lets points far outside the
    // visible crop through the bounds test. Invert the real matrix instead.
    // Cached: getComputedStyle on every pointermove is not free.
    let inverse = null;
    const invalidate = () => {
      inverse = null;
    };
    const toGrid = (clientX, clientY) => {
      const host = canvas.offsetParent;
      if (!host || !canvas.offsetWidth) return null;
      if (!inverse) {
        const cs = getComputedStyle(canvas);
        const m = new DOMMatrix(cs.transform === "none" ? "" : cs.transform);
        const [ox = 0, oy = 0] = cs.transformOrigin.split(" ").map(parseFloat);
        // The matrix acts about transform-origin, so re-anchor it to the
        // element's own top-left before inverting.
        inverse = new DOMMatrix()
          .translate(ox, oy)
          .multiply(m)
          .translate(-ox, -oy)
          .inverse();
      }
      // Untransformed top-left of the canvas, in page space.
      const hr = host.getBoundingClientRect();
      const p = inverse.transformPoint(
        new DOMPoint(
          clientX - (hr.left + canvas.offsetLeft),
          clientY - (hr.top + canvas.offsetTop),
        ),
      );
      if (p.x < 0 || p.y < 0 || p.x > canvas.offsetWidth) return null;
      if (p.y > canvas.offsetHeight) return null;
      // overflow:hidden means only the host's box is actually visible — a
      // touch on the clipped-away part of the canvas must not ignite.
      if (
        clientX < hr.left ||
        clientX > hr.right ||
        clientY < hr.top ||
        clientY > hr.bottom
      )
        return null;
      return { x: p.x / canvas.offsetWidth, y: p.y / canvas.offsetHeight };
    };

    // Shared by real pointermove and the no-move trigger below (scroll
    // sliding the figure under a resting cursor should ignite too).
    const igniteAt = (clientX, clientY) => {
      const st = stateRef.current;
      if (!st || !activeRef.current) return;
      const now = Date.now();
      if (now < st.decodeEndsAt) return; // let the decode finish first
      const at = toGrid(clientX, clientY);
      if (!at) return;
      const mouseCol = at.x * COLS;
      const mouseRow = at.y * st.rows;

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

    const onMove = (e) => igniteAt(e.clientX, e.clientY);
    // Capture-phase scroll: element scrollers' scroll events don't bubble,
    // but they do capture — this catches the overlay's own scrolling.
    const onScroll = () => {
      const p = lastPointer();
      if (p) igniteAt(p.x, p.y);
    };

    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerdown", onMove);
    document.addEventListener("scroll", onScroll, {
      capture: true,
      passive: true,
    });
    // The cached matrix goes stale when the breakpoint flips the crop between
    // upright and turned.
    window.addEventListener("resize", invalidate);
    window.addEventListener("orientationchange", invalidate);
    return () => {
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerdown", onMove);
      document.removeEventListener("scroll", onScroll, { capture: true });
      window.removeEventListener("resize", invalidate);
      window.removeEventListener("orientationchange", invalidate);
    };
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
