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

// The house rule for hover-driven flourishes (scrambles, cursors, followers):
// they exist only for fine pointers and only when motion is welcome.
export const hoverEffectsDisabled = () =>
  prefersReducedMotion() || isCoarsePointer();

// Device pixel ratio clamped into [min, max] — the canvas backing-store scale.
// Most canvases cap at 2 (retina detail, bounded fill cost); callers that need
// a floor (e.g. the portrait's fine face glyphs) pass a higher `min`.
export const clampedDpr = (max = 2, min = 1) =>
  clamp(window.devicePixelRatio || 1, min, max);

// [r,g,b] → '#rrggbb'.
export const rgbToHex = (r, g, b) =>
  "#" + [r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("");

// '#rgb' / '#rrggbb' (# optional) → [r,g,b], or null for anything that isn't a
// complete valid hex color — a half-typed value keys nothing instead of
// throwing. (createConstants' asciify.js keeps a private copy to stay
// dependency-free; this is the canonical one for everything else.)
export function hexToRgb(hex) {
  if (typeof hex !== "string") return null;
  let h = hex.trim().replace(/^#/, "");
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  if (h.length !== 6 || /[^0-9a-f]/i.test(h)) return null;
  const num = parseInt(h, 16);
  return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
}

// Rec. 601 luma from 0..255 RGB, still on the 0..255 scale. The one set of
// coefficients every JS sampling site shares (the GLSL shader repeats them —
// keep in sync with eye-ballz-viewer/shader.js if they ever change).
export const luma601 = (r, g, b) => 0.299 * r + 0.587 * g + 0.114 * b;

// In-place Fisher–Yates; returns the same array (plain or typed).
export function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const t = arr[i];
    arr[i] = arr[j];
    arr[j] = t;
  }
  return arr;
}

// Bytes → human string on a single site-wide format ("512 B", "3.4 KB",
// "1.2 MB", "0.02 GB"); '—' for null/NaN (e.g. gzip probe unsupported).
export function formatBytes(n) {
  if (!Number.isFinite(n)) return "—";
  if (n < 1024) return `${Math.round(n)} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}

// setPointerCapture that tolerates the pointer vanishing mid-gesture (device
// sleep, tab switch) — every drag surface wants the same try/catch.
export const capturePointer = (e, el = e.currentTarget) => {
  try {
    el.setPointerCapture(e.pointerId);
  } catch {
    /* pointer already gone — the drag just won't capture */
  }
};

// Dev-knob URL params (?cell=5, ?plate=0.35, …), read once at module scope by
// their consumers. `queryNumber` returns the clamped finite number or
// `fallback` for absent/invalid values.
export const queryParam = (name) =>
  typeof window === "undefined"
    ? null
    : new URLSearchParams(window.location.search).get(name);

export const queryNumber = (name, { min = -Infinity, max = Infinity, fallback = null } = {}) => {
  const raw = queryParam(name);
  if (raw === null) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? clamp(n, min, max) : fallback;
};

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

// m:ss by default; pass `dp` for sub-second precision (m:ss.dd), which trim
// points need — a whole second is many frames.
export const fmtTime = (s, dp = 0) => {
  if (!isFinite(s) || s < 0) s = 0;
  // Quantise BEFORE splitting off the minutes: rounding afterwards lets
  // 59.999 at dp=2 carry inside the minute and print "0:60.00".
  const p = 10 ** dp;
  const q = dp ? Math.round(s * p) / p : Math.floor(s);
  const m = Math.floor(q / 60);
  const rest = q - m * 60;
  const ss = dp
    ? rest.toFixed(dp).padStart(dp + 3, "0")
    : String(rest).padStart(2, "0");
  return `${m}:${ss}`;
};
