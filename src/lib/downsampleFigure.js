// Client-side twin of the backend's makeThumb (functions/api/_lib/validate.js):
// nearest-neighbor stride sampling over the character grid, same stride on both
// axes so aspect is preserved — but applied to EVERY frame so the animation
// survives. The hero wall displays these so a high-resolution figure (hundreds
// of columns → tens of thousands of glyphs in one <pre>) can't force a huge
// text-layer raster as it pans into view; the full figure swaps in on hover
// (desktop) and in the info dialog.

export function downsampleFigure(data, maxCols) {
  const { cols, rows } = data;
  const step = Math.max(1, Math.ceil(cols / maxCols));
  if (step === 1) return data; // already small — same object, no copy
  // Color frames are HTML span runs — stride-sampling would shred the markup.
  // The converter always bakes color:false, so this is a defensive no-op.
  if (data.color) return data;

  const sample = (src) => {
    const lines = src.split("\n");
    const out = [];
    for (let y = 0; y < rows; y += step) {
      const line = lines[y];
      let row = "";
      for (let x = 0; x < cols; x += step) row += line?.[x] ?? " ";
      out.push(row);
    }
    return out.join("\n");
  };

  return {
    ...data,
    cols: Math.ceil(cols / step),
    rows: Math.ceil(rows / step),
    frames: data.frames.map(sample),
    ...(data.edgeFrames ? { edgeFrames: data.edgeFrames.map(sample) } : null),
  };
}
