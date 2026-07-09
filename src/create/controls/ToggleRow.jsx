/** A labelled checkbox row. */
export default function ToggleRow({ checked, onChange, children }) {
  return (
    <label className="toggle">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      {children}
    </label>
  );
}
