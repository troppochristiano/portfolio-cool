// Builds the cobrains Works images and the real client logos from the
// company's own site, recovered from the Internet Archive (co-brains.com is
// gone, and the pasted browser screenshots carried the Wayback toolbar).
// Not a build step — the outputs are committed:
//   node scripts/generate-works-cobrains.cjs
//
// PANEL images: the three project mockups the site published — a backoffice
// module dashboard (ta design), a real-time energy monitor (GEM) and a
// production monitor (Bersano). They're transparent PNGs of light devices, so
// each is trimmed, contain-fitted and composited onto the panel's own black:
// the device reads as floating, and nothing is cropped.
//
// THUMB: the company's own white wordmark on black. A device mockup is mush at
// the 160x56 hover strip and a chart crop reads as "some chart"; the brand mark
// is the one thing that survives the size and says whose work this is.
//
// LOGOS: the client strip's real files. Every one is a dark mark on real
// transparency, so they're trimmed to their ink and flattened to white in CSS
// (filter: brightness(0) invert(1)) to sit on the dark panel.

const fs = require("fs");
const path = require("path");
const sharp = require("sharp");

const OUT = path.resolve(__dirname, "../public/works");
const LOGOS = path.join(OUT, "clients");
const CACHE = path.join(__dirname, ".cache-cobrains");
const SNAP = "https://web.archive.org/web/20240503142439im_/https://co-brains.com/wp-content/uploads";

const MOCKUPS = [
  ["2021/06/mockup-TA-e1630329160703.png", "ta.png", "cobrains-1.webp"],
  ["2021/06/mockup-gem-e1630329150193.png", "gem.png", "cobrains-2.webp"],
  ["2021/06/mockup-bersano-e1629800330450.png", "bersano.png", "cobrains-3.webp"],
];

// Only the marks Christian listed; the archive also holds cimberio, ispirata,
// digitalnology and gem logos if the strip should ever show the full roster.
// LOWILL never appeared in any capture of co-brains.com, so it comes from the
// client's own site instead (a white-on-transparent mark — the CSS flatten
// handles either polarity).
const CLIENT_LOGOS = [
  ["2021/09/dkc-logo.png", "dkc"],
  ["2021/09/sisal-logo.png", "sisal"],
  ["2021/09/subito-logo.png", "subito"],
  ["2021/09/mcgarlet-logo.png", "mcgarlet"],
  ["2021/09/moog-logo.png", "moog"],
  ["2021/09/ta-logo.png", "ta-design"],
  ["2021/10/njanalitics-logo.png", "notjustanalytics"],
  [
    "https://www.lowillsound.it/wp-content/uploads/2023/05/logo-lowill-white-e1704815057379.png",
    "lowill",
  ],
];

// Every logo is written onto an IDENTICAL canvas so the strip has one rhythm:
// height-locking alone left MOOG 208px wide next to a 26px ta design. 4:1 sits
// near the median mark aspect, so wide wordmarks fill the width and compact
// marks fill the height without either being punished.
const LOGO_BOX_W = 336; // 112 CSS px at 3x
const LOGO_BOX_H = 84; //  28 CSS px at 3x — the marquee item height
const LOGO_PAD = 6;
// Fitting to the box alone still leaves a 7.4:1 wordmark optically thinner
// than a square mark, so each is nudged toward equal INK AREA — but only
// halfway, and never upscaled past its own box fit: full equalisation would
// shrink the compact marks to nothing to match a thin wordmark.
const EQUALISE = 0.5;
const MIN_SCALE = 0.72;

const W = 800;
const H = 1000;
const PAD = 40;
const LOGO_H = 84; // 28px in the marquee, at 3x

// The official white wordmark (334x50, grey+alpha) drives the hover thumb.
const WORDMARK = ["2021/08/logo-white-1-e1631524798350.png", "logo-white.png"];
const THUMB_W = 480;
const THUMB_H = 168;
const THUMB_MARK_W = 372; // leaves an even margin either side at 2.857:1

const isPng = (buf) =>
  buf.length > 8 && buf.subarray(0, 4).toString("hex") === "89504e47";

// The archive 302s image requests onto a neighbouring capture, and sometimes
// answers with an HTML error page instead of the asset — so follow redirects,
// retry, and check the magic bytes rather than trusting the status.
async function grab(remote, cached) {
  const file = path.join(CACHE, cached);
  if (fs.existsSync(file) && isPng(fs.readFileSync(file))) {
    return fs.readFileSync(file);
  }
  fs.mkdirSync(CACHE, { recursive: true });
  const url = remote.startsWith("http") ? remote : `${SNAP}/${remote}`;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url, {
        redirect: "follow",
        headers: { "User-Agent": "Mozilla/5.0" },
      });
      const buf = Buffer.from(await res.arrayBuffer());
      if (isPng(buf)) {
        fs.writeFileSync(file, buf);
        return buf;
      }
      console.warn(`  attempt ${attempt}: not a PNG (${buf.length}B) ${cached}`);
    } catch (err) {
      console.warn(`  attempt ${attempt}: ${err.message}`);
    }
  }
  throw new Error(`could not fetch ${url}`);
}

(async () => {
  fs.mkdirSync(LOGOS, { recursive: true });

  for (const [remote, cached, out] of MOCKUPS) {
    const buf = await grab(remote, cached);
    const inner = await sharp(buf)
      .trim()
      .resize({
        width: W - PAD * 2,
        height: H - PAD * 2,
        fit: "inside",
        withoutEnlargement: false,
      })
      .toBuffer();
    await sharp({
      create: { width: W, height: H, channels: 3, background: "#000000" },
    })
      .composite([{ input: inner, gravity: "centre" }])
      .webp({ quality: 88 })
      .toFile(path.join(OUT, out));
    const kb = Math.round(fs.statSync(path.join(OUT, out)).size / 1024);
    console.log(`${out.padEnd(16)} ${W}x${H}  ${kb}KB`);
  }

  // The wordmark ships as a near-white mark on transparency; paint it flat
  // white so it can't come out dingy, then centre it on the panel's black.
  const markSrc = await grab(WORDMARK[0], WORDMARK[1]);
  const mark = await sharp(markSrc)
    .trim()
    .resize({ width: THUMB_MARK_W, fit: "inside" })
    .ensureAlpha()
    .toBuffer();
  const { data: markAlpha, info: markInfo } = await sharp(mark)
    .extractChannel(3)
    .raw()
    .toBuffer({ resolveWithObject: true });
  const whiteMark = await sharp({
    create: {
      width: markInfo.width,
      height: markInfo.height,
      channels: 3,
      background: "#ffffff",
    },
  })
    .joinChannel(markAlpha, {
      raw: { width: markInfo.width, height: markInfo.height, channels: 1 },
    })
    .png()
    .toBuffer();
  await sharp({
    create: {
      width: THUMB_W,
      height: THUMB_H,
      channels: 3,
      background: "#000000",
    },
  })
    .composite([{ input: whiteMark, gravity: "centre" }])
    .webp({ quality: 92 })
    .toFile(path.join(OUT, "cobrains-thumb.webp"));
  console.log(
    `cobrains-thumb   480x168  ${Math.round(
      fs.statSync(path.join(OUT, "cobrains-thumb.webp")).size / 1024
    )}KB`
  );

  // Pass 1 — trim each mark and fit it to the shared box, then measure how
  // much ink that actually puts on screen.
  const fitted = [];
  for (const [remote, name] of CLIENT_LOGOS) {
    const buf = await grab(remote, `logo-${name}.png`);
    const base = await sharp(buf)
      .trim()
      .resize({
        width: LOGO_BOX_W - LOGO_PAD * 2,
        height: LOGO_BOX_H - LOGO_PAD * 2,
        fit: "inside",
      })
      .ensureAlpha()
      .toBuffer();
    const { data, info } = await sharp(base)
      .raw()
      .toBuffer({ resolveWithObject: true });
    let ink = 0;
    for (let i = 3; i < data.length; i += 4) if (data[i] > 128) ink++;
    fitted.push({ name, base, ink, w: info.width, h: info.height });
  }

  // Geometric mean is the right centre here: ink areas span an order of
  // magnitude, and an arithmetic mean would let one dense mark drag it.
  const logMean =
    fitted.reduce((s, f) => s + Math.log(f.ink), 0) / fitted.length;
  const target = Math.exp(logMean);

  for (const f of fitted) {
    const full = Math.sqrt(target / f.ink); // scale for equal ink area
    const scale = Math.min(1, Math.max(MIN_SCALE, 1 + EQUALISE * (full - 1)));
    const mark = await sharp(f.base)
      .resize({
        width: Math.max(1, Math.round(f.w * scale)),
        height: Math.max(1, Math.round(f.h * scale)),
      })
      .toBuffer();
    const out = path.join(LOGOS, `${f.name}.webp`);
    await sharp({
      create: {
        width: LOGO_BOX_W,
        height: LOGO_BOX_H,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      },
    })
      .composite([{ input: mark, gravity: "centre" }])
      .webp({ quality: 92, alphaQuality: 100 })
      .toFile(out);
    console.log(
      `  clients/${(f.name + ".webp").padEnd(22)} box ${LOGO_BOX_W}x${LOGO_BOX_H}  ` +
        `mark ${Math.round(f.w * scale)}x${Math.round(f.h * scale)}  ` +
        `scale ${scale.toFixed(2)}  ${Math.round(fs.statSync(out).size / 1024)}KB`
    );
  }
})();
