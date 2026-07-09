// Shared micro-helpers. One home for the utilities that were previously
// re-declared per file.

export const clamp = (v, min, max) => (v < min ? min : v > max ? max : v);
export const clamp01 = (v) => clamp(v, 0, 1);

// Monospace advance ≈ 0.6 × font size — the ratio the fit/thumbnail
// calculations assume when estimating a frame's rendered width from cols.
export const MONO_ADVANCE = 0.6;

export const easeInOutCubic = (t) =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

// Media-query helpers, queried live. Callers that want evaluate-once
// semantics capture the result at module load themselves.
export const prefersReducedMotion = () =>
  typeof window !== "undefined" &&
  window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

export const isCoarsePointer = () =>
  typeof window !== "undefined" &&
  window.matchMedia?.("(pointer: coarse)").matches;

// [r,g,b] → '#rrggbb'.
export const rgbToHex = (r, g, b) =>
  "#" + [r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("");

// Pointer/mouse event position within an element's bounding rect, as clamped
// 0..1 fractions. The rect is returned too so callers can scale further.
export function pointerFracInRect(e, el) {
  const rect = el.getBoundingClientRect();
  return {
    x: clamp01((e.clientX - rect.left) / rect.width),
    y: clamp01((e.clientY - rect.top) / rect.height),
    rect,
  };
}

export const fmtTime = (s) => {
  if (!isFinite(s) || s < 0) s = 0;
  return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
};
