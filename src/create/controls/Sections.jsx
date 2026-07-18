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
