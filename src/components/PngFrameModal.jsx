import { useState } from 'react';
import { downloadPng } from '../create/exportMedia.js';
import UpModal from './UpModal.jsx';
import AsciiThumb from './AsciiThumb.jsx';
import { FramePicker } from './FramePicker.jsx';

// Frame picker for PNG export of an animation: scrub to the frame you want and
// download it. Stills skip this and export their single frame directly.

export default function PngFrameModal({ baked, onClose, onError }) {
  const [frame, setFrame] = useState(0);
  const [busy, setBusy] = useState(false);

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
    <UpModal title="save png" onClose={onClose} locked={busy}>
      <div className="upmodal-body">
        <FramePicker baked={baked} frame={frame} onChange={setFrame} />

        <AsciiThumb baked={baked} frameIndex={frame} />

        <div className="upmodal-actions">
          <button className="btn" onClick={onClose} disabled={busy}>
            cancel
          </button>
          <button className="btn primary" onClick={save} disabled={busy}>
            {busy ? 'saving…' : '↓ save png'}
          </button>
        </div>
      </div>
    </UpModal>
  );
}
