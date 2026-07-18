import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { isCoarsePointer, prefersReducedMotion } from "../lib/utils.js";

// Floating image that trails the cursor while a Works row is hovered and
// decodes from blocky → full resolution — the canvas downsample/upscale trick
// from github.com/agentPritam47/pixel-image, retriggered on every hover instead
// of once on scroll. Each step draws the source tiny into the top-left, then
// reads that little region back and stretches it over the whole canvas with
// smoothing off, so early steps are chunky pixels and the last (size 1, smooth)
// resolves to the real image.
const PX_STEPS = [2, 5, 6, 8, 100]; // % of full res per step — last one is full
const STEP_MS = 80; // gap between decode steps
const INITIAL_MS = 90; // first-frame delay (kept short for a snappy hover)
const FOLLOW = 0.2; // cursor-follow easing (0..1 per frame; 1 = rigid)

// The preview lives in a portal on <body>: the overlay is transformed/clipped by
// the dissolve reveal, and a position:fixed child of a transformed ancestor
// would anchor to that ancestor instead of the viewport. On <body> it tracks
// clientX/clientY cleanly and floats above everything.
export function WorksHoverPreview({ src, revealKey, visible, pointerRef }) {
  const wrapRef = useRef(null);
  const canvasRef = useRef(null);
  const stateRef = useRef({ x: 0, y: 0, seeded: false });

  // Never mount on touch — there is no hover to drive it.
  const coarse = useRef(isCoarsePointer()).current;

  // Follow the cursor. One rAF loop for the lifetime of the component; it eases
  // the element toward the latest pointer sample so a fast flick doesn't snap.
  useEffect(() => {
    if (coarse) return;
    let raf = 0;
    const loop = () => {
      const el = wrapRef.current;
      const p = pointerRef.current;
      const s = stateRef.current;
      if (el && p) {
        if (!s.seeded) {
          s.x = p.x;
          s.y = p.y;
          s.seeded = true;
        } else {
          s.x += (p.x - s.x) * FOLLOW;
          s.y += (p.y - s.y) * FOLLOW;
        }
        el.style.transform = `translate3d(${s.x}px, ${s.y}px, 0)`;
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [coarse, pointerRef]);

  // Reseed the follow point when a new hover starts, so the preview appears at
  // the cursor rather than sliding in from wherever the last one ended.
  useEffect(() => {
    if (visible) stateRef.current.seeded = false;
  }, [visible, revealKey]);

  // Load the hovered image and run the decode. Re-runs on every hover
  // (revealKey changes) so the pixelation replays each time, not just on src
  // change.
  useEffect(() => {
    if (coarse || !src || !visible) return;
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;
    const ctx = canvas.getContext("2d");

    let pxIndex = 0;
    let timer = 0;
    let cancelled = false;
    const img = new Image();
    img.crossOrigin = "anonymous";
    let ratio = 1;

    const render = () => {
      const cw = wrap.offsetWidth;
      const ch = wrap.offsetHeight;
      if (!cw || !ch) return;
      canvas.width = cw;
      canvas.height = ch;

      // Slight over-scan so upscaled pixels bleed past the edges (no seams).
      const w = cw * 1.05;
      const h = ch * 1.05;
      let dw = w;
      let dh = h;
      let dx = 0;
      let dy = 0;
      // Cover-fit, centered on both axes.
      if (w / h > ratio) {
        dh = Math.round(w / ratio);
        dy = (h - dh) / 2;
      } else {
        dw = Math.round(h * ratio);
        dx = (w - dw) / 2;
      }

      const size = PX_STEPS[pxIndex] * 0.01;
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
      ratio = img.width / img.height || 1;
      if (prefersReducedMotion()) {
        pxIndex = PX_STEPS.length - 1; // jump straight to full res
        render();
      } else {
        step();
      }
    };
    img.src = src;

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [src, revealKey, visible, coarse]);

  if (coarse) return null;

  return createPortal(
    <div
      ref={wrapRef}
      className={`works-preview${visible ? " is-visible" : ""}`}
      aria-hidden="true"
    >
      <canvas ref={canvasRef} className="works-preview__canvas" />
    </div>,
    document.body,
  );
}
