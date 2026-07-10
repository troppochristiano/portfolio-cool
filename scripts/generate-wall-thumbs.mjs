// Build-time thumbs for the static hero-wall figures (public/data/*.json).
//
// The wall only ever displays figures downsampled to WALL_MAX_COLS (96) — see
// AsciiGallery.jsx — but static planes used to fetch the full figure.json
// (24–58 KB gzipped each) just to stride-sample it in the browser. This emits
// public/data/thumbs/NAME.json twins using the exact same downsample the
// client applies, so planes fetch the small file and the full figure is only
// pulled on desktop hover / in the info dialog.
//
// Runs automatically via the npm `prebuild` hook; idempotent, safe to re-run.
//   node scripts/generate-wall-thumbs.mjs

import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { downsampleFigure } from "../src/lib/downsampleFigure.js";

const ROOT = path.resolve(import.meta.dirname, "..");
const DATA_DIR = path.join(ROOT, "public", "data");
const OUT_DIR = path.join(DATA_DIR, "thumbs");
const MAX_COLS = 96; // keep in sync with WALL_MAX_COLS in AsciiGallery.jsx

const kb = (n) => `${(n / 1024).toFixed(1)} KB`;

await mkdir(OUT_DIR, { recursive: true });
const entries = await readdir(DATA_DIR, { withFileTypes: true });
const files = entries
  .filter((e) => e.isFile() && e.name.endsWith(".json"))
  .map((e) => e.name)
  .sort();

let before = 0;
let after = 0;
for (const f of files) {
  const raw = await readFile(path.join(DATA_DIR, f), "utf8");
  const parsed = JSON.parse(raw);
  const down = downsampleFigure(parsed, MAX_COLS);
  // `wallThumb` marks genuinely downsampled copies: the wall skips its hover
  // fetch of the full figure when the marker is absent (thumb === full, e.g.
  // figures already at <=96 cols whose weight is frame count, not resolution).
  const out = JSON.stringify(down === parsed ? parsed : { ...down, wallThumb: true });
  await writeFile(path.join(OUT_DIR, f), out);
  before += raw.length;
  after += out.length;
  console.log(`${f.padEnd(20)} ${kb(raw.length)} -> ${kb(out.length)}${down === parsed ? "  (already <=96 cols, kept as-is)" : ""}`);
}
console.log(`wall thumbs: ${files.length} figures, ${kb(before)} -> ${kb(after)}`);
