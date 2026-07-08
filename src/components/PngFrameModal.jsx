import { useEffect, useState } from 'react';
import { resolveStyle } from '../create/styleOptions.js';
import { downloadPng } from '../create/exportMedia.js';

// Frame picker for PNG export of an animation: scrub to the frame you want and
// download it. Mirrors UploadModal's thumbnail scrubber (same classes/metrics)
// so the preview shows exactly what the PNG will. Stills skip this and export
// their single frame directly.

export default function PngFrameModal({ baked, onClose, onError }) {
  const [frame, setFrame] = useState(0);
  const [busy, setBusy] = useState(false);

  // Escape closes (except mid-download).
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape' && !busy) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onClose]);

  // Fit the preview into the modal column (~0.6 advance ratio) and render it
  // with the figure's style block, matching UploadModal.
  const previewFont = Math.max(1.5, Math.min(8, 300 / (baked.cols * 0.6)));
  const st = resolveStyle(baked.style);

  const save = async () => {
    setBusy(true);
    try {
      await downloadPng(baked, { frameIndex: frame });
      onClose();
    } catch {
      onError?.('png export failed');
      setBusy(false);
    }
  };

  return (
    <div
      className="upmodal-backdrop"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <div className="upmodal" role="dialog" aria-modal="true" aria-label="save png">
        <div className="block-label upmodal-title">
          save png
          <button type="button" className="upmodal-close" onClick={onClose} aria-label="close">
            ×
          </button>
        </div>

        <div className="upmodal-body">
          <div className="upmodal-field">
            <span className="field-label">
              frame {frame + 1}/{baked.frames.length}
            </span>
            <input
              type="range"
              min={0}
              max={baked.frames.length - 1}
              value={frame}
              onChange={(e) => setFrame(Number(e.target.value))}
            />
          </div>

          <div className="upmodal-thumb-stack">
            <pre
              className="upmodal-thumb"
              style={{
                fontSize: `${previewFont}px`,
                fontFamily: st.fontFamily,
                letterSpacing: st.letterSpacing ? `${st.letterSpacing}em` : undefined,
                lineHeight: st.lineHeight,
                color: st.color,
                background: st.background,
                gridArea: '1 / 1',
              }}
              aria-hidden="true"
            >
              {baked.frames[frame]}
            </pre>
            {baked.edgeFrames && (
              <pre
                className="upmodal-thumb"
                style={{
                  fontSize: `${previewFont}px`,
                  fontFamily: st.fontFamily,
                  letterSpacing: st.letterSpacing ? `${st.letterSpacing}em` : undefined,
                  lineHeight: st.lineHeight,
                  color: st.edgeColor,
                  background: 'transparent',
                  gridArea: '1 / 1',
                  pointerEvents: 'none',
                }}
                aria-hidden="true"
              >
                {baked.edgeFrames[frame]}
              </pre>
            )}
          </div>

          <div className="upmodal-actions">
            <button className="btn" onClick={onClose} disabled={busy}>
              cancel
            </button>
            <button className="btn primary" onClick={save} disabled={busy}>
              {busy ? 'saving…' : '↓ save png'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
