import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import AsciiPlayer from '../components/AsciiPlayer.jsx';
import FigureCard from '../components/FigureCard.jsx';
import FigureDialog from '../components/FigureDialog.jsx';
import {
  adminList,
  adminFigureData,
  adminApprove,
  adminReject,
} from '../lib/api.js';
import './Admin.css';

// Moderation — an unlinked route with two views:
//  · queue    new pending submissions with inline previews; approve puts a
//             figure in the gallery, "approve + hero" also on the hero wall.
//  · library  a mirrored gallery of EVERY figure (badged clip/photo, hero,
//             hidden); clicking opens the shared info dialog with the
//             moderation actions (hero toggle, hide/approve, delete).
// The admin secret is pasted once and kept in localStorage; the server does
// the actual gatekeeping (a wrong secret just gets 401s).

const SECRET_KEY = 'ascii_admin_secret';

const typeOf = (item) => ((item.framesCount ?? 1) > 1 ? 'clip' : 'photo');

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
        <button className="admin-btn" onClick={forget}>lock</button>
      </header>

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
    </div>
  );
}
