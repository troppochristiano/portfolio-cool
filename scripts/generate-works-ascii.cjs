// Regenerates the four "ascii widgets" Works images (public/works/
// ascii-widgets-1..4.svg) — not a build step, run it by hand when the source
// projects change:  node scripts/generate-works-ascii.cjs
//
// Nothing here is decorative: every image is composed from the two extracted
// projects' OWN output — the eye-ballz viewer's live ASCII render, the real
// component list, a real figure.json frame, and the real noise-text alphabet.
//
// The one input that can't be read from a file is the viewer's render (it
// needs a live WebGL context), so it was captured from the running demo and
// parked in works-ascii-eyeballz.txt: a 205x104 grid block-averaged to 80x51.
// To refresh it, run the eye-ballz-ascii demo, read the .eye-ballz-ascii
// table's innerHTML (rows are separated by <br>), and block-average a ~150-col
// window down to 80 cols — frame it WIDE, tight crops turn the face into a
// solid #/@ blob.
//
// Sibling checkout expected at ../../ascii-widgets (override with
// ASCII_WIDGETS=/path/to/repo).

const fs = require("fs");
const path = require("path");

const WIDGETS =
  process.env.ASCII_WIDGETS || path.resolve(__dirname, "../../ascii-widgets");
const OUT = path.resolve(__dirname, "../public/works");
const ART = path.join(__dirname, "works-ascii-eyeballz.txt");

if (!fs.existsSync(path.join(WIDGETS, "src/lib/noiseText.js"))) {
  console.error(
    `ascii-widgets checkout not found at ${WIDGETS}\n` +
      `Clone it beside this repo, or pass ASCII_WIDGETS=/path/to/ascii-widgets.`
  );
  process.exit(1);
}

const W = 800;
const H = 1000;
const MONO = 'ui-monospace, Menlo, Consolas, &quot;DejaVu Sans Mono&quot;, monospace';

// Palette — the site's blue, split into three tiers because pure #0000ff on
// black carries only ~7% luminance and ascii art needs tonal separation to
// read at the panel's ~340px display width (same reason AsciiPortraitHover
// uses a dim body colour and a brighter face colour).
// DIM is AsciiPortraitHover's own BASE_COLOR and HOT its DETAIL_COLOR, so the
// tonal ladder here is the one the site already uses for canvas ascii.
const DIM = "#2b2bd6";
const MID = "#4a4aff";
const HOT = "#8f8fff";
const INK = "#ffffff";

// Deterministic noise so re-running the generator doesn't churn the files.
let seed = 0x5eed1234;
const rnd = () => {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 4294967296;
};

const esc = (s) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// One row of a glyph grid, split into colour layers. Every layer is padded to
// the same character count and forced to the same textLength, so the columns
// line up exactly whatever monospace font the renderer picks (Consolas'
// advance is 0.55em, Menlo's 0.6 — textLength makes that irrelevant).
function gridRow(layers, { x, y, width, fontSize }) {
  return layers
    .filter((l) => l.chars.trim().length)
    .map(
      (l) =>
        `<text x="${x}" y="${y.toFixed(1)}" xml:space="preserve" textLength="${width}" ` +
        `lengthAdjust="spacingAndGlyphs" font-family="${MONO}" font-size="${fontSize.toFixed(2)}" ` +
        `fill="${l.fill}"${l.opacity ? ` fill-opacity="${l.opacity}"` : ""}>${esc(l.chars)}</text>`
    )
    .join("\n  ");
}

// Split a row of ramp glyphs into the three brightness tiers.
function tierLayers(row, ramp) {
  const pick = (lo, hi) =>
    [...row].map((ch) => {
      const i = ramp.indexOf(ch);
      return i >= lo && i <= hi ? ch : " ";
    }).join("");
  const top = ramp.length - 1;
  const a = Math.max(1, Math.round(top * 0.25));
  const b = Math.max(a + 1, Math.round(top * 0.55));
  return [
    { chars: pick(1, a), fill: DIM },
    { chars: pick(a + 1, b), fill: MID },
    { chars: pick(b + 1, top), fill: HOT },
  ];
}

function asciiBlock(rows, ramp, { x, y, width, cellH, fontSize }) {
  const cols = Math.max(...rows.map((r) => r.length));
  return rows
    .map((r, i) =>
      gridRow(tierLayers(r.padEnd(cols), ramp), {
        x,
        y: y + (i + 0.78) * cellH,
        width,
        fontSize,
      })
    )
    .join("\n  ");
}

// Block-average a glyph grid down to `cols` wide, keeping the aspect — the
// same tonal downsample the project's own converter does (asciify.js block
// averages; downsampleFigure.js is its nearest-neighbour cousin).
function shrink(rows, ramp, cols) {
  const srcW = Math.max(...rows.map((r) => r.length));
  const srcH = rows.length;
  const factor = srcW / cols;
  const outH = Math.max(1, Math.round(srcH / factor));
  const grid = rows.map((r) => r.padEnd(srcW).split(""));
  const at = (y, x) => {
    const i = ramp.indexOf(grid[y]?.[x] ?? " ");
    return i < 0 ? 0 : i;
  };
  const out = [];
  for (let R = 0; R < outH; R++) {
    let row = "";
    for (let C = 0; C < cols; C++) {
      const x0 = Math.floor((C * srcW) / cols);
      const x1 = Math.max(Math.floor(((C + 1) * srcW) / cols), x0 + 1);
      const y0 = Math.floor((R * srcH) / outH);
      const y1 = Math.max(Math.floor(((R + 1) * srcH) / outH), y0 + 1);
      let sum = 0;
      let n = 0;
      for (let y = y0; y < y1; y++)
        for (let x = x0; x < x1; x++) {
          sum += at(y, x);
          n++;
        }
      row += ramp[Math.min(ramp.length - 1, Math.round(sum / Math.max(1, n)))];
    }
    out.push(row);
  }
  return out;
}

function trim(rows) {
  const srcW = Math.max(...rows.map((r) => r.length));
  let t = 1e9, b = -1, l = 1e9, r = -1;
  rows.forEach((ln, i) => {
    const a = ln.search(/\S/);
    if (a < 0) return;
    const z = ln.trimEnd().length - 1;
    t = Math.min(t, i); b = Math.max(b, i);
    l = Math.min(l, a); r = Math.max(r, z);
  });
  if (b < 0) return rows;
  return rows.slice(t, b + 1).map((ln) => ln.padEnd(srcW).slice(l, r + 1));
}

const svg = (body) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <rect width="${W}" height="${H}" fill="#000000"/>
  ${body}
</svg>
`;

const label = (x, y, text, size, fill, opacity, extra = "") =>
  `<text x="${x}" y="${y}" font-family="${MONO}" font-size="${size}" fill="${fill}"` +
  (opacity != null ? ` fill-opacity="${opacity}"` : "") +
  `${extra}>${esc(text)}</text>`;

// No burned-in slide counter: the panel renders its own "NN / NN" over the
// image, so one in the artwork would just be a second, redundant number.
const title = (t) => label(60, 196, t, 46, INK, null, ' font-weight="700" letter-spacing="2"');
const subtitle = (t) => label(60, 234, t, 21, HOT, 0.9, ' letter-spacing="2"');
const footer = (t) => label(60, 946, t, 18, INK, 0.45, ' letter-spacing="1"');

// ── 01 · the eye-ballz viewer's own ASCII render ────────────────────────
function imageOne() {
  const RAMP = " .:-+*=%@#"; // the viewer's shipped `characters` setting
  const raw = fs.readFileSync(ART, "utf8").replace(/\r/g, "").split("\n");
  const rows = raw.slice(0, 51);
  while (rows.length < 51) rows.push("");
  const COLS = 80;
  const cellH = H / rows.length;
  const grid = rows.map((r) => r.padEnd(COLS).slice(0, COLS));
  const body = [
    asciiBlock(grid, RAMP, {
      x: 0,
      y: 0,
      width: W,
      cellH,
      fontSize: (W / COLS) / 0.6,
    }),
    // Scrim so the caption stays legible over the glyphs. Bottom only — the
    // top one existed purely to seat the old slide counter, and without it it
    // was just dimming the top of the portrait.
    `<defs><linearGradient id="s" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#000000" stop-opacity="0"/>
      <stop offset="0.45" stop-color="#000000" stop-opacity="0.85"/>
      <stop offset="1" stop-color="#000000" stop-opacity="0.97"/>
    </linearGradient></defs>`,
    `<rect x="0" y="760" width="${W}" height="240" fill="url(#s)"/>`,
    label(60, 872, "EYE-BALLZ-ASCII", 46, INK, null, ' font-weight="700" letter-spacing="2"'),
    label(60, 912, "a photo grid, displaced in three.js, drawn as glyphs", 21, HOT, 0.9),
    footer("100 poses · 4 expressions · demand-rendered, 30fps capped"),
  ];
  return svg(body.join("\n  "));
}

// ── 02 · the component index ───────────────────────────────────────────
function imageTwo() {
  const POOL = (fs
    .readFileSync(path.join(WIDGETS, "src/lib/noiseText.js"), "utf8")
    .match(/POOL\s*=\s*"([^"]+)"/) || [])[1];
  const names = fs
    .readdirSync(path.join(WIDGETS, "src/components"))
    .filter((d) =>
      fs.statSync(path.join(WIDGETS, "src/components", d)).isDirectory()
    )
    .sort();
  const rowY = 318;
  const step = 60;
  const rows = names.map((n, i) => {
    const sample = Array.from({ length: 7 }, () =>
      POOL[Math.floor(rnd() * POOL.length)]
    ).join("");
    return [
      label(60, rowY + i * step, String(i + 1).padStart(2, "0"), 20, INK, 0.4),
      label(118, rowY + i * step, n.toUpperCase(), 27, INK, 0.92, ' letter-spacing="1"'),
      `<text x="740" y="${rowY + i * step}" text-anchor="end" font-family="${MONO}" font-size="27" fill="${MID}" xml:space="preserve">${esc(sample)}</text>`,
    ].join("\n  ");
  });
  const body = [
    `<rect x="40" y="40" width="${W - 80}" height="${H - 80}" fill="none" stroke="${INK}" stroke-opacity="0.14"/>`,
    title("ASCII WIDGETS"),
    subtitle("10 drop-in components · copy the folder"),
    `<line x1="60" y1="272" x2="740" y2="272" stroke="${INK}" stroke-opacity="0.14"/>`,
    rows.join("\n  "),
    `<line x1="60" y1="900" x2="740" y2="900" stroke="${INK}" stroke-opacity="0.14"/>`,
    footer("react 18 · no build step · MIT"),
  ];
  return svg(body.join("\n  "));
}

// ── 03 · a real figure.json frame, played by AsciiPlayer ───────────────
function imageThree() {
  const RAMP = " .:-=+*#%@"; // RAMP_PRESETS.classic — what this figure was baked with
  const fig = JSON.parse(
    fs.readFileSync(path.join(WIDGETS, "public/figures/demo-figure.json"), "utf8")
  );
  const ink = (f) => [...f].filter((c) => c !== " " && c !== "\n").length;
  const best = fig.frames
    .map((f, i) => [ink(f), i])
    .sort((a, b) => b[0] - a[0])[0][1];
  const src = trim(fig.frames[best].split("\n"));
  const COLS = 46;
  const grid = shrink(src, RAMP, COLS).map((r) => r.padEnd(COLS));
  const boxX = 50;
  const boxW = 700;
  const cellW = boxW / COLS;
  const cellH = cellW * 2; // character cells are ~twice as tall as wide
  const artH = grid.length * cellH;
  const boxY = 300;
  const body = [
    title("ASCII PLAYER"),
    subtitle("figure.json → a <pre> that plays"),
    `<rect x="${boxX}" y="${boxY - 18}" width="${boxW}" height="${(artH + 36).toFixed(1)}" fill="none" stroke="${INK}" stroke-opacity="0.14"/>`,
    asciiBlock(grid, RAMP, { x: boxX, y: boxY, width: boxW, cellH, fontSize: cellW / 0.6 }),
    label(
      60,
      862,
      `{ cols: ${fig.cols}, rows: ${fig.rows}, fps: ${fig.fps}, frames: ${fig.frames.length} }`,
      22,
      MID,
      1
    ),
    label(60, 898, "one string per frame · plain text or tinted spans", 19, INK, 0.5),
    footer("rAF-gated · transform-scaled · holds frame 0 under reduced motion"),
  ];
  return svg(body.join("\n  "));
}

// ── 04 · the noise-text sweep, mid-resolve ─────────────────────────────
function imageFour() {
  const POOL = (fs
    .readFileSync(path.join(WIDGETS, "src/lib/noiseText.js"), "utf8")
    .match(/POOL\s*=\s*"([^"]+)"/) || [])[1];
  const word = "ASCII WIDGETS";
  const chars = [...word];
  const lineW = 690;
  const fontSize = lineW / (chars.length * 0.6);
  const stages = [0, 0.34, 0.68, 1];
  const FRINGE = 3;
  const rows = stages.map((p, si) => {
    const front = p * chars.length;
    const resolved = [];
    const fringe = [];
    const far = [];
    chars.forEach((ch, i) => {
      const isSpace = ch === " ";
      if (i < front || p === 1) {
        resolved.push(ch);
        fringe.push(" ");
        far.push(" ");
      } else if (i < front + FRINGE) {
        resolved.push(" ");
        fringe.push(isSpace ? " " : POOL[Math.floor(rnd() * POOL.length)]);
        far.push(" ");
      } else {
        resolved.push(" ");
        fringe.push(" ");
        far.push(isSpace ? " " : POOL[Math.floor(rnd() * POOL.length)]);
      }
    });
    return gridRow(
      [
        { chars: far.join(""), fill: DIM },
        { chars: fringe.join(""), fill: HOT },
        { chars: resolved.join(""), fill: INK },
      ],
      { x: 55, y: 420 + si * 132, width: lineW, fontSize }
    );
  });
  const body = [
    title("NOISE TEXT"),
    subtitle("a front sweeps left, the noise resolves behind it"),
    rows.join("\n  "),
    `<line x1="60" y1="900" x2="740" y2="900" stroke="${INK}" stroke-opacity="0.14"/>`,
    `<text x="60" y="946" font-family="${MONO}" font-size="17" fill="${INK}" fill-opacity="0.45" xml:space="preserve" textLength="680" lengthAdjust="spacingAndGlyphs">${esc(POOL)}</text>`,
  ];
  return svg(body.join("\n  "));
}

// ── the row hover thumb (480x168 = the 160x56 thumb at 3x) ─────────────
// Deliberately NOT a crop of the panel art: at 56px tall an 80-column glyph
// grid is 2px per cell, so any real ascii render collapses into texture (the
// cover-cropped portrait read as a blue smudge, which is what prompted this).
// The one thing that survives the size is a few LARGE glyphs, so the thumb is
// the converter's own classic ramp — empty→dense, left→right, in the same
// three-tier blue as the panel images. Unmistakably ascii, legible at 56px,
// and it doesn't just repeat the row title sitting next to it.
function imageThumb() {
  const RAMP = " .:-=+*#%@"; // RAMP_PRESETS.classic
  const TW = 480;
  const TH = 168;
  const COLS = 20;
  const ROWS = 3;
  const pad = 20;
  const gridW = TW - pad * 2;
  const cellW = gridW / COLS;
  const cellH = 40;
  const top = (TH - ROWS * cellH) / 2;
  // One ramp sweep across the columns, the same on every row, so the three
  // lines read as one gradient block rather than three sentences.
  const row = Array.from({ length: COLS }, (_, i) =>
    RAMP[Math.round((i / (COLS - 1)) * (RAMP.length - 1))]
  ).join("");
  const rows = Array.from({ length: ROWS }, (_, r) =>
    gridRow(tierLayers(row, RAMP), {
      x: pad,
      y: top + (r + 0.78) * cellH,
      width: gridW,
      fontSize: cellW / 0.6,
    })
  );
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${TW}" height="${TH}" viewBox="0 0 ${TW} ${TH}">
  <rect width="${TW}" height="${TH}" fill="#000000"/>
  ${rows.join("\n  ")}
</svg>
`;
}

const files = [
  ["ascii-widgets-1.svg", imageOne()],
  ["ascii-widgets-2.svg", imageTwo()],
  ["ascii-widgets-3.svg", imageThree()],
  ["ascii-widgets-4.svg", imageFour()],
  ["ascii-widgets-thumb.svg", imageThumb()],
];
for (const [name, content] of files) {
  fs.writeFileSync(path.join(OUT, name), content, "utf8");
  console.log(name, content.length, "bytes");
}
