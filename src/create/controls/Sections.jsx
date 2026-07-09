/** A collapsible settings category — the label bar toggles the body. */
export function SettingsBlock({ label, open, onToggle, children }) {
  return (
    <section className="block">
      <button
        className="block-label block-toggle"
        aria-expanded={open}
        onClick={onToggle}
      >
        <span>{label}</span>
        <span className="caret" aria-hidden="true">
          {open ? "▾" : "▸"}
        </span>
      </button>
      {open && <div className="block-body">{children}</div>}
    </section>
  );
}

/** A collapsible sub-section inside the source panel (keyzone styling). */
export function SourceSection({ label, status, statusOn, open, onToggle, children }) {
  return (
    <div className="keyzone">
      <button className="zone-toggle" aria-expanded={open} onClick={onToggle}>
        <span className="field-label">{label}</span>
        {/* current state surfaced in the header so a collapsed section still
            tells you it exists and what it's set to */}
        {status && (
          <span className={`zone-status${statusOn ? " is-on" : ""}`}>
            {status}
          </span>
        )}
        <span className="caret" aria-hidden="true">
          {open ? "▾" : "▸"}
        </span>
      </button>
      {open && <div className="zone-body">{children}</div>}
    </div>
  );
}
