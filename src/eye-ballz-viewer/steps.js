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
