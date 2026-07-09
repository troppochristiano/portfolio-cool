/**
 * A row of mutually exclusive "keymode" buttons — the converter's standard
 * segmented control. options: [{ value, label, title? }]. Extra children
 * (e.g. the eyedropper button) render after the options inside the same row.
 */
export default function SegmentedControl({
  options,
  value,
  onChange,
  className,
  role,
  ariaLabel,
  children,
}) {
  return (
    <div
      className={`keymodes${className ? ` ${className}` : ""}`}
      role={role}
      aria-label={ariaLabel}
    >
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
      {children}
    </div>
  );
}
