import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import AsciiPlayer from '../components/AsciiPlayer.jsx';
import FigureCard from '../components/FigureCard.jsx';
import FigureDialog from '../components/FigureDialog.jsx';
import UploadModal from '../components/UploadModal.jsx';
import {
  adminList,
  adminFigureData,
  adminApprove,
  adminReject,
} from '../lib/api.js';
import { SECRET_KEY } from '../lib/adminSecret.js';
import './Admin.css';
// The share modal's styles live in Create.css; every rule there is scoped
// under .create-page, so importing it cannot restyle the admin page itself.
import './Create.css';

// Moderation — an unlinked route with two views:
//  · queue    new pending submissions with inline previews; approve puts a
//             figure in the gallery, "approve + hero" also on the hero wall.
//  · library  a mirrored gallery of EVERY figure (badged clip/photo, hero,
//             hidden); clicking opens the shared info dialog with the
//             moderation actions (hero toggle, hide/approve, delete).
// The admin secret is pasted once and kept in localStorage; the server does
// the actual gatekeeping (a wrong secret just gets 401s).

const typeOf = (item) => ((item.framesCount ?? 1) > 1 ? 'clip' : 'photo');

// Free-tier budget for the library storage meter. Figure JSONs live in R2
// (Cloudflare free tier: 10 GB stored); thumbs ride along in D1 rows and are
// negligible next to the docs. FIGURE_CAP mirrors MAX_TOTAL in
// functions/api/upload.js — the server refuses public uploads past it.
const R2_FREE_BYTES = 10 * 1024 ** 3;
const FIGURE_CAP = 1000;

const fmtBytes = (n) =>
  n >= 1024 ** 3
    ? `${(n / 1024 ** 3).toFixed(2)} GB`
    : n >= 1024 ** 2
      ? `${(n / 1024 ** 2).toFixed(1)} MB`
      : `${Math.ceil(n / 1024)} KB`;

// "How much can this fill before I pay?" — sums size_bytes over the already-
// loaded library list (every figure, hidden ones included), so it costs zero
// extra API calls. It reads low by the D1 thumb bytes, but the R2 docs dwarf
// those and the practical ceiling is the 1000-figure cap anyway (1000 × 3 MB
// max ≈ 3 GB, well inside the free 10 GB).
function StorageMeter({ items }) {
  const used = items.reduce((sum, i) => sum + (i.sizeBytes || 0), 0);
  const pct = (used / R2_FREE_BYTES) * 100;
  return (
    <div className="admin-meter">
      <div className="admin-meter__bar" role="presentation">
        <span style={{ width: `${Math.max(pct, 0.5)}%` }} />
      </div>
      <div className="admin-muted">
        {fmtBytes(used)} of 10 GB free-tier storage used ({pct.toFixed(2)}%) ·{' '}
        {fmtBytes(R2_FREE_BYTES - used)} left before R2 costs money ·{' '}
        {items.length}/{FIGURE_CAP} figures (server cap)
      </div>
    </div>
  );
}

// Light sanity check for a "download json" file before handing it to the
// share modal (which reads frames/cols/style unguarded). Mirrors just enough
// of the server's validation to give a readable error instead of a crash or
// an opaque 400 — the server stays the real gatekeeper.
function checkFigureJson(fig) {
  if (typeof fig !== 'object' || fig === null || Array.isArray(fig))
    return 'not a figure file — expected a JSON object.';
  if (
    !Array.isArray(fig.frames) ||
    fig.frames.length === 0 ||
    fig.frames.some((f) => typeof f !== 'string')
  )
    return 'not a figure file — "frames" must be a non-empty array of strings.';
  if (![fig.cols, fig.rows, fig.fps].every((n) => Number.isInteger(n) && n > 0))
    return 'not a figure file — cols/rows/fps must be positive integers.';
  if (fig.color !== false && fig.color !== undefined)
    return "color figures can't be uploaded — rebake without color.";
  if (
    fig.edgeFrames != null &&
    (!Array.isArray(fig.edgeFrames) ||
      fig.edgeFrames.length !== fig.frames.length ||
      fig.edgeFrames.some((f) => typeof f !== 'string'))
  )
    return 'broken edge layer — edgeFrames must mirror frames one-to-one.';
  return null;
}

function PendingCard({ item, secret, onDone }) {
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    adminFigureData(item.id, secret)
      .then((d) => alive && setData(d))
      .catch(() => alive && setError('preview failed to load'));
    return () => {
      alive = false;
    };
  }, [item.id, secret]);

  const act = async (fn, verb) => {
    if (verb === 'reject' && !window.confirm(`Reject and permanently delete "${item.name}"?`)) return;
    setBusy(true);
    setError('');
    try {
      await fn();
      onDone(item.id);
    } catch (e) {
      setBusy(false);
      setError(e.status === 401 ? 'unauthorized' : `${verb} failed — try again`);
      if (e.status === 401) onDone(null); // signals a bad secret upstream
    }
  };

  return (
    <div className="admin-card">
      <div className="admin-card__screen">
        {data ? <AsciiPlayer data={data} fit loop /> : <span className="admin-muted">{error || 'loading…'}</span>}
      </div>
      <div className="admin-card__meta">
        <strong>{item.name}</strong> <span className="admin-muted">by {item.author}</span>{' '}
        <span className="gallery-card__badge">{typeOf(item)}</span>
        <div className="admin-muted">
          {item.cols}×{item.rows} @ {item.fps} fps · {item.framesCount} frames ·{' '}
          {(item.sizeBytes / 1024).toFixed(0)} KB · {new Date(item.createdAt).toLocaleString()}
        </div>
        {error && <div className="admin-error">{error}</div>}
      </div>
      <div className="admin-card__actions">
        <button
          className="admin-btn primary"
          disabled={busy}
          onClick={() => act(() => adminApprove(item.id, secret), 'approve')}
        >
          ✓ approve
        </button>
        <button
          className="admin-btn primary"
          disabled={busy}
          onClick={() => act(() => adminApprove(item.id, secret, { hero: true }), 'approve')}
        >
          ★ approve + hero
        </button>
        <button
          className="admin-btn danger"
          disabled={busy}
          onClick={() => act(() => adminReject(item.id, secret), 'reject')}
        >
          ✕ reject
        </button>
      </div>
    </div>
  );
}

export default function Admin() {
  const [secret, setSecret] = useState(() => localStorage.getItem(SECRET_KEY) || '');
  const [input, setInput] = useState('');
  const [tab, setTab] = useState('queue'); // 'queue' | 'library'
  const [pending, setPending] = useState(null); // null = loading
  const [library, setLibrary] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [gateError, setGateError] = useState('');
  // Direct .json upload ("transfer" figures made elsewhere into this DB).
  const fileRef = useRef(null);
  const [jsonUpload, setJsonUpload] = useState(null); // parsed figure or null
  const [jsonError, setJsonError] = useState('');

  const forget = useCallback(() => {
    localStorage.removeItem(SECRET_KEY);
    setSecret('');
    setPending(null);
    setLibrary(null);
    setSelectedId(null);
    setGateError('wrong or expired secret — paste it again.');
  }, []);

  // Both lists load up front (cheap metadata) so tab switches are instant and
  // queue actions can patch the library view too.
  useEffect(() => {
    if (!secret) return;
    let alive = true;
    Promise.all([adminList(secret, 'pending'), adminList(secret, 'all')])
      .then(([p, all]) => {
        if (!alive) return;
        setPending(p.items);
        setLibrary(all.items);
      })
      .catch((e) => {
        if (!alive) return;
        if (e.status === 401) forget();
        else setGateError('could not reach the API.');
      });
    return () => {
      alive = false;
    };
  }, [secret, forget]);

  // Queue card resolved (approved either way, or rejected): drop it from the
  // queue and refresh the library snapshot from the server (one cheap call —
  // simpler than mirroring which action happened).
  const queueDone = (id) => {
    if (id === null) return forget(); // child saw a 401
    setPending((prev) => prev.filter((i) => i.id !== id));
    adminList(secret, 'all')
      .then(({ items }) => setLibrary(items))
      .catch(() => {});
  };

  // After a direct json upload lands (as pending), re-pull both lists so the
  // queue count updates without a reload.
  const refresh = useCallback(() => {
    Promise.all([adminList(secret, 'pending'), adminList(secret, 'all')])
      .then(([p, all]) => {
        setPending(p.items);
        setLibrary(all.items);
      })
      .catch(() => {});
  }, [secret]);

  const onJsonFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // so the same file can be re-selected
    if (!file) return;
    setJsonError('');
    try {
      const fig = JSON.parse(await file.text());
      const bad = checkFigureJson(fig);
      if (bad) {
        setJsonError(`${file.name}: ${bad}`);
        return;
      }
      setJsonUpload(fig);
    } catch {
      setJsonError(`"${file.name}" is not valid JSON.`);
    }
  };

  // Dialog moderation actions patch the library in place.
  const libraryChanged = ({ id, deleted, ...patch }) => {
    setLibrary((prev) =>
      deleted ? prev.filter((i) => i.id !== id) : prev.map((i) => (i.id === id ? { ...i, ...patch } : i)),
    );
    setPending((prev) =>
      prev
        ? deleted || patch.status === 'approved'
          ? prev.filter((i) => i.id !== id)
          : prev.map((i) => (i.id === id ? { ...i, ...patch } : i))
        : prev,
    );
  };

  if (!secret) {
    return (
      <div className="admin-page">
        <div className="admin-gate">
          <h1>moderation</h1>
          {gateError && <p className="admin-error">{gateError}</p>}
          <input
            type="password"
            placeholder="admin secret"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && input.trim()) {
                localStorage.setItem(SECRET_KEY, input.trim());
                setSecret(input.trim());
              }
            }}
          />
          <button
            className="admin-btn primary"
            disabled={!input.trim()}
            onClick={() => {
              localStorage.setItem(SECRET_KEY, input.trim());
              setSecret(input.trim());
            }}
          >
            unlock
          </button>
        </div>
      </div>
    );
  }

  const selected = selectedId && library?.find((i) => i.id === selectedId);

  return (
    <div className="admin-page">
      <header className="admin-head">
        <Link className="home-pill" to="/">← home</Link>
        <div className="admin-tabs">
          <button
            className={`admin-tab ${tab === 'queue' ? 'is-active' : ''}`}
            onClick={() => setTab('queue')}
          >
            queue {pending ? `(${pending.length})` : ''}
          </button>
          <button
            className={`admin-tab ${tab === 'library' ? 'is-active' : ''}`}
            onClick={() => setTab('library')}
          >
            library {library ? `(${library.length})` : ''}
          </button>
        </div>
        <div className="admin-head__actions">
          <button className="admin-btn" onClick={() => fileRef.current?.click()}>
            ↑ upload json
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".json,application/json"
            hidden
            onChange={onJsonFile}
          />
          <Link className="admin-btn" to="/admin/create">+ create</Link>
          <button className="admin-btn" onClick={forget}>lock</button>
        </div>
      </header>

      {jsonError && <p className="admin-error">{jsonError}</p>}

      {tab === 'queue' && (
        <>
          {pending === null && <p className="admin-muted">loading…</p>}
          {pending?.length === 0 && <p className="admin-muted">queue is empty — nothing to review.</p>}
          <div className="admin-list">
            {pending?.map((item) => (
              <PendingCard key={item.id} item={item} secret={secret} onDone={queueDone} />
            ))}
          </div>
        </>
      )}

      {tab === 'library' && (
        <>
          {library === null && <p className="admin-muted">loading…</p>}
          {library && <StorageMeter items={library} />}
          {library?.length === 0 && <p className="admin-muted">no figures yet.</p>}
          <div className="gallery-grid admin-library">
            {library?.map((item) => (
              <FigureCard
                key={item.id}
                item={item}
                fetchData={(id) => adminFigureData(id, secret)}
                onSelect={() => setSelectedId(item.id)}
                badges={
                  <>
                    <span className="gallery-card__badge">{typeOf(item)}</span>
                    {!!item.hero && <span className="gallery-card__badge is-hero">hero</span>}
                    {item.status !== 'approved' && (
                      <span className="gallery-card__badge is-hidden">hidden</span>
                    )}
                  </>
                }
              />
            ))}
          </div>
        </>
      )}

      {selected && (
        <FigureDialog
          figure={{
            key: selected.id,
            name: selected.name,
            author: selected.author,
            url: `/api/figures/${selected.id}/data`,
            createdAt: selected.createdAt,
            framesCount: selected.framesCount,
            // hidden figures 404 on the public data route — fetch with bearer
            fetchData: () => adminFigureData(selected.id, secret),
          }}
          admin={{ item: selected, secret, onChanged: libraryChanged }}
          onClose={() => setSelectedId(null)}
        />
      )}

      {/* Direct .json upload → same share modal as /admin/create. The wrapper
          class only scopes the modal's Create.css rules; its layout styles are
          neutralized inline (the backdrop is position:fixed, so the wrapper
          contributes zero layout of its own). */}
      {jsonUpload && (
        <div className="create-page" style={{ height: 'auto', overflow: 'visible' }}>
          <UploadModal
            baked={
              jsonUpload.color === undefined
                ? { ...jsonUpload, color: false }
                : jsonUpload
            }
            adminSecret={secret}
            onSuccess={refresh}
            onClose={() => setJsonUpload(null)}
          />
        </div>
      )}
    </div>
  );
}
