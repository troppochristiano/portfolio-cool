import { SUPERSAMPLE, convertFrame, convertFrameLayers } from "./asciify.js";

/**
 * Draw the current source frame into the offscreen canvas and return the
 * ascii for it. `source` is a <video> or <canvas> — drawImage handles both.
 * With blockAvg on, the canvas is SUPERSAMPLE× the grid and each cell
 * averages its block. A crop maps only that region of the source onto the
 * grid. The canvas is cleared first because the image source can carry
 * transparency (cut regions) that must not reveal the previous frame.
 */
export function sampleFrame(ctx, canvas, source, s) {
  const ss = s.blockAvg ? SUPERSAMPLE : 1;
  const w = s.cols * ss;
  const h = s.rows * ss;
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  ctx.clearRect(0, 0, w, h);
  const natW = source.videoWidth || source.width;
  const natH = source.videoHeight || source.height;
  const c = s.crop;
  if (c && natW && natH) {
    ctx.drawImage(
      source,
      c.x * natW,
      c.y * natH,
      c.w * natW,
      c.h * natH,
      0,
      0,
      w,
      h,
    );
  } else {
    ctx.drawImage(source, 0, 0, w, h);
  }
  const { data } = ctx.getImageData(0, 0, w, h);
  const opts = {
    cols: s.cols,
    rows: s.rows,
    ramp: s.ramp,
    invert: s.invert,
    gamma: s.gamma,
    contrast: s.contrast,
    key: { mode: s.keyMode, threshold: s.keyThreshold, color: s.keyColor },
    dither: s.dither,
    edge: s.edge,
  };
  // A distinct edge color needs the ramp and edges on separately-tinted layers;
  // otherwise the single combined string is the exact default output.
  return s.splitEdges
    ? convertFrameLayers(data, w, h, opts)
    : convertFrame(data, w, h, opts);
}
