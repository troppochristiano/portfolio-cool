import { useState } from 'react';

// One guard for every moderation call: busy state + error surface + the 401
// branch, so "unauthorized" reads the same everywhere. `run` swallows overlap
// (a second click while busy is a no-op); the caller supplies what success
// means (patch the grid, drop the card, close the dialog).
export function useAdminAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const run = async (action, { onSuccess, on401, failMessage = 'action failed, try again' } = {}) => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const result = await action();
      onSuccess?.(result);
    } catch (e) {
      if (e.status === 401) {
        setError('unauthorized — re-enter the secret');
        on401?.();
      } else {
        setError(failMessage);
      }
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, run };
}
