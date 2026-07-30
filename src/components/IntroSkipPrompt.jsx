import { useEffect, useState } from "react";
import { setIntroSkipPref } from "../lib/introPref.js";
import { useDismissOnEscape } from "../hooks/useDismissOnEscape.js";

// Post-skip corner prompt: offers to persist the skip for future visits.
// Ignoring it auto-dismisses with nothing stored (a future visit's skip may
// ask again); "yes" writes the pref and flashes a short confirmation pointing
// at the About footer toggle — which the pref itself unlocks — before closing.
const ASK_MS = 7000;
const FLASH_MS = 2000;

export function IntroSkipPrompt({ onClose }) {
  const [confirmed, setConfirmed] = useState(false);

  // One countdown per face: the ask window, then the confirmation flash.
  // `onClose` must be referentially stable (useCallback in App) — a fresh
  // identity on every App render would restart the countdown forever.
  useEffect(() => {
    const t = window.setTimeout(onClose, confirmed ? FLASH_MS : ASK_MS);
    return () => window.clearTimeout(t);
  }, [confirmed, onClose]);

  // Escape = "no" while asking; the flash just runs out on its own.
  useDismissOnEscape(onClose, !confirmed);

  if (confirmed) {
    return (
      <div className="intro-skip-prompt" role="status">
        intro off — change it in about
      </div>
    );
  }
  return (
    <div className="intro-skip-prompt">
      <span id="intro-skip-q" className="intro-skip-prompt__q">
        skip the intro on future visits?
      </span>
      <div
        className="intro-skip-prompt__row"
        role="group"
        aria-labelledby="intro-skip-q"
      >
        <button
          type="button"
          className="intro-skip-prompt__btn"
          onClick={() => {
            setIntroSkipPref();
            setConfirmed(true);
          }}
        >
          yes
        </button>
        <button
          type="button"
          className="intro-skip-prompt__btn"
          onClick={onClose}
        >
          no
        </button>
      </div>
    </div>
  );
}
