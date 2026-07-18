// POST /api/admin/figures/:id/reject — hard-delete a figure (metadata + R2
// object). Works on approved figures too, so it doubles as a takedown tool.

import { json, error } from "../../../_lib/http.js";
import { route, requireAdmin } from "../../../_lib/route.js";

async function handlePost({ request, env, params }) {
  const denied = await requireAdmin(request, env);
  if (denied) return denied;
  const id = String(params.id || "");
  const { meta } = await env.DB.prepare(`DELETE FROM figures WHERE id = ?1`)
    .bind(id)
    .run();
  if (!meta.changes) return error("not_found", "no figure with that id", 404);
  await env.FIGURES.delete(`figures/${id}`).catch(() => {});
  return json({ ok: true });
}

export const onRequest = route({ POST: handlePost });
