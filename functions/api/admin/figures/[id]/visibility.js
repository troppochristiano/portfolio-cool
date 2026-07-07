// POST /api/admin/figures/:id/visibility — change where a figure shows.
// Body: `{ status?: 'approved'|'pending', hero?: boolean }` (at least one).
// `status: 'pending'` hides it from the whole public site; the hero bit is
// kept as-is on hide so re-approving restores the previous placement (the
// hero query requires status='approved' anyway).

import { json, error, methodNotAllowed } from '../../../_lib/http.js';
import { isAdmin } from '../../../_lib/auth.js';

export async function onRequestPost({ request, env, params }) {
  try {
    if (!(await isAdmin(request, env))) return error('unauthorized', 'unauthorized', 401);

    let body;
    try {
      body = await request.json();
    } catch {
      return error('invalid_json', 'body is not valid JSON', 400);
    }
    const sets = [];
    const binds = [];
    if (body.status !== undefined) {
      if (body.status !== 'approved' && body.status !== 'pending') {
        return error('invalid_status', "status must be 'approved' or 'pending'", 400);
      }
      sets.push(`status = ?${binds.length + 2}`);
      binds.push(body.status);
    }
    if (body.hero !== undefined) {
      if (typeof body.hero !== 'boolean') {
        return error('invalid_hero', 'hero must be a boolean', 400);
      }
      sets.push(`hero = ?${binds.length + 2}`);
      binds.push(body.hero ? 1 : 0);
    }
    if (!sets.length) return error('invalid_body', 'nothing to change', 400);

    const { meta } = await env.DB.prepare(
      `UPDATE figures SET ${sets.join(', ')} WHERE id = ?1`,
    ).bind(String(params.id || ''), ...binds).run();
    if (!meta.changes) return error('not_found', 'no figure with that id', 404);
    return json({ ok: true });
  } catch {
    return error('internal', 'something went wrong', 500);
  }
}

export const onRequest = ({ request, ...rest }) =>
  request.method === 'POST' ? onRequestPost({ request, ...rest }) : methodNotAllowed();
