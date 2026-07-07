// Admin auth: a single bearer secret set via `wrangler pages secret put
// ADMIN_SECRET`. The comparison hashes both sides first so it can't be timed
// (equal-length digests, and no early-exit on the secret's own bytes).

const enc = new TextEncoder();

async function sha256(text) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(text)));
}

export async function isAdmin(request, env) {
  if (!env.ADMIN_SECRET) return false;
  const header = request.headers.get('Authorization') || '';
  if (!header.startsWith('Bearer ')) return false;
  const given = await sha256(header.slice(7));
  const expected = await sha256(env.ADMIN_SECRET);
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= given[i] ^ expected[i];
  return diff === 0;
}
