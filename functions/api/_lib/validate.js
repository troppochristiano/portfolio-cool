// Server-side validation for uploaded figures. Everything here is a hard
// gate: the stored JSON is re-built from these validated fields only, so
// nothing a client sends ever reaches R2 or the DOM unchecked.
//
// SECURITY: AsciiPlayer writes frames via innerHTML when data.color is truthy
// (src/components/AsciiPlayer.jsx) — color must be exactly `false`, and the
// per-character whitelist below rejects anything that isn't a glyph the
// converter's own ramps can emit (so no markup can even be expressed).

// Union of RAMP_PRESETS from src/pages/Create.jsx — keep in sync if ramps change.
const RAMPS = [
  ' .:-=+*#%@', // classic
  ' .\'`^",:;Il!i><~+_-?][}{1)(|\\/tfjrxnuvczXYUJCLQ0OZmwqpdbkhao*#MW&8%B@$', // detailed
  ' ░▒▓█', // blocks
  ' .oO@', // minimal
  ' ·•●', // dots
];

// Build a "contains a disallowed char" regex from the whitelist. Only the
// characters that are special inside a regex class get escaped — escaping
// letters would create classes like \d.
const ALLOWED_CHARS = [...new Set(RAMPS.join(''))].join('');
const CLASS_ESCAPED = ALLOWED_CHARS.replace(/[[\]^\\-]/g, (c) => '\\' + c);
// \n is allowed only as the row separator; row/col structure is checked separately.
const BAD_CHAR = new RegExp(`[^${CLASS_ESCAPED}\\n]`);

const LIMITS = {
  NAME_MAX: 40,
  AUTHOR_MAX: 30,
  COLS_MIN: 20,
  COLS_MAX: 320,
  ROWS_MIN: 8,
  ROWS_MAX: 400,
  FPS_MIN: 1,
  FPS_MAX: 30,
  CELL_PX_MIN: 4,
  CELL_PX_MAX: 64,
  FRAMES_MAX: 900,
  TOTAL_CHARS_MAX: 2_500_000,
  THUMB_COLS_MAX: 80,
  // optional style block (mirrors src/create/styleOptions.js — keep in sync)
  LETTER_SPACING_MAX: 0.5, // em
  LINE_HEIGHT_MIN: 0.7,
  LINE_HEIGHT_MAX: 1.6,
};
export { LIMITS };

// Whitelisted font KEYS (the client maps keys to font stacks; the server
// never stores a raw font-family string).
const STYLE_FONTS = new Set(['default', 'courier', 'consolas', 'lucida']);
const HEX_COLOR = /^#[0-9a-f]{6}$/i;

/**
 * Validate the optional `figure.style` block. Returns:
 *   { ok: true, value: null }          — absent / empty → default look
 *   { ok: true, value: {…normalized} } — validated, unknown keys dropped
 *   { ok: false, code, message }       — anything out of contract
 */
function validateStyle(style) {
  if (style === undefined || style === null) return { ok: true, value: null };
  const fail = (code, message) => ({ ok: false, code, message });
  if (typeof style !== 'object' || Array.isArray(style)) {
    return fail('invalid_style', 'style must be an object');
  }
  const out = {};
  if (style.font !== undefined) {
    if (!STYLE_FONTS.has(style.font)) return fail('invalid_style_font', 'unknown font key');
    if (style.font !== 'default') out.font = style.font;
  }
  if (style.letterSpacing !== undefined) {
    const v = style.letterSpacing;
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > LIMITS.LETTER_SPACING_MAX) {
      return fail('invalid_style_spacing', `letterSpacing must be 0–${LIMITS.LETTER_SPACING_MAX} em`);
    }
    if (v > 0) out.letterSpacing = v;
  }
  if (style.lineHeight !== undefined) {
    const v = style.lineHeight;
    if (typeof v !== 'number' || !Number.isFinite(v) || v < LIMITS.LINE_HEIGHT_MIN || v > LIMITS.LINE_HEIGHT_MAX) {
      return fail('invalid_style_line_height', `lineHeight must be ${LIMITS.LINE_HEIGHT_MIN}–${LIMITS.LINE_HEIGHT_MAX}`);
    }
    if (v !== 1) out.lineHeight = v;
  }
  for (const key of ['background', 'color', 'edgeColor']) {
    if (style[key] !== undefined) {
      if (typeof style[key] !== 'string' || !HEX_COLOR.test(style[key])) {
        return fail('invalid_style_color', `${key} must be a #rrggbb hex color`);
      }
      out[key] = style[key].toLowerCase();
    }
  }
  return { ok: true, value: Object.keys(out).length ? out : null };
}

const isInt = (v) => typeof v === 'number' && Number.isInteger(v);

// Printable, trimmed, NFC-normalized text field or null.
function cleanText(value, max) {
  if (typeof value !== 'string') return null;
  const s = value.normalize('NFC').trim();
  if (s.length < 1 || s.length > max) return null;
  // No C0 control chars or DEL — these fields render as text but keep them sane.
  if (/[\u0000-\u001F\u007F]/.test(s)) return null;
  return s;
}

/**
 * Validate an upload body `{ name, author, thumbFrame, figure }`.
 * Returns { ok: true, value: { name, author, thumbFrame, cols, rows, fps,
 * cellPx, frames } } or { ok: false, code, message }.
 */
export function validateUpload(body) {
  const fail = (code, message) => ({ ok: false, code, message });
  if (typeof body !== 'object' || body === null) return fail('invalid_body', 'body must be a JSON object');

  const name = cleanText(body.name, LIMITS.NAME_MAX);
  if (!name) return fail('invalid_name', `name must be 1–${LIMITS.NAME_MAX} printable characters`);

  const author = cleanText(body.author, LIMITS.AUTHOR_MAX);
  if (!author) return fail('invalid_author', `author must be 1–${LIMITS.AUTHOR_MAX} printable characters`);

  const fig = body.figure;
  if (typeof fig !== 'object' || fig === null) return fail('invalid_figure', 'figure must be an object');

  // color must be exactly false — see the innerHTML note above.
  if (fig.color !== false) return fail('invalid_color', 'color figures are not accepted');

  const { cols, rows, fps } = fig;
  if (!isInt(cols) || cols < LIMITS.COLS_MIN || cols > LIMITS.COLS_MAX)
    return fail('invalid_cols', `cols must be an integer ${LIMITS.COLS_MIN}–${LIMITS.COLS_MAX}`);
  if (!isInt(rows) || rows < LIMITS.ROWS_MIN || rows > LIMITS.ROWS_MAX)
    return fail('invalid_rows', `rows must be an integer ${LIMITS.ROWS_MIN}–${LIMITS.ROWS_MAX}`);
  if (!isInt(fps) || fps < LIMITS.FPS_MIN || fps > LIMITS.FPS_MAX)
    return fail('invalid_fps', `fps must be an integer ${LIMITS.FPS_MIN}–${LIMITS.FPS_MAX}`);

  let cellPx = fig.cellPx;
  if (cellPx === undefined || cellPx === null) cellPx = null;
  else if (
    typeof cellPx !== 'number' || !Number.isFinite(cellPx) ||
    cellPx < LIMITS.CELL_PX_MIN || cellPx > LIMITS.CELL_PX_MAX
  ) return fail('invalid_cell_px', `cellPx must be a number ${LIMITS.CELL_PX_MIN}–${LIMITS.CELL_PX_MAX}`);

  const frames = fig.frames;
  if (!Array.isArray(frames) || frames.length < 1 || frames.length > LIMITS.FRAMES_MAX)
    return fail('invalid_frames', `frames must be an array of 1–${LIMITS.FRAMES_MAX} strings`);

  // Cheap totals first so a huge payload fails before the per-frame scan.
  let total = 0;
  for (const f of frames) {
    if (typeof f !== 'string') return fail('invalid_frames', 'every frame must be a string');
    total += f.length;
    if (total > LIMITS.TOTAL_CHARS_MAX)
      return fail('too_many_chars', `frames exceed ${LIMITS.TOTAL_CHARS_MAX} total characters`);
  }

  // Exact shape: every frame is `rows` lines of exactly `cols` chars, all from
  // the whitelist. The regex scan is native-speed; the length checks are O(rows).
  const expectedLen = rows * (cols + 1) - 1; // rows lines + (rows-1) newlines
  for (let i = 0; i < frames.length; i++) {
    const f = frames[i];
    if (f.length !== expectedLen) return fail('invalid_frame_shape', `frame ${i} has the wrong dimensions`);
    if (BAD_CHAR.test(f)) return fail('invalid_frame_chars', `frame ${i} contains disallowed characters`);
    const lines = f.split('\n');
    if (lines.length !== rows) return fail('invalid_frame_shape', `frame ${i} has the wrong dimensions`);
    for (const line of lines) {
      if (line.length !== cols) return fail('invalid_frame_shape', `frame ${i} has the wrong dimensions`);
    }
  }

  // Optional edge layer: when a figure was made with a distinct edge color the
  // tinted edge glyphs ride on their own frames. Same contract as `frames`
  // (plain, whitelisted, exact shape, one entry per base frame) so it stays
  // safe under textContent — no color:true / innerHTML path is ever opened.
  let edgeFrames = fig.edgeFrames;
  if (edgeFrames !== undefined && edgeFrames !== null) {
    if (!Array.isArray(edgeFrames) || edgeFrames.length !== frames.length)
      return fail('invalid_edge_frames', 'edgeFrames must match frames one-to-one');
    for (let i = 0; i < edgeFrames.length; i++) {
      const f = edgeFrames[i];
      if (typeof f !== 'string') return fail('invalid_edge_frames', 'every edge frame must be a string');
      total += f.length;
      if (total > LIMITS.TOTAL_CHARS_MAX)
        return fail('too_many_chars', `frames exceed ${LIMITS.TOTAL_CHARS_MAX} total characters`);
      if (f.length !== expectedLen) return fail('invalid_edge_frame_shape', `edge frame ${i} has the wrong dimensions`);
      if (BAD_CHAR.test(f)) return fail('invalid_edge_frame_chars', `edge frame ${i} contains disallowed characters`);
    }
  } else {
    edgeFrames = null;
  }

  const thumbFrame = body.thumbFrame ?? 0;
  if (!isInt(thumbFrame) || thumbFrame < 0 || thumbFrame >= frames.length)
    return fail('invalid_thumb_frame', 'thumbFrame must index an existing frame');

  const styleResult = validateStyle(fig.style);
  if (!styleResult.ok) return styleResult;

  return {
    ok: true,
    value: {
      name, author, thumbFrame, cols, rows, fps, cellPx, frames,
      edgeFrames, style: styleResult.value,
    },
  };
}

/**
 * Downsample one validated frame to a small text thumbnail (nearest-neighbor
 * over the character grid, same stride both axes so aspect is preserved).
 */
export function makeThumb(frame, cols, rows, edgeFrame) {
  const step = Math.max(1, Math.ceil(cols / LIMITS.THUMB_COLS_MAX));
  const downsample = (src) => {
    const lines = src.split('\n');
    const out = [];
    for (let y = 0; y < rows; y += step) {
      const line = lines[y];
      let row = '';
      for (let x = 0; x < cols; x += step) row += line[x];
      out.push(row);
    }
    return out.join('\n');
  };
  return {
    thumb: downsample(frame),
    thumbCols: Math.ceil(cols / step),
    thumbRows: Math.ceil(rows / step),
    // Same-stride downsample of the edge layer so the card thumb keeps its tint.
    edgeThumb: edgeFrame ? downsample(edgeFrame) : null,
  };
}
