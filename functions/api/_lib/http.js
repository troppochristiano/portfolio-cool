// Tiny response helpers shared by every endpoint. Errors always use the shape
// { error: { code, message } } and never leak internals or stack traces.

export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...headers },
  });
}

export function error(code, message, status) {
  return json({ error: { code, message } }, status);
}

export const methodNotAllowed = () =>
  error('method_not_allowed', 'method not allowed', 405);
