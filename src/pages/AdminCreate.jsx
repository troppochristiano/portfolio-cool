import { useState } from 'react';
import { Link } from 'react-router-dom';
import Create from './Create.jsx';
import { getAdminSecret, setAdminSecret } from '../lib/adminSecret.js';
import { AdminGate } from '../components/AdminGate.jsx';
import './Admin.css';

// /admin/create — the converter itself IS src/pages/Create.jsx, rendered with
// an adminSecret. There is deliberately no copy of the tool here: any change
// to the public /create page shows up on this route automatically. The only
// differences live in the upload path (no Turnstile, no daily/capacity limit
// — see functions/api/upload.js).
export default function AdminCreate() {
  const [secret, setSecret] = useState(() => getAdminSecret());

  if (!secret) {
    return (
      <AdminGate
        title="admin create"
        onUnlock={(v) => {
          setAdminSecret(v);
          setSecret(v);
        }}
      >
        <Link className="home-pill" to="/admin">← moderation</Link>
      </AdminGate>
    );
  }

  return <Create adminSecret={secret} />;
}
