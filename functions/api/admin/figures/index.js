// GET /api/admin/figures?status=pending|approved|all — the moderation views.
// One endpoint feeds both admin tabs: the pending queue and the mirrored
// library. Includes thumbs (cards render without R2 reads) plus the status
// and hero flags. No pagination — total rows are capped at 1000.

import { json, error, methodNotAllowed } from '../../_lib/http.js';
import { isAdmin } from '../../_lib/auth.js';

const STATUSES = new Set(['pending', 'approved', 'all']);

export async function onRequestGet({ request, env }) {
  try {
    if (!(await isAdmin(request, env))) return error('unauthorized', 'unauthorized', 401);
    const status = new URL(request.url).searchParams.get('status') || 'approved';
    if (!STATUSES.has(status)) return error('invalid_status', 'bad status filter', 400);

    const where = status === 'all' ? '1=1' : 'status = ?1';
    const stmt = env.DB.prepare(
      `SELECT id, name, author, cols, rows, fps, cell_px AS cellPx,
              frames_count AS framesCount, size_bytes AS sizeBytes,
              thumb_frame AS thumbFrame, thumb, thumb_cols AS thumbCols,
              thumb_rows AS thumbRows, style, status, hero, created_at AS createdAt
       FROM figures WHERE ${where}
       ORDER BY created_at ${status === 'pending' ? 'ASC' : 'DESC'}`,
    );
    const { results } = await (status === 'all' ? stmt : stmt.bind(status)).all();
    const items = results.map((r) => ({ ...r, style: r.style ? JSON.parse(r.style) : null }));
    return json({ items }, 200, { 'Cache-Control': 'no-store' });
  } catch {
    return error('internal', 'something went wrong', 500);
  }
}

export const onRequest = ({ request, ...rest }) =>
  request.method === 'GET' ? onRequestGet({ request, ...rest }) : methodNotAllowed();
