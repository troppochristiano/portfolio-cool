// POST /api/admin/figures/:id/approve — publish a pending figure. Optional
// JSON body `{ hero: true }` also flags it for the hero wall in one step.

import { json, error, methodNotAllowed } from '../../../_lib/http.js';
import { isAdmin } from '../../../_lib/auth.js';

export async function onRequestPost({ request, env, params }) {
  try {
    if (!(await isAdmin(request, env))) return error('unauthorized', 'unauthorized', 401);
    let hero = false;
    try {
      hero = (await request.json())?.hero === true;
    } catch { /* empty body → gallery-only approve */ }
    const { meta } = await env.DB.prepare(
      `UPDATE figures SET status = 'approved', hero = ?2 WHERE id = ?1 AND status = 'pending'`,
    ).bind(String(params.id || ''), hero ? 1 : 0).run();
    if (!meta.changes) return error('not_found', 'no pending figure with that id', 404);
    return json({ ok: true, hero });
  } catch {
    return error('internal', 'something went wrong', 500);
  }
}

export const onRequest = ({ request, ...rest }) =>
  request.method === 'POST' ? onRequestPost({ request, ...rest }) : methodNotAllowed();
