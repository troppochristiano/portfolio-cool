import { useEffect, useState } from 'react';
import AsciiPlayer from './AsciiPlayer.jsx';
import { getFigureData, adminSetVisibility, adminReject } from '../lib/api.js';
import { downloadJson, downloadPng, downloadWebm, webmMimeType } from '../create/exportMedia.js';

// Info dialog for one figure — opened from the hero wall, the gallery, and
// the admin library. `figure` is a descriptor `{ key, name, author, url,
// createdAt?, … }`; the full JSON is fetched (promise-cached) so the player
// and the downloads share one copy that's usually already in memory.
//
// Admin mode: pass `admin = { item, secret, onChanged }` (item carries the
// live status/hero flags) to add a moderation row — hero toggle, hide /
// approve, delete. `onChanged({ id, ...patch })` lets the page update its
// grid; `onChanged({ id, deleted: true })` after delete.

const fmtDate = (iso) => {
  const d = new Date(iso || '');
  return Number.isNaN(d.getTime())
    ? null
    : d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
};

export default function FigureDialog({ figure, onClose, admin }) {
  const [data, setData] = useState(null);
  const [failed, setFailed] = useState(false);
  const [webmProgress, setWebmProgress] = useState(null);
  const [adminBusy, setAdminBusy] = useState(false);
  const [adminError, setAdminError] = useState('');

  useEffect(() => {
    let alive = true;
    setData(null);
    setFailed(false);
    // Admin dialogs for hidden figures must fetch with the bearer header —
    // the public data route 404s pending figures — so the descriptor can
    // carry its own fetcher.
    const fetchIt = figure.fetchData || (() => getFigureData(figure.url));
    fetchIt()
      .then((d) => alive && setData(d))
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [figure]);

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const name = figure.name || data?.name || 'untitled';
  const author = figure.author || data?.author || 'unknown';
  const created = fmtDate(figure.createdAt || data?.createdAt);
  const isAnim = (data?.frames?.length ?? figure.framesCount ?? 0) > 1;
  const canWebm = isAnim && !!webmMimeType();

  const saveWebm = async () => {
    if (!data || webmProgress !== null) return;
    setWebmProgress(0);
    try {
      await downloadWebm(data, { onProgress: setWebmProgress });
    } finally {
      setWebmProgress(null);
    }
  };

  // One guard for every moderation call: busy state + error surface + the
  // grid patch via onChanged.
  const moderate = async (action, patch) => {
    if (adminBusy) return;
    setAdminBusy(true);
    setAdminError('');
    try {
      await action();
      admin.onChanged({ id: admin.item.id, ...patch });
      if (patch.deleted) onClose();
    } catch (e) {
      setAdminError(e.status === 401 ? 'unauthorized — re-enter the secret' : 'action failed, try again');
    } finally {
      setAdminBusy(false);
    }
  };

  return (
    <div
      className="figdialog-backdrop"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="figdialog" role="dialog" aria-modal="true" aria-label={`${name} — details`}>
        <div className="figdialog__bar">
          <span className="figdialog__name">{name}</span>
          <button type="button" className="figdialog__close" onClick={onClose} aria-label="close">
            ×
          </button>
        </div>

        <div className="figdialog__stage">
          {data && <AsciiPlayer data={data} fit contain loop label={name} />}
          {!data && !failed && <span className="figdialog__note">loading…</span>}
          {failed && <span className="figdialog__note">couldn't load this figure.</span>}
        </div>

        <dl className="figdialog__meta">
          <div>
            <dt>author</dt>
            <dd>{author}</dd>
          </div>
          {created && (
            <div>
              <dt>date</dt>
              <dd>{created}</dd>
            </div>
          )}
          {data && (
            <>
              <div>
                <dt>grid</dt>
                <dd>
                  {data.cols}×{data.rows} @ {data.fps} fps
                </dd>
              </div>
              <div>
                <dt>frames</dt>
                <dd>{data.frames.length}</dd>
              </div>
            </>
          )}
          {admin && (
            <>
              <div>
                <dt>type</dt>
                <dd>{(admin.item.framesCount ?? 1) > 1 ? 'clip' : 'photo'}</dd>
              </div>
              <div>
                <dt>placement</dt>
                <dd>
                  {admin.item.status !== 'approved'
                    ? 'hidden (pending)'
                    : admin.item.hero
                      ? 'gallery + hero ★'
                      : 'gallery only'}
                </dd>
              </div>
            </>
          )}
        </dl>

        {admin && (
          <div className="figdialog__admin">
            <button
              className="figdialog__btn"
              disabled={adminBusy}
              onClick={() =>
                moderate(
                  () => adminSetVisibility(admin.item.id, admin.secret, { hero: !admin.item.hero }),
                  { hero: admin.item.hero ? 0 : 1 },
                )
              }
            >
              {admin.item.hero ? '★ remove from hero' : '☆ show in hero'}
            </button>
            {admin.item.status === 'approved' ? (
              <button
                className="figdialog__btn"
                disabled={adminBusy}
                onClick={() =>
                  moderate(
                    () => adminSetVisibility(admin.item.id, admin.secret, { status: 'pending' }),
                    { status: 'pending' },
                  )
                }
              >
                hide from site
              </button>
            ) : (
              <button
                className="figdialog__btn"
                disabled={adminBusy}
                onClick={() =>
                  moderate(
                    () => adminSetVisibility(admin.item.id, admin.secret, { status: 'approved' }),
                    { status: 'approved' },
                  )
                }
              >
                ✓ approve
              </button>
            )}
            <button
              className="figdialog__btn figdialog__btn--danger"
              disabled={adminBusy}
              onClick={() => {
                if (!window.confirm(`Permanently delete "${name}"?`)) return;
                moderate(() => adminReject(admin.item.id, admin.secret), { deleted: true });
              }}
            >
              ✕ delete
            </button>
            {adminError && <span className="figdialog__admin-error">{adminError}</span>}
          </div>
        )}

        <div className="figdialog__actions">
          <button className="figdialog__btn" disabled={!data} onClick={() => downloadJson(data)}>
            ↓ json
          </button>
          <button className="figdialog__btn" disabled={!data} onClick={() => downloadPng(data)}>
            ↓ png
          </button>
          {canWebm && (
            <button
              className="figdialog__btn"
              disabled={!data || webmProgress !== null}
              onClick={saveWebm}
            >
              {webmProgress !== null ? `recording… ${Math.round(webmProgress * 100)}%` : '↓ webm'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
