import { useEffect } from "react";

/** Close a dialog on Escape while `enabled` (e.g. not mid-submit). */
export function useDismissOnEscape(onClose, enabled = true) {
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, enabled]);
}
