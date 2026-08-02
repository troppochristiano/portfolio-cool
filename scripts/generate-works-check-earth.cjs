// Regenerates the check-earth Works art (public/works/check-earth-1.svg and
// check-earth-thumb.svg) — not a build step, run it by hand:
//   node scripts/generate-works-check-earth.cjs
//
// check-earth isn't released yet, so there are no screenshots to composite the
// way the cobrains/RRead/ascii-widgets art is. Instead of a name-only card
// (what the arewefucked?.com placeholder was), this draws the thing the
// product actually is: a live world map with hazard events burning on it.
//
// The map is not decorative noise — it's a real equirectangular projection.
// Coastlines are coarse lon/lat polygons rasterised by even-odd point-in-
// polygon into a glyph grid, so every landmass sits at its true coordinates,
// and so do the event markers. Anything you change about the projection
// (COLS/ROWS/LAT_SPAN) moves land and markers together and stays correct.

const fs = require("fs");
const path = require("path");

const OUT = path.resolve(__dirname, "../public/works");
const MONO =
  'ui-monospace, Menlo, Consolas, &quot;DejaVu Sans Mono&quot;, monospace';

// Same tonal ladder as generate-works-ascii.cjs: pure #0000ff carries only ~7%
// luminance on black, so the blues are split into tiers that still read at the
// panel's ~340px display width. INK is the UI chrome, ALERT is global.css's
// --alert (the site's only non-blue accent) and marks live hazards.
const DIM = "#2b2bd6";
const MID = "#4a4aff";
const HOT = "#8f8fff";
const INK = "#ffffff";
const ALERT = "#ff5b52";
const MUTED = "#6a6a6a";

const esc = (s) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// ── projection ────────────────────────────────────────────────────────────
// Equirectangular. LAT_SPAN clips the poles: past ~84° the projection smears
// Antarctica and Greenland across the full width and the map stops reading.
const COLS = 76;
const ROWS = 28;
const LAT_SPAN = 84;

const colOfLon = (lon) => ((lon + 180) / 360) * COLS;
const rowOfLat = (lat) => ((LAT_SPAN - lat) / (2 * LAT_SPAN)) * ROWS;
const lonOfCol = (c) => ((c + 0.5) / COLS) * 360 - 180;
const latOfRow = (r) => LAT_SPAN - ((r + 0.5) / ROWS) * 2 * LAT_SPAN;

// Coarse coastlines, [lon, lat]. Deliberately low-vertex: at 4.7° per column a
// finer outline would quantise to the same cells anyway.
const LAND = [
  // North America + Central America down to the isthmus.
  [[-168,66],[-158,71],[-130,70],[-100,73],[-80,73],[-62,60],[-55,52],[-66,45],
   [-70,41],[-76,35],[-81,26],[-90,29],[-97,26],[-105,20],[-97,16],[-88,13],
   [-83,9],[-78,8],[-82,12],[-92,15],[-105,18],[-112,29],[-120,34],[-125,40],
   [-124,48],[-135,57],[-150,60],[-168,66]],
  // Greenland.
  [[-45,83],[-20,80],[-22,70],[-40,60],[-52,64],[-58,72],[-55,80],[-45,83]],
  // South America.
  [[-78,8],[-72,11],[-62,10],[-52,5],[-44,-2],[-35,-6],[-38,-13],[-48,-25],
   [-58,-34],[-65,-45],[-68,-52],[-73,-53],[-72,-45],[-71,-33],[-71,-18],
   [-76,-14],[-81,-6],[-80,0],[-78,8]],
  // Africa.
  [[-17,15],[-10,28],[0,32],[10,37],[20,32],[32,31],[35,23],[38,15],[43,11],
   [51,12],[42,-1],[40,-10],[36,-18],[33,-26],[26,-34],[18,-35],[12,-18],
   [9,-1],[8,4],[-5,5],[-8,10],[-17,15]],
  // Eurasia, Iberia round to Kamchatka, with India and SE Asia hanging off it.
  [[-9,36],[-9,43],[-2,48],[3,51],[8,54],[5,58],[10,64],[20,70],[30,70],
   [45,68],[60,70],[75,73],[90,75],[105,76],[120,73],[135,72],[150,70],
   [165,68],[180,66],[180,60],[162,60],[150,59],[142,54],[135,45],[128,40],
   [122,32],[118,24],[110,20],[105,10],[100,5],[98,12],[92,21],[88,22],
   [80,15],[77,8],[73,20],[68,24],[60,25],[57,20],[50,15],[43,13],[48,30],
   [36,36],[28,37],[22,40],[16,41],[12,38],[3,40],[-9,36]],
  // British Isles, Japan, Madagascar, New Zealand — small but load-bearing for
  // "is this Earth?".
  [[-6,50],[-2,52],[-1,58],[-5,58],[-8,54],[-6,50]],
  [[130,32],[140,36],[145,43],[141,45],[133,35],[130,32]],
  [[43,-12],[50,-15],[48,-25],[44,-22],[43,-12]],
  [[166,-35],[178,-38],[172,-46],[167,-44],[166,-35]],
  // Australia.
  [[113,-22],[122,-18],[130,-12],[142,-11],[147,-19],[153,-26],[150,-37],
   [140,-38],[130,-32],[118,-34],[113,-22]],
  // Antarctica as the bottom band it becomes in this projection.
  [[-180,-72],[180,-72],[180,-84],[-180,-84],[-180,-72]],
];

// Even-odd ray cast in lon/lat space.
function inPoly(lon, lat, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi)
      inside = !inside;
  }
  return inside;
}

const isLand = (lon, lat) => LAND.some((p) => inPoly(lon, lat, p));

// Rasterise. Each cell supersamples 3x3 so coastlines get a tonal edge instead
// of a hard on/off jag — the same reason the site's converter block-averages.
function buildMap() {
  const cells = [];
  for (let r = 0; r < ROWS; r++) {
    const row = [];
    for (let c = 0; c < COLS; c++) {
      let hit = 0;
      for (let sy = 0; sy < 3; sy++) {
        for (let sx = 0; sx < 3; sx++) {
          const lon = ((c + (sx + 0.5) / 3) / COLS) * 360 - 180;
          const lat = LAT_SPAN - ((r + (sy + 0.5) / 3) / ROWS) * 2 * LAT_SPAN;
          if (isLand(lon, lat)) hit++;
        }
      }
      row.push(hit / 9);
    }
    cells.push(row);
  }
  return cells;
}

// Live hazard events — real hazard geography (the Ring of Fire, the Rift, the
// usual fire and cyclone basins) so the marker scatter is plausible rather
// than random. `k` is the readout kind.
const EVENTS = [
  { name: "REYKJANES",   k: "VOLCANO", lon: -22.4, lat: 63.9, v: "M2.9" },
  { name: "SIERRA NEVADA", k: "WILDFIRE", lon: -119.6, lat: 37.8, v: "14.2k ha" },
  { name: "HONSHU",      k: "QUAKE",   lon: 141.2, lat: 38.3, v: "M5.4" },
  { name: "SULAWESI",    k: "VOLCANO", lon: 124.8, lat: 1.4,  v: "VEI 2" },
  { name: "VALPARAISO",  k: "QUAKE",   lon: -71.6, lat: -33.0, v: "M4.7" },
  { name: "LUZON",       k: "CYCLONE", lon: 122.5, lat: 14.6, v: "CAT 3" },
  { name: "NEW SOUTH WALES", k: "WILDFIRE", lon: 149.8, lat: -33.4, v: "6.8k ha" },
  { name: "AFAR",        k: "QUAKE",   lon: 40.5, lat: 11.8, v: "M4.1" },
];

// ── svg helpers ───────────────────────────────────────────────────────────
function textEl(chars, { x, y, width, fontSize, fill, opacity, anchor }) {
  if (!chars.trim()) return "";
  return (
    `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" xml:space="preserve"` +
    (width ? ` textLength="${width.toFixed(1)}" lengthAdjust="spacingAndGlyphs"` : "") +
    (anchor ? ` text-anchor="${anchor}"` : "") +
    ` font-family="${MONO}" font-size="${fontSize.toFixed(2)}" fill="${fill}"` +
    (opacity ? ` fill-opacity="${opacity}"` : "") +
    `>${esc(chars)}</text>`
  );
}

// One glyph row, emitted as one <text> per colour so the grid stays aligned
// (textLength pins the row width whatever monospace the renderer picks).
function layeredRow(cells, { x, y, width, fontSize }) {
  const byFill = new Map();
  cells.forEach((cell, i) => {
    const fill = cell.fill ?? DIM;
    if (!byFill.has(fill)) byFill.set(fill, new Array(cells.length).fill(" "));
    byFill.get(fill)[i] = cell.ch ?? " ";
  });
  return [...byFill.entries()]
    .map(([fill, arr]) => textEl(arr.join(""), { x, y, width, fontSize, fill }))
    .filter(Boolean)
    .join("\n  ");
}

// Land glyph by coverage: a coast cell reads lighter than an interior one.
function landGlyph(v) {
  if (v >= 0.85) return { ch: "#", fill: MID };
  if (v >= 0.55) return { ch: "+", fill: DIM };
  if (v >= 0.25) return { ch: ":", fill: DIM };
  return null;
}

// Compose the map grid: ocean graticule under land under markers.
function mapGrid(map, { markers = true } = {}) {
  const grid = [];
  for (let r = 0; r < ROWS; r++) {
    const row = [];
    for (let c = 0; c < COLS; c++) {
      const lon = lonOfCol(c);
      const lat = latOfRow(r);
      const land = landGlyph(map[r][c]);
      if (land) {
        row.push(land);
      } else {
        // Ocean graticule: 30° meridians and 30° parallels, equator brighter.
        const nearMeridian = Math.abs(((lon + 180) % 30) - 15) > 12.6;
        const nearParallel = Math.abs(((lat + 90) % 30) - 15) > 12.5;
        const equator = Math.abs(lat) < 3.1;
        if (equator) row.push({ ch: "-", fill: "#1a1a5e" });
        else if (nearMeridian && nearParallel) row.push({ ch: "+", fill: "#141446" });
        else if (nearMeridian || nearParallel) row.push({ ch: ".", fill: "#141446" });
        else row.push({ ch: " ", fill: DIM });
      }
    }
    grid.push(row);
  }
  if (markers) {
    for (const e of EVENTS) {
      const c = Math.round(colOfLon(e.lon) - 0.5);
      const r = Math.round(rowOfLat(e.lat) - 0.5);
      if (r < 0 || r >= ROWS || c < 0 || c >= COLS) continue;
      grid[r][c] = { ch: "@", fill: ALERT };
      // A one-cell halo reads as "pulsing" in a still frame.
      const ring = [[r - 1, c], [r + 1, c], [r, c - 1], [r, c + 1]];
      for (const [rr, cc] of ring) {
        if (rr < 0 || rr >= ROWS || cc < 0 || cc >= COLS) continue;
        if (grid[rr][cc].fill === ALERT) continue;
        grid[rr][cc] = { ch: "·", fill: "#7d2a26" };
      }
    }
  }
  return grid;
}

// ── panel image (800x1000, the 4:5 works panel) ───────────────────────────
function panel() {
  const W = 800;
  const H = 1000;
  const PAD = 36;
  const gridW = W - PAD * 2;
  const cellW = gridW / COLS;
  const cellH = cellW * 1.22;
  const fontSize = cellW * 1.62;
  const mapTop = 224;

  const map = buildMap();
  const grid = mapGrid(map);

  const out = [`<rect width="${W}" height="${H}" fill="#000000"/>`];

  // Header.
  out.push(textEl("CHECK-EARTH", { x: PAD, y: 92, fontSize: 46, fill: INK }));
  out.push(textEl("LIVE PLANETARY HAZARD MAP", { x: PAD, y: 128, fontSize: 19, fill: MUTED }));
  out.push(`<rect x="${W - PAD - 92}" y="62" width="92" height="34" fill="${ALERT}"/>`);
  out.push(textEl("● LIVE", { x: W - PAD - 46, y: 86, fontSize: 19, fill: "#000000", anchor: "middle" }));
  out.push(`<rect x="${PAD}" y="164" width="${gridW}" height="2" fill="#1a1a1a"/>`);
  out.push(textEl("EQUIRECTANGULAR · 180W-180E · 84N-84S", { x: PAD, y: 200, fontSize: 17, fill: MUTED }));

  // Map.
  grid.forEach((row, i) => {
    out.push(
      layeredRow(row, {
        x: PAD,
        y: mapTop + (i + 0.78) * cellH,
        width: gridW,
        fontSize,
      })
    );
  });

  // Readout — every tracked event, so the count in the header and the rows
  // below it can't disagree.
  const listTop = 600;
  out.push(`<rect x="${PAD}" y="${listTop - 40}" width="${gridW}" height="2" fill="#1a1a1a"/>`);
  out.push(textEl("ACTIVE EVENTS", { x: PAD, y: listTop - 12, fontSize: 18, fill: INK }));
  out.push(textEl(`${EVENTS.length} TRACKED`, { x: W - PAD, y: listTop - 12, fontSize: 18, fill: MUTED, anchor: "end" }));

  const rowH = 34;
  EVENTS.forEach((e, i) => {
    const y = listTop + 24 + i * rowH;
    out.push(textEl("@", { x: PAD, y, fontSize: 19, fill: ALERT }));
    out.push(textEl(e.k, { x: PAD + 28, y, fontSize: 19, fill: HOT }));
    out.push(textEl(e.name, { x: PAD + 150, y, fontSize: 19, fill: INK }));
    out.push(textEl(e.v, { x: W - PAD, y, fontSize: 19, fill: MUTED, anchor: "end" }));
  });

  // Glyph legend — describes this image's own encoding, nothing invented.
  const legendY = listTop + 24 + EVENTS.length * rowH + 34;
  out.push(`<rect x="${PAD}" y="${legendY - 26}" width="${gridW}" height="2" fill="#1a1a1a"/>`);
  out.push(textEl("@", { x: PAD, y: legendY, fontSize: 17, fill: ALERT }));
  out.push(textEl("EVENT", { x: PAD + 24, y: legendY, fontSize: 17, fill: MUTED }));
  out.push(textEl("#", { x: PAD + 130, y: legendY, fontSize: 17, fill: MID }));
  out.push(textEl("LANDMASS", { x: PAD + 154, y: legendY, fontSize: 17, fill: MUTED }));
  out.push(textEl("·", { x: PAD + 300, y: legendY, fontSize: 17, fill: "#141446" }));
  out.push(textEl("GRATICULE 30°", { x: PAD + 324, y: legendY, fontSize: 17, fill: MUTED }));

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">\n  ${out
    .filter(Boolean)
    .join("\n  ")}\n</svg>\n`;
}

// ── thumb (480x168, the 160x56 row-hover strip at 3x) ─────────────────────
// Its own file rather than a cover-crop of the panel: a 4:5 image cropped to
// 2.86:1 keeps only a middle band, which would cut the map in half.
function thumb() {
  const W = 480;
  const H = 168;
  const PAD = 12;
  const gridW = W - PAD * 2;
  const cellW = gridW / COLS;
  const cellH = cellW * 1.18;
  const fontSize = cellW * 1.6;
  const map = buildMap();
  // Drop the Antarctica band: at 56px tall it's a solid uninformative bar that
  // eats a third of the strip. Everything above it still sits at true latitude.
  const grid = mapGrid(map).slice(0, ROWS - 2);
  const top = (H - grid.length * cellH) / 2;

  const out = [`<rect width="${W}" height="${H}" fill="#000000"/>`];
  grid.forEach((row, i) => {
    out.push(
      layeredRow(row, {
        x: PAD,
        y: top + (i + 0.78) * cellH,
        width: gridW,
        fontSize,
      })
    );
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">\n  ${out
    .filter(Boolean)
    .join("\n  ")}\n</svg>\n`;
}

fs.writeFileSync(path.join(OUT, "check-earth-1.svg"), panel());
fs.writeFileSync(path.join(OUT, "check-earth-thumb.svg"), thumb());
console.log("wrote check-earth-1.svg + check-earth-thumb.svg");
