// GET /api/figures/random?count=N — random hero-approved figures for the
// hero wall (approval alone puts a figure in the gallery; the hero flag is a
// second, admin-set gate). Metadata only (no frames, no thumb): each plane
// then fetches its own JSON from /api/figures/:id/data so the wall can
// populate plane-by-plane.

import { json } from '../_lib/http.js';
import { route } from '../_lib/route.js';

async function handleGet({ request, env }) {
  const url = new URL(request.url);
  const count = Math.min(64, Math.max(1, Number(url.searchParams.get('count')) || 12));
  // ORDER BY RANDOM() is fine at this scale (total rows are capped at 1000).
  const { results } = await env.DB.prepare(
    `SELECT id, name, author, cols, rows, fps, cell_px AS cellPx,
            frames_count AS framesCount, thumb_frame AS thumbFrame, created_at AS createdAt
     FROM figures WHERE status = 'approved' AND hero = 1
     ORDER BY RANDOM() LIMIT ?1`,
  ).bind(count).all();
  return json({ figures: results }, 200, { 'Cache-Control': 'no-store' });
}

export const onRequest = route({ GET: handleGet });
