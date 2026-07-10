export const photos = {
  meBW: {
    PREFIX: "meBW",
    X_STEPS: 10,
    Y_STEPS: 10,
    // neutral (base) + blink (auto-blink loop) load in full. smile/smileBlink are only
    // ever shown by the "rub the forehead to smile" easter-egg, which happens while the
    // avatar looks up — i.e. the top rows of the grid — so we load only those rows
    // (see topRowsOnly) instead of the full ~200 GPU textures.
    expressions: {
      neutral: "neutral",
      blink: "blink",
      smile: "smile",
      smileBlink: "smileBlink",
    },
    // Load only the top N grid rows (y < N) for these expressions. The forehead easter-egg
    // only shows look-up poses, so we skip the lower ~40% of each grid. 6 rows comfortably
    // covers every cell the forehead circle can land on (its box bottom ≈ row 4, and the
    // pointer loops a little below the circle's center).
    topRowsOnly: {
      smile: 6,
      smileBlink: 6,
    },
  },
};
