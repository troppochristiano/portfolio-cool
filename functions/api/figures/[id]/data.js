// GET /api/figures/:id/data — the full figure.json from R2.
//
// Approved figures are immutable, so they get a year-long immutable
// Cache-Control and are memoized in the edge cache (caches.default): repeat
// views cost zero R2 reads and zero D1 queries. Pending figures are only
// visible with the admin bearer (and 404 — not 401 — without it, so their
// existence never leaks).

import { error } from '../../_lib/http.js';
import { route } from '../../_lib/route.js';
import { isAdmin } from '../../_lib/auth.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

async function handleGet({ request, env, params, waitUntil }) {
  const id = String(params.id || '').toLowerCase();
  if (!UUID_RE.test(id)) return error('invalid_id', 'bad figure id', 400);

  // Edge cache first (approved figures only ever land here).
  const cacheKey = new Request(new URL(request.url).toString(), { method: 'GET' });
  const cache = caches.default;
  const hit = await cache.match(cacheKey);
  if (hit) return hit;

  const row = await env.DB.prepare(`SELECT status FROM figures WHERE id = ?1`).bind(id).first();
  if (!row) return error('not_found', 'figure not found', 404);
  if (row.status !== 'approved' && !(await isAdmin(request, env))) {
    return error('not_found', 'figure not found', 404);
  }

  const obj = await env.FIGURES.get(`figures/${id}.json`);
  if (!obj) return error('not_found', 'figure not found', 404);

  const res = new Response(obj.body, {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  });
  if (row.status === 'approved') {
    waitUntil(cache.put(cacheKey, res.clone()));
  }
  return res;
}

export const onRequest = route({ GET: handleGet });
