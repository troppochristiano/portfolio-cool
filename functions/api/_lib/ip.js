// Privacy-preserving rate-limit key: raw IPs are never stored, only a salted
// SHA-256. The salt lives in the Worker env (IP_SALT secret), so the hashes
// are useless outside this deployment.

const enc = new TextEncoder();

export async function ipHash(request, env) {
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const digest = await crypto.subtle.digest('SHA-256', enc.encode(`${env.IP_SALT || ''}${ip}`));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
