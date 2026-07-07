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
};
export { LIMITS };

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

  const thumbFrame = body.thumbFrame ?? 0;
  if (!isInt(thumbFrame) || thumbFrame < 0 || thumbFrame >= frames.length)
    return fail('invalid_thumb_frame', 'thumbFrame must index an existing frame');

  return { ok: true, value: { name, author, thumbFrame, cols, rows, fps, cellPx, frames } };
}

/**
 * Downsample one validated frame to a small text thumbnail (nearest-neighbor
 * over the character grid, same stride both axes so aspect is preserved).
 */
export function makeThumb(frame, cols, rows) {
  const step = Math.max(1, Math.ceil(cols / LIMITS.THUMB_COLS_MAX));
  const lines = frame.split('\n');
  const out = [];
  for (let y = 0; y < rows; y += step) {
    const line = lines[y];
    let row = '';
    for (let x = 0; x < cols; x += step) row += line[x];
    out.push(row);
  }
  return {
    thumb: out.join('\n'),
    thumbCols: Math.ceil(cols / step),
    thumbRows: Math.ceil(rows / step),
  };
}
