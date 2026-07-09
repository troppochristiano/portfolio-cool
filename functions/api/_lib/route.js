// Shared endpoint plumbing: method routing, the catch-all error boundary,
// and the admin gate — the three blocks every endpoint used to repeat.

import { error, methodNotAllowed } from './http.js';
import { isAdmin } from './auth.js';

/**
 * Route a Pages Function by HTTP method and wrap the handler in the shared
 * error boundary: any uncaught throw becomes the opaque 500 (never leaks
 * internals or stack traces). Usage:
 *   export const onRequest = route({ GET: handleGet });
 */
export function route(handlers) {
  return async (ctx) => {
    const handler = handlers[ctx.request.method];
    if (!handler) return methodNotAllowed();
    try {
      return await handler(ctx);
    } catch {
      return error('internal', 'something went wrong', 500);
    }
  };
}

/** Admin gate: returns the 401 response to send, or null when authorized. */
export async function requireAdmin(request, env) {
  return (await isAdmin(request, env))
    ? null
    : error('unauthorized', 'unauthorized', 401);
}

/**
 * D1 row → API item. The style column holds server-validated JSON (or NULL) —
 * hand the client an object so cards can tint without re-parsing.
 */
export const rowToFigure = (r) => ({
  ...r,
  style: r.style ? JSON.parse(r.style) : null,
});
