// Gesture engine. Drives the avatar's grid look-cell (h.xIndex / h.yIndex) along a
// keyframe path so the *face itself* turns through the pre-rendered yaw/pitch frames —
// the same mechanism mouse-look uses, NOT a mesh rotation. Every gesture first eases
// smoothly back to the neutral center cell, then sweeps its axis through the keyframes.
// Adding a new gesture = adding one entry to GESTURES; it then auto-surfaces in the
// imperative API and the debug panel.

const easeInOutCubic = (t) =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

// Each gesture:
//   axis        which grid axis sweeps — 'x' = yaw (left/right), 'y' = pitch (up/down).
//   recenterMs  time to ease from the current look back to the neutral center cell.
//   durationMs  length of the nod track that follows the recenter.
//   keyframes   [{ t: 0..1, offset: -1..1 }]. offset is a fraction of the axis half-range
//               around center (-1 = top/left edge cell, +1 = bottom/right edge cell).
//               Segments interpolate with easeInOutCubic for smooth, settling motion.
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

// Piecewise interpolation of [{ t, offset }] keyframes at progress t∈[0,1], easing
// each segment with easeInOutCubic.
function sampleKeyframes(keyframes, t) {
  for (let i = 1; i < keyframes.length; i++) {
    const b = keyframes[i];
    if (t <= b.t) {
      const a = keyframes[i - 1];
      const span = b.t - a.t || 1;
      const e = easeInOutCubic((t - a.t) / span);
      return a.offset + (b.offset - a.offset) * e;
    }
  }
  return keyframes[keyframes.length - 1].offset;
}
