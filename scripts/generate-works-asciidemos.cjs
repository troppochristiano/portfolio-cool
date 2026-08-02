// Composes the "ascii widgets" works images from real screenshots of the two
// demo apps (ascii-widgets on :5180, ascii-persona on :5182), captured in
// headless Chrome. Not a build step — the outputs are committed:
//   node scripts/generate-works-asciidemos.cjs
//
// The panel is 4:5, so the shots are CAPTURED at 4:5 rather than cropped into
// it. A landscape grab contain-fitted into 800x1000 shrinks to half the panel
// and leaves a dead letterbox, and auto-cropping to the ink bbox doesn't help
// because the full-width nav bar makes the content as wide as the page. The
// widget pages are shot at 640x800@3x instead, where the card grid reflows to
// two columns and fills the frame; only the persona (an 800px fixed-size
// viewer that can't reflow that narrow) is shot wide and cropped.
//
// EXPOSURE: these demos draw near-black-on-black on purpose — the accent is
// #0000ff, which is legible on a lit screen and nearly invisible in a webp
// thumbnail. Each panel carries a brightness multiplier so the glyphs survive
// the trip into the works panel. Black stays black (modulate is multiplicative),
// so this lifts the ink without greying the field.
//
// Re-capturing: see scripts/README-shots.md.

const fs = require("fs");
const path = require("path");
const sharp = require("sharp");

const SHOTS = process.env.ASCII_SHOTS || path.resolve(__dirname, ".cache-asciidemos");
const OUT = path.resolve(__dirname, "../public/works");
const W = 800;
const H = 1000;


const PANELS = [
  // src (already 4:5 unless cropped), out, brightness, optional crop
  ["index.png", "ascii-widgets-1.webp", 1.0],
  // Shot at 1000x1250 because the viewer is a fixed 800px square; this crop is
  // the title + control strip + head, which IS 4:5 on its own.
  ["persona.png", "ascii-widgets-2.webp", 1.2, { left: 287, top: 0, width: 1438, height: 1798 }],
  ["noise-text.png", "ascii-widgets-3.webp", 1.2],
  ["portrait.png", "ascii-widgets-4.webp", 2.4],
];

// 480x168 = the 160x56 row hover thumb at 3x. No text is readable at 160px
// wide, so the thumb is the index's card grid read as a pattern — bordered
// modules in a grid, which is what the project actually is.
const THUMB = {
  src: "index.png",
  crop: { left: 0, top: 700, width: 1920, height: 672 },
  brightness: 1.5,
  out: "ascii-widgets-thumb.webp",
};

if (!fs.existsSync(SHOTS)) {
  console.error(
    `no screenshots at ${SHOTS}\n` +
      `Capture them first (see scripts/README-shots.md) or set ASCII_SHOTS.`
  );
  process.exit(1);
}

(async () => {
  for (const [src, out, brightness, crop] of PANELS) {
    const file = path.join(SHOTS, src);
    if (!fs.existsSync(file)) {
      console.log(`  skip ${src} (missing)`);
      continue;
    }
    let img = sharp(file);
    if (crop) img = img.extract(crop);

    await img
      .modulate({ brightness })
      .resize({ width: W, height: H, fit: "cover" })
      .webp({ quality: 88 })
      .toFile(path.join(OUT, out));

    const m = await sharp(path.join(OUT, out)).metadata();
    console.log(
      `${out.padEnd(24)} from ${src.padEnd(16)} ${m.width}x${m.height}  x${brightness}  ` +
        `${Math.round(fs.statSync(path.join(OUT, out)).size / 1024)}KB`
    );
  }

  const thumbSrc = path.join(SHOTS, THUMB.src);
  if (fs.existsSync(thumbSrc)) {
    await sharp(thumbSrc)
      .extract(THUMB.crop)
      .modulate({ brightness: THUMB.brightness })
      .resize({ width: 480, height: 168 })
      .webp({ quality: 90 })
      .toFile(path.join(OUT, THUMB.out));
    console.log(
      `${THUMB.out.padEnd(24)} 480x168  ` +
        `${Math.round(fs.statSync(path.join(OUT, THUMB.out)).size / 1024)}KB`
    );
  }
})();
