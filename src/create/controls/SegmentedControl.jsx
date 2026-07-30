/**
 * A row of mutually exclusive "keymode" buttons — the converter's standard
 * segmented control. options: [{ value, label, title? }].
 */
export default function SegmentedControl({ options, value, onChange }) {
  return (
    <div className="keymodes">
      {options.map((o) => (
        <button
          key={o.value}
          className={`keymode ${value === o.value ? "is-active" : ""}`}
          onClick={() => onChange(o.value)}
          title={o.title}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
