import { useCallback, useEffect, useRef } from "react";
import { prefersReducedMotion } from "../../lib/utils.js";
import { sampleFrame } from "../sampleFrame.js";

/**
 * The two ASCII render loops. Live mode samples the active source whenever it
 * (or a setting) has actually changed (no React state per frame — the <pre>s
 * are written directly); baked mode plays the baked frames at their fps. Both
 * write to the main monitor AND the floating mini-monitor through the returned
 * refs, and both stop entirely while neither monitor is on screen.
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
  sourceVersionRef,
  settingsVersionRef,
  previewHidden,
  miniShown,
  videoEpoch,
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
  // Nothing on screen is showing the ascii (the monitor has scrolled away and
  // the mini is hidden or dismissed) — don't convert frames nobody can see.
  useEffect(() => {
    if (!hasSource || mode !== "live" || previewHidden) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    let raf = 0;

    // ~30fps cap: each pass is a full pixel readback + ascii conversion + <pre>
    // rewrite, and uncapped rAF ran it at the display's native 60–144Hz — for a
    // source that is at most ~30fps itself (video/webcam) or fully static (an
    // image). The glyph grid can't show the extra samples; they only burn CPU.
    const FRAME_MS = 1000 / 30;
    let last = 0;

    // A pass is only worth running when something feeding it actually changed.
    // The <video> advertises that through currentTime (it moves on every
    // decoded frame and on every seek); the image canvas has no such signal,
    // so useImageCanvas bumps a counter on each composite. Settings carry
    // their own counter, bumped alongside settingsRef.
    //
    // Without this the loop re-converted a perfectly static photo 30×/s
    // forever to produce a byte-identical string. Measured cost of one pass:
    // ~2ms on desktop at any quality (the floor is drawImage of the full
    // source + a getImageData readback, not the conversion), several times
    // that on a phone — i.e. a third of the main thread, permanently, for
    // nothing. `null` forces the first pass after every (re)subscribe.
    let lastSig = null;

    const render = (now) => {
      if (now - last >= FRAME_MS) {
        last = now;
        const s = settingsRef.current;
        const src = activeSource();
        if (s && src && sourceReady(src) && s.rows > 0 && previewRef.current) {
          const srcSig =
            sourceType === "video" ? src.currentTime : sourceVersionRef.current;
          const sig = `${srcSig}|${settingsVersionRef.current}`;
          if (sig !== lastSig) {
            lastSig = sig;
            const out = sampleFrame(ctx, canvas, src, s);
            if (typeof out === "string") writeLayers(out, null);
            else writeLayers(out.frame, out.edgeFrame);
          }
        }
      }
      raf = requestAnimationFrame(render);
    };
    raf = requestAnimationFrame(render);
    return () => cancelAnimationFrame(raf);
    // The last three deps are here for the forced repaint a re-subscribe
    // brings, not for anything the loop body reads: the mini <pre> mounts
    // empty (a dirty check would leave it blank until the source next
    // changed), and videoEpoch covers the pixel changes currentTime can't see.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    hasSource,
    sourceType,
    mode,
    writeLayers,
    previewHidden,
    miniShown,
    videoEpoch,
  ]);

  // ── baked playback loop ───────────────────────────────────────
  // Playhead survives a pause: scrolling the monitor off screen and back
  // resumes where it left off instead of snapping to frame 0 (the same jump
  // AsciiPlayer's shownRef exists to avoid on the hero wall).
  const bakedIndexRef = useRef(0);
  useEffect(() => {
    bakedIndexRef.current = 0;
  }, [baked]);
  useEffect(() => {
    if (mode !== "baked" || !baked || previewHidden) return;
    const reduce = prefersReducedMotion();
    const write = (i) =>
      writeLayers(baked.frames[i], baked.edgeFrames?.[i] ?? null);
    let i = Math.min(bakedIndexRef.current, baked.frames.length - 1);
    write(i);
    if (reduce || baked.frames.length <= 1) return;
    let raf = 0,
      last = performance.now();
    const interval = 1000 / baked.fps;
    const tick = (now) => {
      if (now - last >= interval) {
        last = now;
        i = (i + 1) % baked.frames.length;
        bakedIndexRef.current = i;
        write(i);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [mode, baked, writeLayers, previewHidden, miniShown]);

  return { previewRef, previewEdgeRef, miniPreviewRef, miniPreviewEdgeRef };
}
