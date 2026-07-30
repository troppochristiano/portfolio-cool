import { clamp } from "../lib/utils.js";

// Trim math, kept free of React and of the video element so it can be
// exercised directly.
//
// Everything snaps to the EXPORT fps grid. The reason is useBake's
// `total = round((trimEnd - trimStart) * fps)`: with continuous seconds that
// product is arbitrary, so the last sampled frame can land past the out point
// or leave a sliver unsampled. With both endpoints on the grid it's an exact
// integer and the bake is deterministic. It also makes one arrow-key press
// exactly one baked frame, and makes [ in / out ] land where the bake lands.
//
// Snapping happens on WRITE only — stored points are never re-snapped when the
// fps slider moves, since that would silently shift a cut the user already made.

/** Nearest point on the fps grid, clamped to the clip. */
export const snapT = (t, fps, duration) =>
  clamp(fps > 0 ? Math.round(t * fps) / fps : t, 0, duration);

/**
 * Shortest allowed range — at least one baked frame, and at least ~50ms,
 * rounded UP to a whole frame. The rounding matters: a raw 0.05s floor is 1.5
 * frames at fps 30, so a gap-limited range would sit off-grid and
 * (end - start) * fps would stop being an integer — the one thing the snapping
 * exists to guarantee.
 */
export const minTrim = (fps) => {
  const f = fps || 30;
  return Math.max(1, Math.ceil(0.05 * f)) / f;
};

/** Frame index of `t` within the range, and its inverse. */
export const frameOf = (t, trimStart, fps) => Math.round((t - trimStart) * fps);
export const timeOfFrame = (f, trimStart, fps) => trimStart + f / fps;

/**
 * Move one endpoint. `prev` may be null (the section was off) — it promotes to
 * a full-clip range first, so enabling and dragging in one gesture works.
 *
 * Never returns null: `trim === null` means "the trim section is off", and only
 * the toggle writes that. (The old code collapsed to null whenever the range
 * covered the whole clip, which under a toggle header would switch the section
 * off under the user's finger mid-drag.)
 */
export function applyTrimPoint(prev, t, which, { fps, duration }) {
  const gap = minTrim(fps);
  const s = prev?.start ?? 0;
  const en = prev?.end ?? duration;
  const p = snapT(t, fps, duration);
  const next =
    which === "in"
      ? { start: Math.min(p, en - gap), end: en }
      : { start: s, end: Math.max(p, s + gap) };
  // Clamp to the clip, then re-assert the gap — on a clip shorter than `gap`
  // the clamp would otherwise hand back a zero-length range.
  next.start = clamp(next.start, 0, Math.max(0, duration - gap));
  next.end = clamp(next.end, Math.min(gap, duration), duration);
  if (next.end - next.start < gap) {
    if (which === "in") next.start = Math.max(0, next.end - gap);
    else next.end = Math.min(duration, next.start + gap);
  }
  return next;
}
