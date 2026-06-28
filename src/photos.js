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
    // Only neutral (base) + blink (auto-blink loop) are ever shown, so we load just
    // those two grids. Dropping smile/smileBlink avoids preloading ~200 GPU textures
    // that are never used. The folders still exist under public/outputs/meBW.
    expressions: {
      neutral: "neutral",
      blink: "blink",
    },
  },
};
