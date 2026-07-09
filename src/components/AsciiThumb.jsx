import { resolveStyle } from "../create/styleOptions.js";
import { MONO_ADVANCE } from "../lib/utils.js";

/**
 * Static thumbnail of one baked frame (plus the optional tinted edge layer),
 * rendered with the figure's style block so it shows exactly what the gallery
 * will. Sized to fit the ~300px modal column via the monospace advance ratio.
 */
export default function AsciiThumb({ baked, frameIndex }) {
  const previewFont = Math.max(
    1.5,
    Math.min(8, 300 / (baked.cols * MONO_ADVANCE)),
  );
  const st = resolveStyle(baked.style);
  const layer = {
    fontSize: `${previewFont}px`,
    fontFamily: st.fontFamily,
    letterSpacing: st.letterSpacing ? `${st.letterSpacing}em` : undefined,
    lineHeight: st.lineHeight,
    gridArea: "1 / 1",
  };
  return (
    <div className="upmodal-thumb-stack">
      <pre
        className="upmodal-thumb"
        style={{ ...layer, color: st.color, background: st.background }}
        aria-hidden="true"
      >
        {baked.frames[frameIndex]}
      </pre>
      {baked.edgeFrames && (
        <pre
          className="upmodal-thumb"
          style={{
            ...layer,
            color: st.edgeColor,
            background: "transparent",
            pointerEvents: "none",
          }}
          aria-hidden="true"
        >
          {baked.edgeFrames[frameIndex]}
        </pre>
      )}
    </div>
  );
}
