// POST /api/admin/figures/:id/reject — hard-delete a figure (metadata + R2
// object). Works on approved figures too, so it doubles as a takedown tool.

import { json, error, methodNotAllowed } from '../../../_lib/http.js';
import { isAdmin } from '../../../_lib/auth.js';

export async function onRequestPost({ request, env, params }) {
  try {
    if (!(await isAdmin(request, env))) return error('unauthorized', 'unauthorized', 401);
    const id = String(params.id || '');
    const { meta } = await env.DB.prepare(`DELETE FROM figures WHERE id = ?1`).bind(id).run();
    if (!meta.changes) return error('not_found', 'no figure with that id', 404);
    await env.FIGURES.delete(`figures/${id}.json`).catch(() => {});
    return json({ ok: true });
  } catch {
    return error('internal', 'something went wrong', 500);
  }
}

export const onRequest = ({ request, ...rest }) =>
  request.method === 'POST' ? onRequestPost({ request, ...rest }) : methodNotAllowed();
