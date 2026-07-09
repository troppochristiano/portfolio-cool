import { useCallback, useState } from "react";
import { gzipSize } from "../asciify.js";
import { buildStyle } from "../styleOptions.js";
import { sampleFrame } from "../sampleFrame.js";

const seekTo = (v, t) =>
  new Promise((res) => {
    const onSeeked = () => {
      v.removeEventListener("seeked", onSeeked);
      res();
    };
    v.addEventListener("seeked", onSeeked);
    v.currentTime = Math.min(t, Math.max(0, v.duration - 1e-3));
  });

/**
 * Owns the baked output and the live/baked view mode. `bake(ctx)` receives the
 * full sampling context from the caller — settingsRef is the same object the
 * live preview reads, so bake output always matches the preview exactly.
 * `invalidate()` is what every source/crop change calls to drop a stale bake.
 */
export function useBake() {
  const [baking, setBaking] = useState(false);
  const [bakeProgress, setBakeProgress] = useState(0);
  const [baked, setBaked] = useState(null); // { cols, rows, fps, frames, … }
  const [sizes, setSizes] = useState({ raw: null, gz: null });
  const [mode, setMode] = useState("live"); // 'live' | 'baked'

  const invalidate = useCallback(() => {
    setBaked(null);
    setMode("live");
    setBakeProgress(0);
  }, []);

  // cellPx (the tuned display size) rides along so a player can size the figure
  // exactly as previewed here. name/createdAt identify the figure once it's
  // uploaded to the backend; players ignore keys they don't know.
  const finishBake = async (ctx, frames, edgeFrames) => {
    const name = ctx.fileName
      ? ctx.fileName.replace(/\.[^.]+$/, "")
      : ctx.isStill
        ? "drawing"
        : "untitled";
    // The typography/colors controls become the optional `style` block —
    // omitted entirely at defaults so plain bakes stay byte-identical.
    const style = buildStyle(ctx.style);
    const result = {
      cols: ctx.cols,
      rows: ctx.rows,
      fps: ctx.fps,
      color: false,
      cellPx: ctx.cellPx,
      name,
      createdAt: new Date().toISOString(),
      ...(style ? { style } : {}),
      frames,
      // Only present when a distinct edge color split the render — the tinted
      // edge glyphs on their own layer, one entry per base frame.
      ...(edgeFrames ? { edgeFrames } : {}),
    };
    setBaked(result);
    setMode("baked");
    setBaking(false);
    const json = JSON.stringify(result);
    const raw = new Blob([json]).size;
    const gz = await gzipSize(json);
    setSizes({ raw, gz });
  };

  const bake = async (ctx) => {
    const canvas = ctx.canvasRef.current;
    const c2d = canvas.getContext("2d", { willReadFrequently: true });
    // Single source of truth — the same settings object the live preview
    // reads (kept in sync by its effect), so bake output always matches the
    // preview exactly. A hand-rolled copy here once silently dropped the
    // newer keys (contrast, edge) and baked without them.
    const settings = ctx.settingsRef.current;

    // sampleFrame returns a plain string normally, or { frame, edgeFrame } when
    // the settings request a split edge layer — collect the edge frames in
    // parallel so they line up with the base frames one-to-one.
    const split = settings.splitEdges;
    const push = (out, frames, edgeFrames) => {
      if (split) {
        frames.push(out.frame);
        edgeFrames.push(out.edgeFrame);
      } else {
        frames.push(out);
      }
    };

    // Photos and drawings are a single still — sample once.
    if (ctx.isStill) {
      const src = ctx.activeSource();
      if (!src || !ctx.sourceReady(src) || ctx.rows <= 0) return;
      setBaking(true);
      setBakeProgress(100);
      const frames = [];
      const edgeFrames = [];
      push(sampleFrame(c2d, canvas, src, settings), frames, edgeFrames);
      await finishBake(ctx, frames, split ? edgeFrames : undefined);
      return;
    }

    // Video: seek across the clip, sample each frame.
    const v = ctx.videoRef.current;
    if (!v || !ctx.duration) return;
    v.pause();
    setBaking(true);
    setMode("live");
    setBakeProgress(0);

    // Only the trimmed range is sampled (the whole clip when untrimmed).
    const total = Math.max(1, Math.round((ctx.trimEnd - ctx.trimStart) * ctx.fps));
    const frames = [];
    const edgeFrames = [];
    for (let f = 0; f < total; f++) {
      await seekTo(v, ctx.trimStart + f / ctx.fps);
      push(sampleFrame(c2d, canvas, v, settings), frames, edgeFrames);
      setBakeProgress(Math.round(((f + 1) / total) * 100));
      // yield so the progress bar can paint
      if (f % 4 === 0) await new Promise((r) => setTimeout(r, 0));
    }
    await finishBake(ctx, frames, split ? edgeFrames : undefined);
  };

  return { baking, bakeProgress, baked, sizes, mode, setMode, invalidate, bake };
}
