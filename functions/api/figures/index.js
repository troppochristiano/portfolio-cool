// GET /api/figures?cursor=&limit=24 — the gallery grid, newest first.
// Items carry the downsampled text thumb so the grid renders with zero R2
// reads; the full JSON is only fetched on hover/click.
//
// Keyset pagination on (created_at, id): stable under inserts, no OFFSET scans.

import { json, error } from '../_lib/http.js';
import { route, rowToFigure } from '../_lib/route.js';

async function handleGet({ request, env }) {
  const url = new URL(request.url);
  const limit = Math.min(48, Math.max(1, Number(url.searchParams.get('limit')) || 24));

  let where = `status = 'approved'`;
  const binds = [];
  const rawCursor = url.searchParams.get('cursor');
  if (rawCursor) {
    let createdAt, id;
    try {
      [createdAt, id] = JSON.parse(atob(rawCursor));
    } catch {
      return error('invalid_cursor', 'bad cursor', 400);
    }
    if (typeof createdAt !== 'string' || typeof id !== 'string') {
      return error('invalid_cursor', 'bad cursor', 400);
    }
    where += ` AND (created_at < ?1 OR (created_at = ?1 AND id < ?2))`;
    binds.push(createdAt, id);
  }

  const { results } = await env.DB.prepare(
    `SELECT id, name, author, cols, rows, fps, cell_px AS cellPx,
            frames_count AS framesCount, thumb_frame AS thumbFrame,
            thumb, thumb_cols AS thumbCols, thumb_rows AS thumbRows,
            edge_thumb AS edgeThumb, style, created_at AS createdAt
     FROM figures WHERE ${where}
     ORDER BY created_at DESC, id DESC
     LIMIT ${limit + 1}`,
  ).bind(...binds).all();

  const items = results.slice(0, limit).map(rowToFigure);
  const last = items[items.length - 1];
  const nextCursor =
    results.length > limit ? btoa(JSON.stringify([last.createdAt, last.id])) : null;

  return json({ items, nextCursor }, 200, { 'Cache-Control': 'public, max-age=60' });
}

export const onRequest = route({ GET: handleGet });
