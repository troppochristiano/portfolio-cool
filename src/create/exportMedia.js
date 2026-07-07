// Client-side exporters for the baked figure.json shape
// `{ cols, rows, fps, color, cellPx, name, frames }`.
//
// PNG and WebM render the ASCII text to a canvas with the same font stack and
// line-height-1 metrics as AsciiPlayer, so the pixels match what the site
// shows. Everything runs in the browser — the backend never does media work.

const FONT_STACK =
  'ui-monospace, "SF Mono", Menlo, Consolas, "DejaVu Sans Mono", monospace';

// Keep canvases well under every browser's limits while staying crisp.
const MAX_CANVAS_W = 3840;
const MAX_CANVAS_H = 3840;

const safeName = (name) =>
  (String(name || 'figure').replace(/[^\w.-]+/g, '_').slice(0, 60)) || 'figure';

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function downloadJson(data, filename) {
  const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
  downloadBlob(blob, filename || `${safeName(data?.name)}.json`);
}

// Size the font so the frame fills a decent export resolution regardless of
// the on-screen cellPx (monospace advance ≈ 0.6 × font size), then set up a
// canvas + measured metrics for it.
function makeCanvas(data, { background, foreground } = {}) {
  const { cols, rows } = data;
  const px = Math.max(
    4,
    Math.min(24, Math.floor(MAX_CANVAS_W / (cols * 0.62)), Math.floor(MAX_CANVAS_H / rows)),
  );
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  ctx.font = `${px}px ${FONT_STACK}`;
  const advance = ctx.measureText('@').width;
  canvas.width = Math.ceil(cols * advance);
  canvas.height = rows * px;
  // Canvas state resets when width/height are assigned — set everything after.
  ctx.font = `${px}px ${FONT_STACK}`;
  ctx.textBaseline = 'top';
  const bg = background ?? '#000';
  const fg = foreground ?? '#fff';
  const drawFrame = (frame) => {
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = fg;
    const lines = frame.split('\n');
    for (let y = 0; y < lines.length; y++) ctx.fillText(lines[y], 0, y * px);
  };
  return { canvas, drawFrame };
}

/** Render one frame (default: the first) to a PNG and download it. */
export function downloadPng(data, { frameIndex = 0, background, foreground } = {}) {
  return new Promise((resolve, reject) => {
    const { canvas, drawFrame } = makeCanvas(data, { background, foreground });
    drawFrame(data.frames[Math.min(frameIndex, data.frames.length - 1)]);
    canvas.toBlob((blob) => {
      if (!blob) return reject(new Error('png_failed'));
      downloadBlob(blob, `${safeName(data.name)}.png`);
      resolve();
    }, 'image/png');
  });
}

/** Best supported WebM mime, or null when MediaRecorder can't do video. */
export function webmMimeType() {
  if (typeof MediaRecorder === 'undefined' || !MediaRecorder.isTypeSupported) return null;
  for (const mime of ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm']) {
    if (MediaRecorder.isTypeSupported(mime)) return mime;
  }
  return null;
}

/**
 * Play every frame once onto a captured canvas stream and download the
 * recording. Resolves when the file has been handed to the browser.
 * `onProgress(0..1)` drives an optional progress readout.
 */
export function downloadWebm(data, { background, foreground, onProgress } = {}) {
  return new Promise((resolve, reject) => {
    const mime = webmMimeType();
    if (!mime) return reject(new Error('webm_unsupported'));
    const fps = Math.min(30, Math.max(1, data.fps || 12));
    const { canvas, drawFrame } = makeCanvas(data, { background, foreground });

    drawFrame(data.frames[0]);
    const stream = canvas.captureStream(fps);
    const recorder = new MediaRecorder(stream, {
      mimeType: mime,
      videoBitsPerSecond: 6_000_000,
    });
    const chunks = [];
    recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    recorder.onerror = () => {
      clearInterval(timer);
      reject(new Error('webm_failed'));
    };
    recorder.onstop = () => {
      downloadBlob(new Blob(chunks, { type: 'video/webm' }), `${safeName(data.name)}.webm`);
      resolve();
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
      drawFrame(data.frames[i]);
      onProgress?.(i / data.frames.length);
    }, 1000 / fps);

    recorder.start();
  });
}
