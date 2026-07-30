// The dissolve-grid look shared by the About overlay's glyph dissolve
// (hooks/useDissolveReveal.js) and the block-reveal route transition
// (lib/blockRevealTransition.js): same cell size, glyph alphabet, font, and
// per-cell tile paint, so the two effects read as one system. This module is
// the single source of truth — the transition used to mirror these constants
// by hand.

export const CELL_SIZE = 16;
export const CHARACTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789#@$%&*+=?!<>{}[]";
export const FONT_SIZE = Math.round(CELL_SIZE * 0.7);
export const TILE_FILL = "#0000ff";
export const GLYPH_FILL = "#fff";

export const randChar = () =>
  CHARACTERS[Math.floor(Math.random() * CHARACTERS.length)];

// Font + alignment for glyph-cell text; call once per frame before painting.
export function setGlyphFont(ctx, fontSize = FONT_SIZE) {
  ctx.font = `${fontSize}px "DM Mono", monospace`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
}

// One frontier cell: colored tile + white glyph (the +0.5 nudges the glyph
// onto the optical center of the tile).
export function paintGlyphCell(ctx, x, y, ch, fill = TILE_FILL) {
  ctx.fillStyle = fill;
  ctx.fillRect(x, y, CELL_SIZE, CELL_SIZE);
  ctx.fillStyle = GLYPH_FILL;
  ctx.fillText(ch, x + CELL_SIZE / 2, y + CELL_SIZE / 2 + 0.5);
}
