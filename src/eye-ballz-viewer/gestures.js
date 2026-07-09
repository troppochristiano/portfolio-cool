// Gesture engine. Drives the avatar's grid look-cell (h.xIndex / h.yIndex) along a
// keyframe path so the *face itself* turns through the pre-rendered yaw/pitch frames —
// the same mechanism mouse-look uses, NOT a mesh rotation. Every gesture first eases
// smoothly back to the neutral center cell, then sweeps its axis through the keyframes.
// Adding a new gesture = adding one entry to GESTURES; it then auto-surfaces in the
// imperative API and the debug panel.

import { easeInOutCubic } from "../lib/utils.js";

const easeInOutSine = (t) => -(Math.cos(Math.PI * t) - 1) / 2;

// Hermite smoothstep of x across [edge0, edge1], clamped to 0..1.
const smoothstep = (edge0, edge1, x) => {
  const u = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return u * u * (3 - 2 * u);
};

// Each gesture:
//   axis        which grid axis sweeps — 'x' = yaw (left/right), 'y' = pitch (up/down).
//   recenterMs  time to ease from the current look back to the neutral center cell.
//   durationMs  length of the nod track that follows the recenter.
//   keyframes   [{ t: 0..1, offset: -1..1 }]. offset is a fraction of the axis half-range
//               around center (-1 = top/left edge cell, +1 = bottom/right edge cell).
//               Segments interpolate with easeInOutCubic for smooth, settling motion.
//
// 2D variant: keyframes of [{ t, x, y }] (both offsets in -1..1) drive yaw AND pitch
// together — no `axis` field. Detected per-gesture by the first keyframe having `x`.
export const GESTURES = {
  // "Yes": pitch down, up, a smaller dip, settle. y increases downward in the grid.
  nodYes: {
    axis: "y",
    recenterMs: 260,
    durationMs: 850,
    keyframes: [
      { t: 0, offset: 0 },
      { t: 0.25, offset: 0.85 },
      { t: 0.5, offset: -0.5 },
      { t: 0.75, offset: 0.35 },
      { t: 1, offset: 0 },
    ],
  },
  // "No": yaw left, right, a smaller swing, settle.
  nodNo: {
    axis: "x",
    recenterMs: 260,
    durationMs: 900,
    keyframes: [
      { t: 0, offset: 0 },
      { t: 0.2, offset: -0.85 },
      { t: 0.45, offset: 0.85 },
      { t: 0.7, offset: -0.5 },
      { t: 0.9, offset: 0.3 },
      { t: 1, offset: 0 },
    ],
  },
  // Intro look-around: continuous circular gaze motion matching the gallery orbit —
  // no keyframes, sampled parametrically (see the `type: "circle"` branch in
  // sampleGesture). The gaze spirals out from center, sweeps `turns` revolutions at
  // `radius` (fraction of the grid half-range), and spirals back to center, with the
  // angular speed globally eased so it starts and stops gently — never stalling at
  // edges the way per-segment keyframe easing does.
  lookAround: {
    type: "circle",
    recenterMs: 300,
    durationMs: 4200,
    turns: 1.25,
    radius: 0.85,
  },
};

export function listGestures() {
  return Object.keys(GESTURES);
}

// Neutral (center) cell index for an axis of `steps` cells. May be fractional for an
// even grid; rounded when applied to a discrete cell.
const centerIndex = (steps) => (steps - 1) / 2;

const clampIndex = (i, steps) => Math.max(0, Math.min(steps - 1, i));

// Begin a gesture. Captures the spec, start time, and the cell currently looked at
// (so phase 1 can ease it back to center). Returns null for an unknown name.
export function startGesture(name, h) {
  const spec = GESTURES[name];
  if (!spec) return null;
  return { name, spec, start: performance.now(), fromX: h.xIndex, fromY: h.yIndex };
}

// Sample the gesture's target cell for `now`. Returns { xIndex, yIndex, done }.
//   Phase 1 (recenter): ease the start cell toward the neutral center over recenterMs.
//   Phase 2 (nod): hold the off-axis at center, drive the active axis along the keyframes.
export function sampleGesture(inst, now, h) {
  const { spec } = inst;
  const cx = centerIndex(h.xSteps);
  const cy = centerIndex(h.ySteps);
  const elapsed = now - inst.start;

  if (elapsed < spec.recenterMs) {
    const e = easeInOutCubic(elapsed / spec.recenterMs);
    return {
      xIndex: clampIndex(Math.round(inst.fromX + (cx - inst.fromX) * e), h.xSteps),
      yIndex: clampIndex(Math.round(inst.fromY + (cy - inst.fromY) * e), h.ySteps),
      done: false,
    };
  }

  const t = (elapsed - spec.recenterMs) / spec.durationMs;
  if (t >= 1) {
    return { xIndex: Math.round(cx), yIndex: Math.round(cy), done: true };
  }

  // Circle gesture: parametric circular motion (yaw + pitch on a circle). The angle
  // is eased globally (gentle start/stop, constant sweep in the middle) and the
  // radius ramps in/out over the first/last 15%, so the gaze spirals out from
  // neutral, orbits, and spirals home — continuous, no per-keyframe stalls.
  if (spec.type === "circle") {
    const eased = easeInOutSine(t);
    const theta = (spec.turns ?? 1) * Math.PI * 2 * eased;
    const r =
      (spec.radius ?? 0.85) * smoothstep(0, 0.15, t) * (1 - smoothstep(0.85, 1, t));
    // Counterclockwise on screen (grid +y looks down), matching the orbit's spin.
    const ox = r * Math.cos(theta);
    const oy = -r * Math.sin(theta);
    return {
      xIndex: clampIndex(Math.round(cx + ox * cx), h.xSteps),
      yIndex: clampIndex(Math.round(cy + oy * cy), h.ySteps),
      done: false,
    };
  }

  // 2D gesture: both axes follow their own keyframe track (yaw + pitch together).
  if (spec.keyframes[0].x !== undefined) {
    const ox = sampleKeyframes(spec.keyframes, t, "x");
    const oy = sampleKeyframes(spec.keyframes, t, "y");
    return {
      xIndex: clampIndex(Math.round(cx + ox * cx), h.xSteps),
      yIndex: clampIndex(Math.round(cy + oy * cy), h.ySteps),
      done: false,
    };
  }

  const offset = sampleKeyframes(spec.keyframes, t);
  const center = spec.axis === "x" ? cx : cy;
  const idx = clampIndex(
    Math.round(center + offset * center),
    spec.axis === "x" ? h.xSteps : h.ySteps,
  );
  return {
    xIndex: spec.axis === "x" ? idx : Math.round(cx),
    yIndex: spec.axis === "y" ? idx : Math.round(cy),
    done: false,
  };
}

// Piecewise interpolation of keyframes at progress t∈[0,1], easing each segment with
// easeInOutCubic. `field` picks the sampled property: "offset" (single-axis gestures,
// default) or "x"/"y" (2D gestures).
function sampleKeyframes(keyframes, t, field = "offset") {
  for (let i = 1; i < keyframes.length; i++) {
    const b = keyframes[i];
    if (t <= b.t) {
      const a = keyframes[i - 1];
      const span = b.t - a.t || 1;
      const e = easeInOutCubic((t - a.t) / span);
      return a[field] + (b[field] - a[field]) * e;
    }
  }
  return keyframes[keyframes.length - 1][field];
}
