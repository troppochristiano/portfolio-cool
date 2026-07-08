import { useEffect, useRef, useState } from 'react';
import { uploadFigure } from '../lib/api.js';
import { resolveStyle } from '../create/styleOptions.js';

// Share-to-gallery dialog for the converter. Collects a figure name, the
// author's name and (for animations) a thumbnail frame, runs Cloudflare
// Turnstile, and submits the baked JSON for moderation. Uploads land as
// "pending" and only appear on the site once approved.

const SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY;

// Load the Turnstile script once per session (explicit render mode).
let turnstileLoader = null;
function loadTurnstile() {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  if (!turnstileLoader) {
    turnstileLoader = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
      s.async = true;
      s.onload = () => resolve(window.turnstile);
      s.onerror = () => {
        turnstileLoader = null;
        reject(new Error('turnstile_load_failed'));
      };
      document.head.appendChild(s);
    });
  }
  return turnstileLoader;
}

const ERROR_TEXT = {
  rate_limited: 'daily upload limit reached — try again tomorrow.',
  capacity: 'the review queue is full right now — try again later.',
  turnstile_failed: 'the human check failed — close and try again.',
  too_large: 'this figure is too large to upload (3 MB max) — lower the resolution or fps and rebake.',
  turnstile_load_failed: 'could not load the verification widget — check your connection.',
  unauthorized: 'admin secret rejected — unlock the moderation page again.',
};
const errorText = (code) =>
  ERROR_TEXT[code] || `upload rejected (${code || 'unknown error'}).`;

// With adminSecret set (the /admin/create route) the dialog is the same form,
// but Turnstile never loads and the upload authenticates with the bearer
// secret instead — the server then waives the daily/capacity limits.
export default function UploadModal({ baked, adminSecret = null, onClose }) {
  const isAnim = baked.frames.length > 1;
  const [name, setName] = useState(baked.name || '');
  const [author, setAuthor] = useState('');
  const [thumbFrame, setThumbFrame] = useState(0);
  const [token, setToken] = useState(null);
  const [phase, setPhase] = useState('form'); // 'form' | 'sending' | 'done'
  const [error, setError] = useState('');
  const widgetRef = useRef(null);

  // Turnstile widget lifecycle: render on open, remove on close.
  // Admin uploads authenticate with the bearer secret — no widget at all.
  useEffect(() => {
    if (!SITE_KEY || adminSecret) return;
    let widgetId = null;
    let alive = true;
    loadTurnstile()
      .then((turnstile) => {
        if (!alive || !widgetRef.current) return;
        widgetId = turnstile.render(widgetRef.current, {
          sitekey: SITE_KEY,
          theme: 'dark',
          callback: (t) => setToken(t),
          'expired-callback': () => setToken(null),
          'error-callback': () => setToken(null),
        });
      })
      .catch((e) => setError(errorText(e.message)));
    return () => {
      alive = false;
      if (widgetId !== null) window.turnstile?.remove(widgetId);
    };
  }, [adminSecret]);

  // Escape closes (except mid-submit).
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape' && phase !== 'sending') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [phase, onClose]);

  const canSubmit =
    phase === 'form' && name.trim() && author.trim() && (adminSecret || token);

  const submit = async () => {
    if (!canSubmit) return;
    setPhase('sending');
    setError('');
    try {
      await uploadFigure({
        token: adminSecret ? undefined : token,
        secret: adminSecret || undefined,
        name: name.trim(),
        author: author.trim(),
        thumbFrame: isAnim ? thumbFrame : 0,
        figure: baked,
      });
      setPhase('done');
    } catch (e) {
      setError(errorText(e.code));
      setToken(null); // tokens are single-use — Turnstile must re-verify
      setPhase('form');
      window.turnstile?.reset?.();
    }
  };

  // Fit the thumbnail preview into the modal column (~0.6 advance ratio), and
  // render it with the figure's style block so the scrubber shows exactly
  // what the gallery will.
  const previewFont = Math.max(1.5, Math.min(8, 300 / (baked.cols * 0.6)));
  const st = resolveStyle(baked.style);
  const frameIdx = isAnim ? thumbFrame : 0;

  return (
    <div
      className="upmodal-backdrop"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget && phase !== 'sending') onClose();
      }}
    >
      <div className="upmodal" role="dialog" aria-modal="true" aria-label="share to gallery">
        <div className="block-label upmodal-title">
          share to gallery
          <button type="button" className="upmodal-close" onClick={onClose} aria-label="close">
            ×
          </button>
        </div>

        {phase === 'done' ? (
          <div className="upmodal-body">
            <p className="upmodal-done">
              submitted — your figure is <strong>pending review</strong> and will show up in the
              gallery once approved.
            </p>
            <div className="upmodal-actions">
              <button className="btn primary" onClick={onClose}>done</button>
            </div>
          </div>
        ) : (
          <div className="upmodal-body">
            {!SITE_KEY && !adminSecret && (
              <p className="upmodal-error">
                uploads aren't configured (missing VITE_TURNSTILE_SITE_KEY).
              </p>
            )}

            <label className="upmodal-field">
              <span className="field-label">figure name</span>
              <input
                type="text"
                maxLength={40}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="untitled"
              />
            </label>

            <label className="upmodal-field">
              <span className="field-label">your name</span>
              <input
                type="text"
                maxLength={30}
                value={author}
                onChange={(e) => setAuthor(e.target.value)}
                placeholder="anonymous is fine too"
              />
            </label>

            {isAnim && (
              <div className="upmodal-field">
                <span className="field-label">
                  thumbnail — frame {thumbFrame + 1}/{baked.frames.length}
                </span>
                <input
                  type="range"
                  min={0}
                  max={baked.frames.length - 1}
                  value={thumbFrame}
                  onChange={(e) => setThumbFrame(Number(e.target.value))}
                />
              </div>
            )}
            <div className="upmodal-thumb-stack">
              <pre
                className="upmodal-thumb"
                style={{
                  fontSize: `${previewFont}px`,
                  fontFamily: st.fontFamily,
                  letterSpacing: st.letterSpacing ? `${st.letterSpacing}em` : undefined,
                  lineHeight: st.lineHeight,
                  color: st.color,
                  background: st.background,
                  gridArea: '1 / 1',
                }}
                aria-hidden="true"
              >
                {baked.frames[frameIdx]}
              </pre>
              {baked.edgeFrames && (
                <pre
                  className="upmodal-thumb"
                  style={{
                    fontSize: `${previewFont}px`,
                    fontFamily: st.fontFamily,
                    letterSpacing: st.letterSpacing ? `${st.letterSpacing}em` : undefined,
                    lineHeight: st.lineHeight,
                    color: st.edgeColor,
                    background: 'transparent',
                    gridArea: '1 / 1',
                    pointerEvents: 'none',
                  }}
                  aria-hidden="true"
                >
                  {baked.edgeFrames[frameIdx]}
                </pre>
              )}
            </div>

            {/* Turnstile mounts here (invisible/managed) — never for admin */}
            {!adminSecret && <div ref={widgetRef} className="upmodal-turnstile" />}

            {error && <p className="upmodal-error">{error}</p>}

            <div className="upmodal-actions">
              <button className="btn" onClick={onClose} disabled={phase === 'sending'}>
                cancel
              </button>
              <button className="btn primary" onClick={submit} disabled={!canSubmit}>
                {phase === 'sending' ? 'uploading…' : '↑ submit for review'}
              </button>
            </div>
            <p className="hint">
              {adminSecret
                ? 'admin upload — no human check, no daily limit; it still lands in the review queue.'
                : 'uploads are reviewed by hand before they appear in the gallery.'}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
