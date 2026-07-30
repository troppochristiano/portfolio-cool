import { useState } from 'react';

// The admin unlock screen shared by /admin (moderation) and /admin/create:
// one password field, Enter or the button submits the trimmed secret. The
// caller persists it (setAdminSecret) and flips its own state; `children`
// renders extra links under the button (e.g. "← moderation").
export function AdminGate({ title, error, onUnlock, children }) {
  const [input, setInput] = useState('');
  const unlock = () => {
    const v = input.trim();
    if (v) onUnlock(v);
  };
  return (
    <div className="admin-page">
      <div className="admin-gate">
        <h1>{title}</h1>
        {error && <p className="admin-error">{error}</p>}
        <input
          type="password"
          placeholder="admin secret"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') unlock();
          }}
        />
        <button className="admin-btn primary" disabled={!input.trim()} onClick={unlock}>
          unlock
        </button>
        {children}
      </div>
    </div>
  );
}
