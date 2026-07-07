// Pure grid-step generator copied from the repo's constants.ts so the component has
// no dependency back into the host project. Given an X/Y grid size and a filename
// prefix, it produces the per-cell rotation/pupil values and the matching filename
// for each pre-rendered frame.

const ROTATE_BOUND = 20;
const PUPIL_BOUND = 15;

function round(value, precision) {
  return Math.round(value * precision) / precision;
}

export function generateSteps({ X_STEPS, Y_STEPS, PREFIX }) {
  const steps = Array.from({ length: Y_STEPS }, (_, y) =>
    Array.from({ length: X_STEPS }, (_, x) => {
      const index = y * X_STEPS + x;
      // Horizontal Head Rotation - X-axis 20 = look left. -20 = look right.
      const rotate_yaw =
        X_STEPS === 1
          ? 0
          : round(ROTATE_BOUND * 2 * (x / (X_STEPS - 1)) - ROTATE_BOUND, 10);
      // Vertical Head Rotation - Y-axis. 20 = look down. -20 = look up.
      const rotate_pitch =
        Y_STEPS === 1
          ? 0
          : round(ROTATE_BOUND * 2 * (y / (Y_STEPS - 1)) - ROTATE_BOUND, 10);

      const pupil_x =
        X_STEPS === 1
          ? 0
          : round(PUPIL_BOUND * 2 * (x / (X_STEPS - 1)) - PUPIL_BOUND, 10);
      const pupil_y =
        Y_STEPS === 1
          ? 0
          : round((PUPIL_BOUND * 2 * (y / (Y_STEPS - 1)) - PUPIL_BOUND) * -1, 10);

      return {
        x,
        y,
        index,
        rotate_yaw,
        rotate_pitch,
        pupil_x,
        pupil_y,
        filename: `${PREFIX}_${String(index).padStart(
          3,
          '0'
        )}_${x}_${y}_yaw${rotate_yaw}_pitch${rotate_pitch}_px${pupil_x}_py${pupil_y}.webp`,
        crop_factor: 1.5,
        output_quality: 100,
      };
    })
  );

  return { PREFIX, Y_STEPS, X_STEPS, steps };
}

// Evenly-spaced source indices for an axis, endpoints included, e.g. pick(5, 10) ->
// [0, 2, 5, 7, 9] and pick(3, 10) -> [0, 5, 9]. n === 1 -> the center cell. Used to
// thin a rendered grid down to a smaller display grid.
function pickIndices(n, total) {
  if (n >= total) return Array.from({ length: total }, (_, i) => i);
  if (n <= 1) return [Math.floor((total - 1) / 2)];
  return Array.from({ length: n }, (_, i) =>
    Math.round((i * (total - 1)) / (n - 1))
  );
}

// Thin a generated grid (from generateSteps) down to a displayX × displayY grid by
// sub-sampling evenly-spaced rows/columns of the *already-rendered* frames. The frames
// only exist on disk at the source resolution's exact yaw/pitch, so we keep each chosen
// cell's original `filename` (and angle fields) and only re-map its `x`/`y`/`index` into
// the smaller display grid — so [y][x] indexing and the `topRowsOnly` `s.y` filter both
// operate in display space. A size >= the source returns the grid unchanged. Returns the
// same shape as generateSteps so callers are drop-in.
export function subsampleSteps(stepsResult, displayX, displayY) {
  const { PREFIX, X_STEPS, Y_STEPS, steps } = stepsResult;
  const xs = pickIndices(displayX, X_STEPS);
  const ys = pickIndices(displayY, Y_STEPS);
  if (xs.length === X_STEPS && ys.length === Y_STEPS) return stepsResult;

  const sampled = ys.map((srcY, y) =>
    xs.map((srcX, x) => ({
      ...steps[srcY][srcX], // keep the real filename + rendered yaw/pitch/pupil values
      x,
      y,
      index: y * xs.length + x,
    }))
  );

  return { PREFIX, X_STEPS: xs.length, Y_STEPS: ys.length, steps: sampled };
}
