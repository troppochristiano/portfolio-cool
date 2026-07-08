// Thin client for the figures API (Cloudflare Pages Functions under /api).
// Figure JSONs are immutable once approved, so getFigureData memoizes the
// fetch promise per URL: the same figure on five hero planes downloads once,
// and a gallery hover-replay is free.

async function getJson(url, init) {
  const res = await fetch(url, init);
  if (!res.ok) {
    let code = `http_${res.status}`;
    try {
      code = (await res.json())?.error?.code || code;
    } catch { /* non-JSON error body */ }
    const err = new Error(code);
    err.status = res.status;
    err.code = code;
    throw err;
  }
  return res.json();
}

/** Random approved figures (metadata only) for the hero wall. */
export function getRandomFigures(count = 12) {
  return getJson(`/api/figures/random?count=${count}`);
}

/** One page of the gallery grid (thumbs included). */
export function getGalleryPage(cursor, limit = 24) {
  const qs = new URLSearchParams({ limit: String(limit) });
  if (cursor) qs.set('cursor', cursor);
  return getJson(`/api/figures?${qs}`);
}

const dataCache = new Map(); // url -> Promise<figure.json>

/** Full figure.json by URL (static /data/*.json or /api/figures/:id/data). */
export function getFigureData(url) {
  let p = dataCache.get(url);
  if (!p) {
    p = getJson(url).catch((e) => {
      dataCache.delete(url); // don't cache failures — a retry may succeed
      throw e;
    });
    dataCache.set(url, p);
  }
  return p;
}

/** Submit a baked figure for moderation. With `secret` (admin create tool)
 *  the request authenticates via bearer instead of a Turnstile token and the
 *  server skips the rate/capacity limits. */
export function uploadFigure({ token, name, author, thumbFrame, figure, secret }) {
  return getJson('/api/upload', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(secret ? { Authorization: `Bearer ${secret}` } : {}),
    },
    body: JSON.stringify({
      ...(secret ? {} : { token }),
      name, author, thumbFrame, figure,
    }),
  });
}

// ── admin ──
const bearer = (secret) => ({ Authorization: `Bearer ${secret}` });

/** All figures for a moderation view: status 'pending' | 'approved' | 'all'. */
export function adminList(secret, status = 'approved') {
  return getJson(`/api/admin/figures?status=${status}`, { headers: bearer(secret) });
}

export function adminFigureData(id, secret) {
  // Not memoized: pending data is only viewed once and freed on moderation.
  return getJson(`/api/figures/${id}/data`, { headers: bearer(secret) });
}

/** Publish a pending figure; `hero: true` also puts it on the hero wall. */
export function adminApprove(id, secret, { hero = false } = {}) {
  return getJson(`/api/admin/figures/${id}/approve`, {
    method: 'POST',
    headers: { ...bearer(secret), 'Content-Type': 'application/json' },
    body: JSON.stringify({ hero }),
  });
}

/** Change placement of any figure: { status: 'approved'|'pending', hero: bool }. */
export function adminSetVisibility(id, secret, changes) {
  return getJson(`/api/admin/figures/${id}/visibility`, {
    method: 'POST',
    headers: { ...bearer(secret), 'Content-Type': 'application/json' },
    body: JSON.stringify(changes),
  });
}

export function adminReject(id, secret) {
  return getJson(`/api/admin/figures/${id}/reject`, { method: 'POST', headers: bearer(secret) });
}
