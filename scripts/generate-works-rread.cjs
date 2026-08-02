// Builds the RRead Works images from the app's OWN screenshots
// (Rread/rread/docs/screenshots/*.png, 2560x1600 each) — not a build step:
//   node scripts/generate-works-rread.cjs
//
// Two different jobs, two different treatments:
//
// PANEL images (800x1000, 4:5) — the shots are 16:10, and the works panel
// cover-fits them into a 4:5 box, which would crop a landscape UI down to a
// useless centre strip. So each shot is first cropped to just its content
// (the app is heavily inset in the viewport), then CONTAIN-fitted onto a
// canvas painted with the screenshot's own background colour, so the
// letterbox is invisible and nothing is cut off.
//
// THUMB (480x168 = the 160x56 row hover thumb at 3x) — a contain-fit whole
// screenshot is unreadable at 56px tall, so this one is a tight 1:1 crop of
// the reading view centred on the highlighted word: at thumb size it still
// reads as mono text with one word lit, which is the whole product.

const fs = require("fs");
const path = require("path");
const sharp = require("sharp");

const SHOTS =
  process.env.RREAD_SHOTS ||
  path.resolve(__dirname, "../../Rread/rread/docs/screenshots");
const OUT = path.resolve(__dirname, "../public/works");

const W = 800;
const H = 1000;

// Content boxes measured off the 2560x1600 shots (the app card is inset in
// the viewport; margins are generous so nothing important sits on an edge).
const CROPS = {
  reading: { left: 540, top: 30, width: 1480, height: 1540 },
  landing: { left: 570, top: 40, width: 1420, height: 1540 },
  // The library slides in against the right edge, so this one is cropped to
  // the panel (plus a sliver of the dimmed page behind it for depth) rather
  // than to a centred card.
  library: { left: 1500, top: 20, width: 1060, height: 1560 },
};

// Panel order: the reading view leads (it shows the actual feature), then the
// entry screen and the library, then the pair again in the light theme.
const PANELS = [
  ["reading-dark.png", "reading", "rread-1.webp"],
  ["landing-dark.png", "landing", "rread-2.webp"],
  ["library-dark.png", "library", "rread-3.webp"],
  ["reading-light.png", "reading", "rread-4.webp"],
  ["landing-light.png", "landing", "rread-5.webp"],
];

// The thumb ends up 160x56 CSS px in the works row, which is far too small for
// body text — a prose crop collapses into an unreadable smudge. Take the one
// region with large, high-contrast shapes instead: the RREAD wordmark, the
// dotted rule and the voice picker, which still reads as "an app" at that size.
// 2.86:1 to match the strip, off the landing shot rather than the reading one.
const THUMB_SRC = "landing-dark.png";
const THUMB_CROP = { left: 600, top: 140, width: 1360, height: 476 };

if (!fs.existsSync(path.join(SHOTS, "reading-dark.png"))) {
  console.error(
    `RRead screenshots not found at ${SHOTS}\n` +
      `Pass RREAD_SHOTS=/path/to/rread/docs/screenshots`
  );
  process.exit(1);
}

(async () => {
  for (const [file, kind, out] of PANELS) {
    const src = path.join(SHOTS, file);
    // The shot's own background colour, sampled from a corner pixel, so the
    // contain-fit bands read as part of the screenshot rather than as bars.
    const corner = await sharp(src)
      .extract({ left: 8, top: 8, width: 4, height: 4 })
      .raw()
      .toBuffer();
    const bg = { r: corner[0], g: corner[1], b: corner[2], alpha: 1 };

    const inner = await sharp(src)
      .extract(CROPS[kind])
      .resize({ width: W, height: H, fit: "inside", withoutEnlargement: false })
      .toBuffer();

    await sharp({
      create: { width: W, height: H, channels: 3, background: bg },
    })
      .composite([{ input: inner, gravity: "centre" }])
      .webp({ quality: 90 })
      .toFile(path.join(OUT, out));

    const meta = await sharp(path.join(OUT, out)).metadata();
    console.log(
      `${out}  ${meta.width}x${meta.height}  bg rgb(${bg.r},${bg.g},${bg.b})  ` +
        `${Math.round(fs.statSync(path.join(OUT, out)).size / 1024)}KB`
    );
  }

  const thumb = "rread-thumb.webp";
  await sharp(path.join(SHOTS, THUMB_SRC))
    .extract(THUMB_CROP)
    .resize({ width: 480, height: 168 })
    .webp({ quality: 92 })
    .toFile(path.join(OUT, thumb));
  console.log(
    `${thumb}  480x168  ${Math.round(
      fs.statSync(path.join(OUT, thumb)).size / 1024
    )}KB`
  );
})();
