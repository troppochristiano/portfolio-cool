import { useEffect, useState } from "react";
import { getAdminSecret } from "../lib/adminSecret.js";
import { adminGetSettings, adminSetUploadsEnabled } from "../lib/api.js";

// Admin-only corner pill on the hero: shows whether PUBLIC uploads are open
// and flips the server-side kill switch (settings.uploads_enabled in D1,
// enforced by /api/upload). Invisible to visitors: it renders nothing unless
// the moderation secret is in localStorage AND the server accepts it — a
// wrong/stale secret just keeps the pill hidden, it never prompts.
export function UploadsToggle() {
  const [secret] = useState(getAdminSecret);
  const [enabled, setEnabled] = useState(null); // null = unknown → hidden
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!secret) return;
    let alive = true;
    adminGetSettings(secret)
      .then((s) => alive && setEnabled(s.uploadsEnabled))
      .catch(() => {}); // 401 / API down → stay hidden
    return () => {
      alive = false;
    };
  }, [secret]);

  if (enabled === null) return null;

  const flip = async () => {
    setBusy(true);
    try {
      const { uploadsEnabled } = await adminSetUploadsEnabled(secret, !enabled);
      setEnabled(uploadsEnabled);
    } catch {
      /* keep the current state — the next click retries */
    }
    setBusy(false);
  };

  return (
    <button
      type="button"
      className={`uploads-pill${enabled ? "" : " is-off"}`}
      disabled={busy}
      onClick={flip}
      title="admin: open/close public gallery uploads"
    >
      uploads: {enabled ? "on" : "off"}
    </button>
  );
}
