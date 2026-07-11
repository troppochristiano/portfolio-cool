// GET/POST /api/admin/settings — the site-wide switches (admin only).
// GET returns the current values; POST upserts the ones present in the body.
// Only 'uploads_enabled' exists today: it gates PUBLIC uploads in /api/upload
// (admin bearer uploads always pass). Missing row = enabled, so the toggle
// works even before the settings table has ever been written to.

import { json, error } from '../_lib/http.js';
import { route, requireAdmin } from '../_lib/route.js';

async function readUploadsEnabled(env) {
  const row = await env.DB.prepare(
    `SELECT value FROM settings WHERE key = 'uploads_enabled'`,
  ).first();
  return row?.value !== '0';
}

async function handleGet({ request, env }) {
  const denied = await requireAdmin(request, env);
  if (denied) return denied;
  return json(
    { uploadsEnabled: await readUploadsEnabled(env) },
    200,
    { 'Cache-Control': 'no-store' },
  );
}

async function handlePost({ request, env }) {
  const denied = await requireAdmin(request, env);
  if (denied) return denied;
  let body;
  try {
    body = await request.json();
  } catch {
    return error('invalid_json', 'body is not valid JSON', 400);
  }
  if (typeof body.uploadsEnabled !== 'boolean') {
    return error('invalid_body', 'uploadsEnabled must be a boolean', 400);
  }
  await env.DB.prepare(
    `INSERT INTO settings (key, value) VALUES ('uploads_enabled', ?1)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  )
    .bind(body.uploadsEnabled ? '1' : '0')
    .run();
  return json({ uploadsEnabled: body.uploadsEnabled });
}

export const onRequest = route({ GET: handleGet, POST: handlePost });
