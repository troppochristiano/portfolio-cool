import { useEffect } from "react";
import { prefersReducedMotion } from "../lib/utils.js";

// Blocky → full-res image decode on a canvas — the downsample/upscale trick
// from github.com/agentPritam47/pixel-image. Each step draws the source tiny
// into the top-left, then reads that little region back and stretches it over
// the whole canvas with smoothing off, so early steps are chunky pixels and
// the last (size 1, smooth) resolves to the real image.
//
// Shared by the cursor-trailing works hover preview and the in-panel cycling
// image. Re-runs (replaying the decode) whenever `src`, `revealKey`, or
// `enabled` changes — parents bump `revealKey` to force a replay on the same
// src. `boxRef` supplies the pixel size (the canvas is stretched to fill it by
// CSS); with `watchResize` the settled frame is redrawn when the box resizes
// (needed in-flow, where the column width tracks the viewport — the fixed-size
// hover preview skips it).
const PX_STEPS = [2, 5, 6, 8, 100]; // % of full res per step — last one is full
const STEP_MS = 80; // gap between decode steps
const INITIAL_MS = 90; // first-frame delay (kept short for a snappy trigger)

export function usePixelDecode({
  canvasRef,
  boxRef,
  src,
  revealKey = 0,
  enabled = true,
  watchResize = false,
}) {
  useEffect(() => {
    if (!enabled || !src) return;
    const box = boxRef.current;
    const canvas = canvasRef.current;
    if (!box || !canvas) return;
    const ctx = canvas.getContext("2d");

    let pxIndex = 0;
    let timer = 0;
    let cancelled = false;
    let loaded = false;
    const img = new Image();
    img.crossOrigin = "anonymous";
    let ratio = 1;

    const render = () => {
      const cw = box.offsetWidth;
      const ch = box.offsetHeight;
      if (!cw || !ch) return;
      canvas.width = cw;
      canvas.height = ch;

      // Slight over-scan so upscaled pixels bleed past the edges (no seams).
      const w = cw * 1.05;
      const h = ch * 1.05;
      // Cover-fit the over-scanned box, then centre the result on the CANVAS.
      // Centring against w/h instead (the old bug) leaves the draw anchored at
      // the origin, so the whole 5% hangs off the right and bottom and nothing
      // off the left and top — subtle on abstract art, obvious the moment a
      // real screenshot with visible edges goes through here.
      let dw = w;
      let dh = Math.round(w / ratio);
      if (w / h <= ratio) {
        dh = h;
        dw = Math.round(h * ratio);
      }
      const dx = (cw - dw) / 2;
      const dy = (ch - dh) / 2;

      // Clamped: resize redraws land here after the decode finished, when
      // pxIndex has walked past the end — they redraw the final full-res step.
      const size = PX_STEPS[Math.min(pxIndex, PX_STEPS.length - 1)] * 0.01;
      ctx.imageSmoothingEnabled = size === 1;
      ctx.clearRect(0, 0, cw, ch);
      // Downsample into the corner, then blow that small region back up.
      ctx.drawImage(img, 0, 0, w * size, h * size);
      ctx.drawImage(canvas, 0, 0, w * size, h * size, dx, dy, dw, dh);
    };

    const step = () => {
      if (cancelled || pxIndex >= PX_STEPS.length) return;
      timer = window.setTimeout(
        () => {
          render();
          pxIndex += 1;
          step();
        },
        pxIndex === 0 ? INITIAL_MS : STEP_MS,
      );
    };

    img.onload = () => {
      if (cancelled) return;
      loaded = true;
      ratio = img.width / img.height || 1;
      if (prefersReducedMotion()) {
        pxIndex = PX_STEPS.length - 1; // jump straight to full res
        render();
      } else {
        step();
      }
    };
    img.src = src;

    // The observer fires once on observe() — before the image exists — so
    // redraws are gated on `loaded`.
    let ro;
    if (watchResize && typeof ResizeObserver !== "undefined") {
      ro = new ResizeObserver(() => {
        if (loaded) render();
      });
      ro.observe(box);
    }

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      ro?.disconnect();
    };
  }, [src, revealKey, enabled, watchResize, canvasRef, boxRef]);
}
