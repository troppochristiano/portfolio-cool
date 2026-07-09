// POST /api/admin/figures/:id/approve — publish a pending figure. Optional
// JSON body `{ hero: true }` also flags it for the hero wall in one step.

import { json, error } from '../../../_lib/http.js';
import { route, requireAdmin } from '../../../_lib/route.js';

async function handlePost({ request, env, params }) {
  const denied = await requireAdmin(request, env);
  if (denied) return denied;
  let hero = false;
  try {
    hero = (await request.json())?.hero === true;
  } catch { /* empty body → gallery-only approve */ }
  const { meta } = await env.DB.prepare(
    `UPDATE figures SET status = 'approved', hero = ?2 WHERE id = ?1 AND status = 'pending'`,
  ).bind(String(params.id || ''), hero ? 1 : 0).run();
  if (!meta.changes) return error('not_found', 'no pending figure with that id', 404);
  return json({ ok: true, hero });
}

export const onRequest = route({ POST: handlePost });
