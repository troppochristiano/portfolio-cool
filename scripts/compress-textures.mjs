// One-time texture recompression for the hero avatar grids.
//
// Color frames (public/outputs/meBW/expressions/**/*.webp) were exported at
// output_quality 100 — massively over-encoded for 512px B&W photography. This
// re-encodes them in place at a sane lossy quality.
//
// Depth maps (public/outputs/meBW/depth/*.webp.depth.png) are RGB PNGs storing
// grayscale data. They become near-lossless WebP (written alongside as
// *.webp.depth.webp) — near-lossless, not lossy, because the depth texture
// drives both vertex displacement AND the fragment background-key threshold;
// lossy ringing at the key edge would fringe/flicker the silhouette.
//
// Usage:
//   node scripts/compress-textures.mjs --dry-run
//   node scripts/compress-textures.mjs
//   node scripts/compress-textures.mjs --prune-only       # delete depth .png that have a .webp sibling; no re-encoding
//
// NOTE: the script is a ONE-TIME migration. Re-running the color pass over
// already-recompressed frames stacks lossy generations — restore originals from
// git first if you need to re-run with different settings.
//   node scripts/compress-textures.mjs --quality=72 --depth-scale=0.5
//   node scripts/compress-textures.mjs --sample=out-dir   # write old-vs-new montages, no other writes
//
// Files are only ever replaced with smaller versions (never inflated). The
// originals' rollback is git — commit public/outputs before running.

import { readdir, readFile, writeFile, unlink, mkdir } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const ROOT = path.resolve(import.meta.dirname, "..");
const EXPRESSIONS_DIR = path.join(ROOT, "public", "outputs", "meBW", "expressions");
const DEPTH_DIR = path.join(ROOT, "public", "outputs", "meBW", "depth");
const BACKPLATE = path.join(ROOT, "public", "photos", "IMG_6750BW_HIGHCONTRAST.JPG");

const args = new Map(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, "").split("=");
    return [k, v ?? true];
  }),
);
const DRY = args.has("dry-run");
const PRUNE_ONLY = args.has("prune-only");
const QUALITY = Number(args.get("quality")) || 72;
const DEPTH_SCALE = Number(args.get("depth-scale")) || 1;
const SAMPLE_DIR = typeof args.get("sample") === "string" ? args.get("sample") : null;

const kb = (n) => `${(n / 1024).toFixed(1)} KB`;
const mb = (n) => `${(n / 1024 / 1024).toFixed(2)} MB`;

async function pool(tasks, limit = 8) {
  const results = [];
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, tasks.length) }, async () => {
      while (i < tasks.length) results.push(await tasks[i++]());
    }),
  );
  return results;
}

// Re-encode one file; returns { before, after, written }. Writing is skipped on
// dry-run and when the re-encode comes out larger than the original.
async function convert(srcPath, dstPath, encode) {
  const input = await readFile(srcPath);
  const output = await encode(sharp(input));
  const sameFile = srcPath === dstPath;
  const inflated = sameFile && output.length >= input.length;
  const written = !DRY && !inflated;
  if (written) {
    // Retry transient Windows write failures (file momentarily locked by a
    // watcher/server/AV scan) so one flaky open doesn't abort the whole batch.
    for (let attempt = 1; ; attempt++) {
      try {
        await writeFile(dstPath, output);
        break;
      } catch (err) {
        if (attempt >= 3) throw err;
        await new Promise((r) => setTimeout(r, 250 * attempt));
      }
    }
  }
  return { before: input.length, after: inflated ? input.length : output.length, written };
}

async function report(label, results) {
  const before = results.reduce((s, r) => s + r.before, 0);
  const after = results.reduce((s, r) => s + r.after, 0);
  const pct = before ? (((before - after) / before) * 100).toFixed(1) : "0";
  console.log(
    `${label.padEnd(28)} ${String(results.length).padStart(4)} files  ${mb(before)} -> ${mb(after)}  (-${pct}%)${DRY ? "  [dry-run]" : ""}`,
  );
  return { before, after };
}

const encodeColor = (img) => img.webp({ quality: QUALITY, effort: 6 }).toBuffer();
const encodeDepth = (img) => {
  if (DEPTH_SCALE !== 1) img = img.resize({ width: Math.round(512 * DEPTH_SCALE) });
  return img.webp({ nearLossless: true, quality: 60, effort: 6 }).toBuffer();
};

// Old-vs-new side-by-side montages for eyeballing regressions before committing.
async function writeSamples(dir) {
  await mkdir(dir, { recursive: true });
  const neutral = path.join(EXPRESSIONS_DIR, "neutral");
  const colorFiles = (await readdir(neutral)).filter((f) => f.endsWith(".webp")).sort();
  const depthFiles = (await readdir(DEPTH_DIR)).filter((f) => f.endsWith(".png")).sort();
  // Corner pose, center pose, extreme pitch — the frames most likely to show artifacts.
  const picks = (files) => [files[0], files[Math.floor(files.length / 2)], files[files.length - 1]];

  for (const [label, folder, files, encode] of [
    ["color", neutral, picks(colorFiles), encodeColor],
    ["depth", DEPTH_DIR, picks(depthFiles), encodeDepth],
  ]) {
    for (const f of files) {
      const src = path.join(folder, f);
      const oldPng = await sharp(await readFile(src)).png().toBuffer();
      const newPng = await sharp(await encode(sharp(await readFile(src)))).png().toBuffer();
      const meta = await sharp(oldPng).metadata();
      const montage = await sharp({
        create: {
          width: meta.width * 2 + 8,
          height: meta.height,
          channels: 3,
          background: { r: 255, g: 0, b: 0 },
        },
      })
        .composite([
          { input: oldPng, left: 0, top: 0 },
          { input: newPng, left: meta.width + 8, top: 0 },
        ])
        .png()
        .toBuffer();
      const out = path.join(dir, `${label}_${f.replace(/\.[^.]+$/, "")}_old-vs-new.png`);
      await writeFile(out, montage);
      console.log(`sample: ${out}`);
    }
  }
}

async function main() {
  if (SAMPLE_DIR) {
    await writeSamples(path.resolve(SAMPLE_DIR));
    return;
  }

  // Prune-only: remove depth PNG originals whose WebP replacement already exists.
  if (PRUNE_ONLY) {
    let n = 0;
    for (const f of await readdir(DEPTH_DIR)) {
      if (!f.endsWith(".png")) continue;
      const webp = path.join(DEPTH_DIR, f.replace(/\.png$/, ".webp"));
      const hasWebp = await readFile(webp).then(() => true, () => false);
      if (hasWebp) {
        await unlink(path.join(DEPTH_DIR, f));
        n++;
      }
    }
    console.log(`pruned ${n} depth .png originals`);
    return;
  }

  // Color frames: same name, same format, just re-encoded.
  const colorTasks = [];
  for (const expr of await readdir(EXPRESSIONS_DIR)) {
    const dir = path.join(EXPRESSIONS_DIR, expr);
    for (const f of await readdir(dir)) {
      if (!f.endsWith(".webp")) continue;
      const p = path.join(dir, f);
      colorTasks.push(() => convert(p, p, encodeColor));
    }
  }
  const colorTotals = await report(`color frames (q${QUALITY})`, await pool(colorTasks));

  // Depth maps: *.webp.depth.png -> *.webp.depth.webp (near-lossless).
  const depthTasks = [];
  const depthPngs = (await readdir(DEPTH_DIR)).filter((f) => f.endsWith(".png"));
  for (const f of depthPngs) {
    const src = path.join(DEPTH_DIR, f);
    const dst = path.join(DEPTH_DIR, f.replace(/\.png$/, ".webp"));
    depthTasks.push(() => convert(src, dst, encodeDepth));
  }
  const depthLabel = `depth maps (near-lossless${DEPTH_SCALE !== 1 ? `, ${DEPTH_SCALE}x` : ""})`;
  const depthTotals = await report(depthLabel, await pool(depthTasks));

  // Backplate photo: JPG -> WebP alongside (referenced from src/photos.js).
  const backplate = await convert(
    BACKPLATE,
    BACKPLATE.replace(/\.JPG$/i, ".webp"),
    (img) => img.webp({ quality: 78, effort: 6 }).toBuffer(),
  );
  console.log(`backplate photo               1 file   ${kb(backplate.before)} -> ${kb(backplate.after)}${DRY ? "  [dry-run]" : ""}`);

  const before = colorTotals.before + depthTotals.before + backplate.before;
  const after = colorTotals.after + depthTotals.after + backplate.after;
  console.log(`\nTOTAL ${mb(before)} -> ${mb(after)}  (saved ${mb(before - after)})`);
  if (DRY) console.log("dry-run: nothing written");
  else console.log("note: old depth .png files kept; run --prune-only after validating");
}

await main();
