// this is just a list of generated items so I can reference them

export const photos = {
  // wes: {
  //   filename: 'photos/wes-straight-on.jpg',
  //   PREFIX: 'wes-big',
  //   X_STEPS: 25,
  //   Y_STEPS: 25,
  // },
  // // norma: {
  // //   filename: 'photos/norma.jpg',
  // //   PREFIX: 'norma',
  // //   X_STEPS: 10,
  // //   Y_STEPS: 10,
  // // },
  // bert: {
  //   filename: 'photos/bert.jpg',
  //   PREFIX: 'bert',
  //   X_STEPS: 5,
  //   Y_STEPS: 5,
  // },
  // weshandsome: {
  //   filename: 'photos/wes-handsome.jpg',
  //   PREFIX: 'wes-handsome',
  //   X_STEPS: 1,
  //   Y_STEPS: 10,
  // },
  // arnold: {
  //   filename: 'photos/arnold.jpg',
  //   PREFIX: 'arnold',
  //   X_STEPS: 8,
  //   Y_STEPS: 1,
  // },
  // bean: {
  //   filename: 'photos/bean.webp',
  //   PREFIX: 'bean',
  //   X_STEPS: 3,
  //   Y_STEPS: 3,
  // },
  // snickers: {
  //   filename: 'photos/snickers.jpg',
  //   PREFIX: 'snickers',
  //   X_STEPS: 10,
  //   Y_STEPS: 10,
  // },
  // scottwes: {
  //   filename: 'photos/scott-wes.png',
  //   PREFIX: 'scott-wes',
  //   X_STEPS: 10,
  //   Y_STEPS: 10,
  // }
  // me: {
  //   filename: "photos/IMG_6750.JPG",
  //   PREFIX: "me",
  //   X_STEPS: 10,
  //   Y_STEPS: 10,
  //   // Expression color grids, as subfolder names under outputs/me/expressions/.
  //   // Depth is shared (outputs/me/depth). The React viewer preloads every available
  //   // expression and swaps with no stutter. `neutral`/`smile` are the selectable base
  //   // expressions; `blink`/`smileBlink` are flashed on top by the auto-blink loop.
  //   expressions: {
  //     neutral: "neutral",
  //     blink: "blink",
  //     smile: "smile",
  //     smileBlink: "smileBlink",
  //   },
  // },
  meBW: {
    filename: "photos/IMG_6750BW_HIGHCONTRAST.JPG",
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
