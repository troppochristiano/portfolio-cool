// Frame scrubber field for the UpModal dialogs (upload thumbnail picker, PNG
// frame export): "label N/M" over a range input. The caller renders the
// AsciiThumb preview itself — its placement differs per dialog.
export function FramePicker({ baked, frame, onChange, labelPrefix = 'frame' }) {
  return (
    <div className="upmodal-field">
      <span className="field-label">
        {labelPrefix} {frame + 1}/{baked.frames.length}
      </span>
      <input
        type="range"
        min={0}
        max={baked.frames.length - 1}
        value={frame}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </div>
  );
}
