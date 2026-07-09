// GET /api/admin/figures?status=pending|approved|all — the moderation views.
// One endpoint feeds both admin tabs: the pending queue and the mirrored
// library. Includes thumbs (cards render without R2 reads) plus the status
// and hero flags. No pagination — total rows are capped at 1000.

import { json, error } from '../../_lib/http.js';
import { route, requireAdmin, rowToFigure } from '../../_lib/route.js';

const STATUSES = new Set(['pending', 'approved', 'all']);

async function handleGet({ request, env }) {
  const denied = await requireAdmin(request, env);
  if (denied) return denied;
  const status = new URL(request.url).searchParams.get('status') || 'approved';
  if (!STATUSES.has(status)) return error('invalid_status', 'bad status filter', 400);

  const where = status === 'all' ? '1=1' : 'status = ?1';
  const stmt = env.DB.prepare(
    `SELECT id, name, author, cols, rows, fps, cell_px AS cellPx,
            frames_count AS framesCount, size_bytes AS sizeBytes,
            thumb_frame AS thumbFrame, thumb, thumb_cols AS thumbCols,
            thumb_rows AS thumbRows, edge_thumb AS edgeThumb, style, status, hero, created_at AS createdAt
     FROM figures WHERE ${where}
     ORDER BY created_at ${status === 'pending' ? 'ASC' : 'DESC'}`,
  );
  const { results } = await (status === 'all' ? stmt : stmt.bind(status)).all();
  return json({ items: results.map(rowToFigure) }, 200, { 'Cache-Control': 'no-store' });
}

export const onRequest = route({ GET: handleGet });
