// The optional figure.json `style` block: shared constants for the converter
// UI, the players, and the media exporters. The server mirrors these rules in
// functions/api/_lib/validate.js — keep the two in sync.
//
// Fonts are web-safe MONOSPACE stacks only: a proportional face would break
// the character grid, and visitors must be able to render shared figures
// without webfont downloads.

export const FONT_STACKS = {
  default: 'ui-monospace, "SF Mono", Menlo, Consolas, "DejaVu Sans Mono", monospace',
  courier: '"Courier New", Courier, monospace',
  consolas: 'Consolas, Menlo, "DejaVu Sans Mono", monospace',
  lucida: '"Lucida Console", "Lucida Sans Typewriter", monospace',
};

export const STYLE_LIMITS = {
  LETTER_SPACING_MIN: 0,
  LETTER_SPACING_MAX: 0.5, // em
  LINE_HEIGHT_MIN: 0.7,
  LINE_HEIGHT_MAX: 1.6,
};

export const STYLE_DEFAULTS = {
  font: 'default',
  letterSpacing: 0,
  lineHeight: 1,
  background: '#050505', // matches .screen / .ascii-plane
  color: '#ffffff',
};

const HEX_RE = /^#[0-9a-f]{6}$/i;

/**
 * Build the figure.json `style` block from the converter's controls.
 * Returns null when everything is at default (the block is omitted entirely,
 * keeping old figures and plain bakes byte-identical to before).
 */
export function buildStyle({ font, letterSpacing, lineHeight, background, color }) {
  const out = {};
  if (font && font !== STYLE_DEFAULTS.font && FONT_STACKS[font]) out.font = font;
  if (Number.isFinite(letterSpacing) && letterSpacing > 0) out.letterSpacing = letterSpacing;
  if (Number.isFinite(lineHeight) && lineHeight !== 1) out.lineHeight = lineHeight;
  if (HEX_RE.test(background || '') && background.toLowerCase() !== STYLE_DEFAULTS.background) {
    out.background = background.toLowerCase();
  }
  if (HEX_RE.test(color || '') && color.toLowerCase() !== STYLE_DEFAULTS.color) {
    out.color = color.toLowerCase();
  }
  return Object.keys(out).length ? out : null;
}

/**
 * Defensive reader for `data.style` coming from a fetched figure.json:
 * only known keys, coerced + clamped, font resolved to a stack. Always
 * returns a complete object (defaults filled), safe to feed into CSS style
 * properties.
 */
export function resolveStyle(style) {
  const s = typeof style === 'object' && style !== null ? style : {};
  const font = FONT_STACKS[s.font] ? s.font : STYLE_DEFAULTS.font;
  const num = (v, min, max, dflt) =>
    typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : dflt;
  return {
    fontFamily: FONT_STACKS[font],
    letterSpacing: num(
      s.letterSpacing,
      STYLE_LIMITS.LETTER_SPACING_MIN,
      STYLE_LIMITS.LETTER_SPACING_MAX,
      STYLE_DEFAULTS.letterSpacing,
    ),
    lineHeight: num(
      s.lineHeight,
      STYLE_LIMITS.LINE_HEIGHT_MIN,
      STYLE_LIMITS.LINE_HEIGHT_MAX,
      STYLE_DEFAULTS.lineHeight,
    ),
    background: HEX_RE.test(s.background || '') ? s.background : STYLE_DEFAULTS.background,
    color: HEX_RE.test(s.color || '') ? s.color : STYLE_DEFAULTS.color,
  };
}
