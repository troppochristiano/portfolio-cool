import { useDismissOnEscape } from "../hooks/useDismissOnEscape.js";

/**
 * Shared shell for the converter's small dialogs (share-to-gallery, PNG frame
 * picker): backdrop-click and Escape close it — both suppressed while `locked`
 * (mid-submit/download) — the × always closes.
 */
export default function UpModal({ title, onClose, locked = false, children }) {
  useDismissOnEscape(onClose, !locked);
  return (
    <div
      className="upmodal-backdrop"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget && !locked) onClose();
      }}
    >
      <div className="upmodal" role="dialog" aria-modal="true" aria-label={title}>
        <div className="block-label upmodal-title">
          {title}
          <button
            type="button"
            className="upmodal-close"
            onClick={onClose}
            aria-label="close"
          >
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
