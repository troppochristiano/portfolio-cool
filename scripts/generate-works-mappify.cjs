// Builds the Mappify Works images from the app's OWN screenshots
// (mappify/docs/screenshots/*.png, 2560x1600 = a 1280x800 window at 2x) — not
// a build step:
//   node scripts/generate-works-mappify.cjs
//
// The shots are of the real app on a real library (headless Chrome against
// `npm run dev`, signed in with a throwaway local session). On the compare
// screens the friend's name and Spotify profile picture were swapped in the
// page for "A friend" and a plain "F" disc before shooting — their library and
// the numbers are real, but a third person doesn't belong on a public site.
//
// PANEL images (800x1000, 4:5), one per feature, in the order they cycle:
//   1. the globe — every place in the library
//   2. search narrowed to one playlist ("Japan"): 30 tracks, all in Japan
//   3. an artist's origin and where it came from (MusicBrainz / Wikidata)
//   4. a playlist built from a place and its neighbours (London)
//   5. compare with a friend: match score, overlap counts, their rings
//   6. the shareable match card
// Every shot is landscape, so each is cropped to the side sheet plus as much
// map as the story needs, then CONTAIN-fitted onto black (the app's own
// background) — the thin bands vanish and nothing gets cut.
// THUMB (480x168 = the 160x56 row hover thumb at 3x) — the whole globe on
// black. At 56px tall it still reads as "a planet with dots on it", which a
// crop of labels or list rows would not.
//
// collab.png and player.png are captured too but not used: the collaboration
// panel is mostly empty space at this size, and the embedded player shows a
// "Preview" badge when the capturing browser isn't signed into Spotify.

const fs = require("fs");
const path = require("path");
const sharp = require("sharp");

const SHOTS =
  process.env.MAPPIFY_SHOTS ||
  path.resolve(__dirname, "../../mappify/docs/screenshots");
const OUT = path.resolve(__dirname, "../public/works");

const W = 800;
const H = 1000;
const BLACK = { r: 0, g: 0, b: 0, alpha: 1 };

// Boxes measured off the 2560x1600 shots. The side sheet spans x 26–744.
const PANELS = [
  // The globe and its outermost labels (Kingston, Mumbai). The collapsed
  // bottom sheet's corner pokes into the box; `blank` paints it back to black.
  ["hero.png", { left: 590, top: 190, width: 1400, height: 1230 }, "mappify-1.webp",
    { left: 0, top: 1150, width: 160, height: 80 }],
  // The "playlist Japan" chip and the Japanese places it leaves on the globe.
  ["filter.png", { left: 0, top: 0, width: 1424, height: 1600 }, "mappify-2.webp"],
  // Franco Battiato's origin, its provenance, and northern Italy behind it.
  ["info.png", { left: 0, top: 0, width: 1340, height: 1600 }, "mappify-3.webp"],
  // A London playlist, with the British Isles out to London itself.
  ["playlist.png", { left: 0, top: 0, width: 1560, height: 1600 }, "mappify-4.webp"],
  // The match panel and the friend's rings over Europe.
  ["compare.png", { left: 0, top: 0, width: 1560, height: 1600 }, "mappify-5.webp"],
  // The match card, centred.
  ["card.png", { left: 770, top: 120, width: 1020, height: 1340 }, "mappify-6.webp"],
];

const THUMB_SRC = "hero.png";
const THUMB_GLOBE = { left: 680, top: 200, width: 1200, height: 1200 };

if (!fs.existsSync(path.join(SHOTS, "hero.png"))) {
  console.error(
    `Mappify screenshots not found at ${SHOTS}\n` +
      `Pass MAPPIFY_SHOTS=/path/to/mappify/docs/screenshots`
  );
  process.exit(1);
}

const kb = (f) => Math.round(fs.statSync(f).size / 1024);
const blackBox = (w, h) =>
  sharp({ create: { width: w, height: h, channels: 3, background: BLACK } });

(async () => {
  for (const [file, crop, out, blank] of PANELS) {
    const dest = path.join(OUT, out);
    let cropped = await sharp(path.join(SHOTS, file)).extract(crop).png().toBuffer();
    if (blank) {
      const patch = await blackBox(blank.width, blank.height).png().toBuffer();
      cropped = await sharp(cropped)
        .composite([{ input: patch, left: blank.left, top: blank.top }])
        .png()
        .toBuffer();
    }
    const inner = await sharp(cropped)
      .resize({ width: W, height: H, fit: "inside" })
      .toBuffer();
    await blackBox(W, H)
      .composite([{ input: inner, gravity: "centre" }])
      .webp({ quality: 90 })
      .toFile(dest);
    console.log(`${out}  ${W}x${H}  ${kb(dest)}KB`);
  }

  const thumb = path.join(OUT, "mappify-thumb.webp");
  const globe = await sharp(path.join(SHOTS, THUMB_SRC))
    .extract(THUMB_GLOBE)
    .resize({ width: 168, height: 168 })
    .toBuffer();
  await blackBox(480, 168)
    .composite([{ input: globe, gravity: "centre" }])
    .webp({ quality: 92 })
    .toFile(thumb);
  console.log(`mappify-thumb.webp  480x168  ${kb(thumb)}KB`);
})();
