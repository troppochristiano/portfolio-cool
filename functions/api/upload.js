// POST /api/upload — accept a baked figure for moderation.
//
// Defense order (cheapest first): size gate → JSON parse → Turnstile →
// rate limits → full schema validation. On success the stored JSON is
// re-serialized from validated fields only — client bytes never land in R2
// verbatim, unknown keys are dropped, and color is forced to false.

import { json, error, methodNotAllowed } from './_lib/http.js';
import { validateUpload, makeThumb } from './_lib/validate.js';
import { verifyTurnstile } from './_lib/turnstile.js';
import { ipHash } from './_lib/ip.js';
import { notifyPendingUpload } from './_lib/notify.js';

const MAX_BODY_BYTES = 3_000_000;
const MAX_PER_IP_PER_DAY = 5;
const MAX_PENDING = 200;
const MAX_TOTAL = 1000;

export async function onRequestPost({ request, env, waitUntil }) {
  try {
    // Size gate. Content-Length is required (fetch always sets it for string
    // bodies); the arrayBuffer read below is additionally capped in case a
    // client lies with a chunked body.
    const declared = Number(request.headers.get('Content-Length'));
    if (!Number.isFinite(declared) || declared <= 0 || declared > MAX_BODY_BYTES) {
      return error('too_large', `upload must be under ${MAX_BODY_BYTES} bytes`, 413);
    }
    const raw = await request.arrayBuffer();
    if (raw.byteLength > MAX_BODY_BYTES) {
      return error('too_large', `upload must be under ${MAX_BODY_BYTES} bytes`, 413);
    }

    let body;
    try {
      body = JSON.parse(new TextDecoder().decode(raw));
    } catch {
      return error('invalid_json', 'body is not valid JSON', 400);
    }

    // Bot gate — verified server-side, tokens are single-use.
    if (!(await verifyTurnstile(body.token, request, env))) {
      return error('turnstile_failed', 'human verification failed — reload and try again', 403);
    }

    // Rate limits: per-IP daily cap plus global capacity caps so storage can
    // never be flooded even from many IPs.
    const hash = await ipHash(request, env);
    const counts = await env.DB.prepare(
      `SELECT
         (SELECT COUNT(*) FROM figures WHERE ip_hash = ?1
            AND created_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 day')) AS byIp,
         (SELECT COUNT(*) FROM figures WHERE status = 'pending') AS pending,
         (SELECT COUNT(*) FROM figures) AS total`,
    ).bind(hash).first();
    if (counts.byIp >= MAX_PER_IP_PER_DAY) {
      return error('rate_limited', 'upload limit reached — try again tomorrow', 429);
    }
    if (counts.pending >= MAX_PENDING || counts.total >= MAX_TOTAL) {
      return error('capacity', 'the gallery queue is full right now — try again later', 429);
    }

    const result = validateUpload(body);
    if (!result.ok) return error(result.code, result.message, 400);
    const { name, author, thumbFrame, cols, rows, fps, cellPx, frames } = result.value;

    const id = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    // Canonical stored document — exactly the figure.json player contract.
    const doc = JSON.stringify({ cols, rows, fps, color: false, cellPx, name, author, createdAt, frames });
    const { thumb, thumbCols, thumbRows } = makeThumb(frames[thumbFrame], cols, rows);

    await env.FIGURES.put(`figures/${id}.json`, doc, {
      httpMetadata: { contentType: 'application/json' },
    });
    try {
      await env.DB.prepare(
        `INSERT INTO figures
           (id, name, author, cols, rows, fps, cell_px, frames_count, size_bytes,
            thumb_frame, thumb, thumb_cols, thumb_rows, status, created_at, ip_hash)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, 'pending', ?14, ?15)`,
      ).bind(
        id, name, author, cols, rows, fps, cellPx, frames.length, doc.length,
        thumbFrame, thumb, thumbCols, thumbRows, createdAt, hash,
      ).run();
    } catch (e) {
      // Don't leave an orphaned R2 object if the metadata insert fails.
      await env.FIGURES.delete(`figures/${id}.json`).catch(() => {});
      throw e;
    }

    // Heads-up email to the owner (optional, best-effort). waitUntil lets the
    // 201 return immediately while the mail call finishes in the background.
    waitUntil(
      notifyPendingUpload(env, new URL(request.url).origin, {
        name,
        author,
        cols,
        rows,
        fps,
        framesCount: frames.length,
        sizeBytes: doc.length,
        pendingCount: counts.pending + 1,
      }),
    );

    return json({ id, status: 'pending' }, 201);
  } catch {
    return error('internal', 'something went wrong', 500);
  }
}

export const onRequest = ({ request, ...rest }) =>
  request.method === 'POST' ? onRequestPost({ request, ...rest }) : methodNotAllowed();
