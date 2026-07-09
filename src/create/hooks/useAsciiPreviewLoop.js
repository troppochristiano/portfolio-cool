import { useCallback, useEffect, useRef } from "react";
import { prefersReducedMotion } from "../../lib/utils.js";
import { sampleFrame } from "../sampleFrame.js";

/**
 * The two ASCII render loops. Live mode samples the active source every frame
 * (no React state per frame — the <pre>s are written directly); baked mode
 * plays the baked frames at their fps. Both write to the main monitor AND the
 * floating mini-monitor through the returned refs.
 */
export function useAsciiPreviewLoop({
  hasSource,
  sourceType,
  mode,
  baked,
  settingsRef,
  canvasRef,
  activeSource,
  sourceReady,
}) {
  const previewRef = useRef(null); // <pre> the live ASCII is written to
  const previewEdgeRef = useRef(null); // overlay <pre> for tinted edge glyphs (when split)
  const miniPreviewRef = useRef(null); // <pre> in the floating mobile mini-monitor
  const miniPreviewEdgeRef = useRef(null); // overlay <pre> for the mini-monitor's edges

  // Write the base glyphs (and, when split, the tinted edge overlay) to both
  // the main monitor and the floating mini-monitor. The edge <pre>s are cleared
  // when there's no edge layer so a stale overlay never lingers.
  const writeLayers = useCallback((base, edge) => {
    if (previewRef.current) previewRef.current.textContent = base;
    if (miniPreviewRef.current) miniPreviewRef.current.textContent = base;
    const e = edge ?? "";
    if (previewEdgeRef.current) previewEdgeRef.current.textContent = e;
    if (miniPreviewEdgeRef.current) miniPreviewEdgeRef.current.textContent = e;
  }, []);

  // ── live preview rAF loop (no React state per frame) ──────────
  useEffect(() => {
    if (!hasSource || mode !== "live") return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    let raf = 0;

    const render = () => {
      const s = settingsRef.current;
      const src = activeSource();
      if (s && src && sourceReady(src) && s.rows > 0 && previewRef.current) {
        const out = sampleFrame(ctx, canvas, src, s);
        if (typeof out === "string") writeLayers(out, null);
        else writeLayers(out.frame, out.edgeFrame);
      }
      raf = requestAnimationFrame(render);
    };
    raf = requestAnimationFrame(render);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasSource, sourceType, mode, writeLayers]);

  // ── baked playback loop ───────────────────────────────────────
  useEffect(() => {
    if (mode !== "baked" || !baked) return;
    const reduce = prefersReducedMotion();
    const write = (i) =>
      writeLayers(baked.frames[i], baked.edgeFrames?.[i] ?? null);
    write(0);
    if (reduce || baked.frames.length <= 1) return;
    let raf = 0,
      i = 0,
      last = performance.now();
    const interval = 1000 / baked.fps;
    const tick = (now) => {
      if (now - last >= interval) {
        last = now;
        i = (i + 1) % baked.frames.length;
        write(i);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [mode, baked, writeLayers]);

  return { previewRef, previewEdgeRef, miniPreviewRef, miniPreviewEdgeRef };
}
