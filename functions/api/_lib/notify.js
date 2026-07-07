// New-upload email notification, sent via Resend's REST API (free tier:
// 100/day — far above what the upload rate limits allow through).
//
// Fully optional: if RESEND_API_KEY or NOTIFY_EMAIL are unset the function
// is a no-op, and any send failure is swallowed — a broken mail provider
// must never fail or slow an upload (call it through waitUntil).
//
// Setup (one-time, after buying the domain):
//   1. resend.com → free account → verify the domain (or, before that,
//      the onboarding@resend.dev sender can mail your own account address).
//   2. npx wrangler pages secret put RESEND_API_KEY
//   3. npx wrangler pages secret put NOTIFY_EMAIL   (where alerts go)
//   4. optional: NOTIFY_FROM, e.g. "gallery <noreply@yourdomain.com>"
//      (defaults to Resend's onboarding sender until the domain is verified)

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );

export async function notifyPendingUpload(env, origin, fig) {
  if (!env.RESEND_API_KEY || !env.NOTIFY_EMAIL) return;
  try {
    const kind = fig.framesCount > 1 ? `clip · ${fig.framesCount} frames` : 'photo';
    const kb = Math.round(fig.sizeBytes / 1024);
    const subject = `ascii gallery: "${fig.name}" pending review (${fig.pendingCount} in queue)`;
    const html =
      `<p><strong>${esc(fig.name)}</strong> by ${esc(fig.author)} — ${kind}, ` +
      `${fig.cols}×${fig.rows} @ ${fig.fps} fps, ${kb} KB.</p>` +
      `<p>Queue: ${fig.pendingCount} pending.</p>` +
      `<p><a href="${esc(origin)}/admin">Open the moderation queue</a></p>`;
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: env.NOTIFY_FROM || 'ascii gallery <onboarding@resend.dev>',
        to: [env.NOTIFY_EMAIL],
        subject,
        html,
      }),
    });
  } catch {
    // Notification is best-effort by design.
  }
}
