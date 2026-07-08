import { useState } from 'react';
import { Link } from 'react-router-dom';
import Create from './Create.jsx';
import { getAdminSecret, setAdminSecret } from '../lib/adminSecret.js';
import './Admin.css';

// /admin/create — the converter itself IS src/pages/Create.jsx, rendered with
// an adminSecret. There is deliberately no copy of the tool here: any change
// to the public /create page shows up on this route automatically. The only
// differences live in the upload path (no Turnstile, no daily/capacity limit
// — see functions/api/upload.js).
export default function AdminCreate() {
  const [secret, setSecret] = useState(() => getAdminSecret());
  const [input, setInput] = useState('');

  const unlock = () => {
    if (!input.trim()) return;
    setAdminSecret(input.trim());
    setSecret(input.trim());
  };

  if (!secret) {
    return (
      <div className="admin-page">
        <div className="admin-gate">
          <h1>admin create</h1>
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
          <Link className="home-pill" to="/admin">← moderation</Link>
        </div>
      </div>
    );
  }

  return <Create adminSecret={secret} />;
}
