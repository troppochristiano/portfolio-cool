import { useEffect, useRef, useState } from "react";

// Uncontrolled-while-dragging: the thumb and readout track a local value at
// input speed, but the parent (the whole Create tree) is committed to at most
// once per animation frame. Pointer input can outrun the display rate, and
// each commit re-renders every settings block — throttling here is what keeps
// fast drags from stacking layout work behind the pointer.
export default function Slider({
  label,
  value,
  min,
  max,
  step,
  onChange,
  suffix = "",
  fixed,
}) {
  const [local, setLocal] = useState(value);
  const dragging = useRef(false);
  const raf = useRef(0);
  const pending = useRef(value);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  // Follow external changes (ramp presets, resets) when not mid-drag.
  useEffect(() => {
    if (!dragging.current) setLocal(value);
  }, [value]);
  useEffect(() => () => cancelAnimationFrame(raf.current), []);

  const handle = (v) => {
    setLocal(v);
    pending.current = v;
    if (!raf.current)
      raf.current = requestAnimationFrame(() => {
        raf.current = 0;
        onChangeRef.current(pending.current);
      });
  };
  // Flush on release/blur so the final value never rides on a cancelled frame.
  const endDrag = () => {
    dragging.current = false;
    if (raf.current) {
      cancelAnimationFrame(raf.current);
      raf.current = 0;
      onChangeRef.current(pending.current);
    }
  };

  const shown = fixed != null ? Number(local).toFixed(fixed) : local;
  return (
    <label className="slider">
      <span className="slider-top">
        <span>{label}</span>
        <span className="slider-val">
          {shown}
          {suffix}
        </span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={local}
        onPointerDown={() => {
          dragging.current = true;
        }}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onBlur={endDrag}
        onChange={(e) => handle(Number(e.target.value))}
      />
    </label>
  );
}
