// Client-side exporters for the baked figure.json shape
// `{ cols, rows, fps, color, cellPx, name, frames }`.
//
// PNG and WebM render the ASCII text to a canvas with the same font stack and
// line-height-1 metrics as AsciiPlayer, so the pixels match what the site
// shows. Everything runs in the browser — the backend never does media work.

import { resolveStyle } from './styleOptions.js';
import { clamp, isCoarsePointer } from '../lib/utils.js';

// Keep canvases well under every browser's limits while staying crisp.
const MAX_CANVAS_W = 3840;
const MAX_CANVAS_H = 3840;

const safeName = (name) =>
  (String(name || 'figure').replace(/[^\w.-]+/g, '_').slice(0, 60)) || 'figure';

/**
 * Hand a finished file to the user.
 *
 * On phones a plain <a download> drops the file into Downloads/Files, where a
 * video is awkward to find and never reaches the photo library — so offer the
 * native share sheet first ("Save to Photos", "Save to Files", or send it
 * straight to an app). navigator.share needs transient user activation, which
 * a long MediaRecorder run outlives; that rejection (and any other) falls
 * through to the download path below.
 */
async function saveBlob(blob, filename) {
  if (isCoarsePointer() && typeof navigator !== 'undefined' && navigator.canShare) {
    const file = new File([blob], filename, { type: blob.type });
    if (navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file] });
        return;
      } catch (err) {
        // Sheet dismissed on purpose — don't then silently download it too.
        if (err?.name === 'AbortError') return;
      }
    }
  }
  // The anchor must be in the document and the object URL must outlive the
  // click for mobile Safari to actually save anything.
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function downloadJson(data, filename) {
  const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
  return saveBlob(blob, filename || `${safeName(data?.name)}.json`);
}

/**
 * The raw ASCII as a .txt — frames are already `rows` lines of exactly `cols`
 * characters, so one frame is paste-ready as-is. Animations export their first
 * frame, same as the PNG button (a 900-frame clip as text is unusable).
 * `edgeFrames` is a color overlay layer, not art, so it's left out.
 */
export function downloadTxt(data, { frameIndex = 0, filename } = {}) {
  const frames = data?.frames || [];
  const i = Math.min(Math.max(0, frameIndex), Math.max(0, frames.length - 1));
  const blob = new Blob([`${frames[i] ?? ''}\n`], { type: 'text/plain;charset=utf-8' });
  return saveBlob(blob, filename || `${safeName(data?.name)}.txt`);
}

// Size the font so the frame fills a decent export resolution regardless of
// the on-screen cellPx (monospace advance ≈ 0.6 × font size), then set up a
// canvas + measured metrics for it. Honors the figure's optional `style`
// block: font stack, letter spacing, line height, background/text colors.
function makeCanvas(data, { background, foreground } = {}) {
  const { cols, rows } = data;
  const st = resolveStyle(data.style);
  const px = clamp(
    Math.min(Math.floor(MAX_CANVAS_W / (cols * 0.62)), Math.floor(MAX_CANVAS_H / rows)),
    4,
    24,
  );
  const rowStep = px * st.lineHeight;
  const spacingPx = st.letterSpacing * px;
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  ctx.font = `${px}px ${st.fontFamily}`;
  const advance = ctx.measureText('@').width + spacingPx;
  canvas.width = Math.ceil(cols * advance);
  canvas.height = Math.ceil(rows * rowStep);
  // Canvas state resets when width/height are assigned — set everything after.
  ctx.font = `${px}px ${st.fontFamily}`;
  ctx.textBaseline = 'top';
  const bg = background ?? st.background;
  const fg = foreground ?? st.color;
  const edgeFg = st.edgeColor;
  // Vertically center each glyph row inside its (possibly taller) line box,
  // matching CSS line-height behavior.
  const yPad = (rowStep - px) / 2;
  // Paint one text layer with the current fillStyle (blanks are spaces, so
  // stacking an edge layer over the base reproduces the on-screen two-layer look).
  const paintLayer = (text) => {
    const lines = text.split('\n');
    for (let y = 0; y < lines.length; y++) {
      const top = y * rowStep + yPad;
      if (spacingPx > 0) {
        // Canvas has no reliable cross-browser letter-spacing — draw per
        // character on the computed advance (export-only cost).
        const line = lines[y];
        for (let x = 0; x < line.length; x++) ctx.fillText(line[x], x * advance, top);
      } else {
        ctx.fillText(lines[y], 0, top);
      }
    }
  };
  const drawFrame = (frame, edgeFrame) => {
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = fg;
    paintLayer(frame);
    if (edgeFrame) {
      ctx.fillStyle = edgeFg;
      paintLayer(edgeFrame);
    }
  };
  return { canvas, drawFrame };
}

/** Render one frame (default: the first) to a PNG and download it. */
export function downloadPng(data, { frameIndex = 0, background, foreground } = {}) {
  return new Promise((resolve, reject) => {
    const { canvas, drawFrame } = makeCanvas(data, { background, foreground });
    const i = Math.min(frameIndex, data.frames.length - 1);
    drawFrame(data.frames[i], data.edgeFrames?.[i]);
    canvas.toBlob((blob) => {
      if (!blob) return reject(new Error('png_failed'));
      saveBlob(blob, `${safeName(data.name)}.png`).then(resolve, reject);
    }, 'image/png');
  });
}

// MP4 first, then WebM. Not just for iOS (whose MediaRecorder does mp4 and
// nothing else, so webm-only probing left it with no video button at all) —
// a desktop-recorded webm doesn't play once it's airdropped to a phone
// either, and h264 mp4 plays everywhere.
const VIDEO_CANDIDATES = [
  ['video/mp4;codecs=avc1.42E01E', 'mp4'],
  ['video/mp4', 'mp4'],
  ['video/webm;codecs=vp9', 'webm'],
  ['video/webm;codecs=vp8', 'webm'],
  ['video/webm', 'webm'],
];

/** Best supported video `{ mime, ext }`, or null when MediaRecorder can't. */
export function pickVideoMime() {
  if (typeof MediaRecorder === 'undefined' || !MediaRecorder.isTypeSupported) return null;
  for (const [mime, ext] of VIDEO_CANDIDATES) {
    if (MediaRecorder.isTypeSupported(mime)) return { mime, ext };
  }
  return null;
}

/**
 * Play every frame once onto a captured canvas stream and download the
 * recording. Resolves when the file has been handed to the browser.
 * `onProgress(0..1)` drives an optional progress readout.
 */
export function downloadVideo(data, { background, foreground, onProgress } = {}) {
  return new Promise((resolve, reject) => {
    const picked = pickVideoMime();
    if (!picked) return reject(new Error('video_unsupported'));
    const { mime, ext } = picked;
    const fps = clamp(data.fps || 12, 1, 30);
    const { canvas, drawFrame } = makeCanvas(data, { background, foreground });

    drawFrame(data.frames[0], data.edgeFrames?.[0]);
    const stream = canvas.captureStream(fps);
    const recorder = new MediaRecorder(stream, {
      mimeType: mime,
      videoBitsPerSecond: 6_000_000,
    });
    const chunks = [];
    recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    recorder.onerror = () => {
      clearInterval(timer);
      reject(new Error('video_failed'));
    };
    recorder.onstop = () => {
      // Label the blob with what was actually negotiated — hardcoding webm
      // here mislabels the file the moment mp4 wins the probe.
      const type = mime.split(';')[0];
      saveBlob(new Blob(chunks, { type }), `${safeName(data.name)}.${ext}`).then(resolve, reject);
    };

    let i = 0;
    const timer = setInterval(() => {
      i += 1;
      if (i >= data.frames.length) {
        clearInterval(timer);
        // A short tail so the recorder captures the last frame before stop.
        setTimeout(() => recorder.stop(), 250);
        return;
      }
      drawFrame(data.frames[i], data.edgeFrames?.[i]);
      onProgress?.(i / data.frames.length);
    }, 1000 / fps);

    recorder.start();
  });
}
