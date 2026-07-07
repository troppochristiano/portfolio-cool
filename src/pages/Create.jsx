import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  SUPERSAMPLE,
  computeRows,
  convertFrame,
  hexToRgb,
  gzipSize,
  formatBytes,
} from '../create/asciify.js';
import './Create.css';

const RAMP_PRESETS = {
  classic: ' .:-=+*#%@',
  // 70-level ramp (Paul Bourke), empty→dense — far finer tonal gradation
  detailed: ' .\'`^",:;Il!i><~+_-?][}{1)(|\\/tfjrxnuvczXYUJCLQ0OZmwqpdbkhao*#MW&8%B@$',
  blocks: ' ░▒▓█',
  minimal: ' .oO@',
  dots: ' ·•●',
};

// Quality presets → column counts. Columns are the real control, but the
// preset names + the pixel readout keep the units human.
const QUALITY_PRESETS = { low: 60, medium: 110, high: 180, ultra: 280 };

// Backing resolution of the blank "paper" before a photo is loaded, and the
// cap applied to uploaded photos (largest dimension) so sampling stays cheap.
const PAPER_W = 1024;
const PAPER_H = 768;
const MAX_PHOTO = 1280;

// Brush shades, white → black. ASCII maps brightness, so the swatch you pick
// is literally the glyph density you'll get (under the default invert).
const BRUSH_SHADES = ['#ffffff', '#d9d9d9', '#ababab', '#7f7f7f', '#555555', '#2b2b2b', '#000000'];

const fmtTime = (s) => {
  if (!isFinite(s) || s < 0) s = 0;
  return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
};

export default function Create() {
  const videoRef = useRef(null);
  const photoCanvasRef = useRef(null);   // offscreen: the uploaded photo (or white paper); cut erases here
  const strokeCanvasRef = useRef(null);  // offscreen: brush strokes; eraser erases here only
  const compositeRef = useRef(null);     // displayed <canvas> = photo + strokes; also the sample source
  const canvasRef = useRef(null);        // offscreen sampler
  const previewRef = useRef(null);       // <pre> the live ASCII is written to
  const miniPreviewRef = useRef(null);   // <pre> in the floating mobile mini-monitor
  const miniElRef = useRef(null);        // the floating mini container (for drag)
  const miniPosRef = useRef(null);       // dragged position {left, top} or null (default corner)
  const miniDragRef = useRef(null);      // in-flight drag state
  const draggedRef = useRef(false);      // did the last pointer sequence move (drag vs tap)
  const monitorRef = useRef(null);       // the main monitor (observed for the mini's visibility)
  const pageRef = useRef(null);          // the .create-page scroll container (IntersectionObserver root)
  const screenRef = useRef(null);        // monitor interior the <pre> must fit inside
  const mediaBoxRef = useRef(null);      // wrapper that shrink-wraps the visible media (crop/eyedropper coords)
  const settingsRef = useRef(null);      // latest settings for the rAF loop
  const photoImgRef = useRef(null);      // decoded photo, kept so "restore photo" can undo cuts

  // 'video' | 'image' — which input feeds the converter. The image source is
  // one canvas the user can both load a photo into and draw on.
  const [sourceType, setSourceType] = useState('video');
  const [hasVideo, setHasVideo] = useState(false);
  const [hasPhoto, setHasPhoto] = useState(false);
  const [dims, setDims] = useState({ w: 0, h: 0 });
  const [duration, setDuration] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [loop, setLoop] = useState(true);
  const [dragOver, setDragOver] = useState(false);
  const [videoName, setVideoName] = useState('');
  const [imageName, setImageName] = useState('');
  const [error, setError] = useState('');

  // image tools: draw (ink), fill (bucket), erase (ink only), cut (photo → transparent)
  const [tool, setTool] = useState('draw');
  const [brush, setBrush] = useState(14);
  const [fillTolerance, setFillTolerance] = useState(0.15);
  const [drawOnPhoto, setDrawOnPhoto] = useState(true); // photo loaded: overlay drawing vs convert photo only
  const [drawFullscreen, setDrawFullscreen] = useState(false); // maximize the canvas for drawing
  const [brushShade, setBrushShade] = useState('#000000');
  const drawingRef = useRef(false);
  const lastPtRef = useRef(null);

  // source stage: display size + crop of the conversion region
  const [sourceScale, setSourceScale] = useState('m'); // 's' | 'm' | 'l'
  const [crop, setCrop] = useState(null);              // {x,y,w,h} normalized, or null
  const [cropMode, setCropMode] = useState(false);     // marquee armed
  const [cropDraft, setCropDraft] = useState(null);    // rect while dragging
  const cropStartRef = useRef(null);
  const [picking, setPicking] = useState(false);       // eyedropper armed

  // settings
  const [cols, setCols] = useState(110);
  // resolution: 'auto' locks rows to the source aspect; 'custom' sets rows freely
  // (the frame stretches to the forced grid). customRows is the explicit height.
  const [resMode, setResMode] = useState('auto');
  const [customRows, setCustomRows] = useState(60);
  const [cellPx, setCellPx] = useState(11);
  const [fps, setFps] = useState(15);
  const [gamma, setGamma] = useState(1);
  const [invert, setInvert] = useState(true);
  const [cellAspect, setCellAspect] = useState(2);
  const [rampKey, setRampKey] = useState('classic');
  const [blockAvg, setBlockAvg] = useState(false);
  const [dither, setDither] = useState('off');     // 'off' | 'floyd' | 'bayer'
  // background key: drop a green / black / white / custom-color background to
  // transparent. threshold 0..1, higher removes more. keyColor is the hex used
  // by 'custom' mode (RGB-distance keyed).
  const [keyMode, setKeyMode] = useState('off');
  const [keyThreshold, setKeyThreshold] = useState(0.4);
  const [keyColor, setKeyColor] = useState('#3cba54');

  // which settings categories are expanded
  const [openBlocks, setOpenBlocks] = useState({
    resolution: true,
    playback: true,
    characters: true,
    effects: false,
  });
  const toggleBlock = (id) => setOpenBlocks((o) => ({ ...o, [id]: !o[id] }));

  // bake / export
  const [baking, setBaking] = useState(false);
  const [bakeProgress, setBakeProgress] = useState(0);
  const [baked, setBaked] = useState(null); // { cols, rows, fps, frames, … }
  const [sizes, setSizes] = useState({ raw: null, gz: null });
  const [mode, setMode] = useState('live'); // 'live' | 'baked'
  const [previewScale, setPreviewScale] = useState(1); // fit the frame into the monitor
  const [outputPx, setOutputPx] = useState(null);      // measured size of the rendered <pre>
  const [miniVisible, setMiniVisible] = useState(false); // mobile floating preview shown when the monitor scrolls off
  const [miniDismissed, setMiniDismissed] = useState(false); // user closed it (re-armed when the monitor scrolls back into view)

  const ramp = RAMP_PRESETS[rampKey] || RAMP_PRESETS.classic;
  // Photos/drawings are single stills — one frame, no transport.
  const isStill = sourceType !== 'video';
  // The crop changes what's converted, so the aspect the rows derive from
  // must be the cropped region's, not the full source's.
  const effW = crop ? dims.w * crop.w : dims.w;
  const effH = crop ? dims.h * crop.h : dims.h;
  const rows = resMode === 'custom'
    ? Math.max(1, customRows)
    : computeRows(effW, effH, cols, cellAspect);
  const frameEstimate = Math.max(0, Math.round(duration * fps));

  // The image source is always renderable — a blank white canvas is a valid still.
  const hasSource = sourceType === 'video' ? hasVideo : true;
  const fileName = sourceType === 'video' ? videoName : imageName;

  const activeSource = () =>
    sourceType === 'image' ? compositeRef.current : videoRef.current;
  const sourceReady = (el) => {
    if (!el) return false;
    if (sourceType === 'video') return el.readyState >= 2;
    return true; // the composite canvas is always ready
  };

  // keep the rAF loop reading current settings without re-subscribing
  useEffect(() => {
    settingsRef.current = { cols, rows, ramp, invert, gamma, blockAvg, dither, keyMode, keyThreshold, keyColor, crop };
  }, [cols, rows, ramp, invert, gamma, blockAvg, dither, keyMode, keyThreshold, keyColor, crop]);

  // ── image layers ──────────────────────────────────────────────
  // photo (bottom, opaque unless cut) + strokes (top) → composite. The
  // composite canvas is what's shown AND what the sampler reads, so the rest
  // of the pipeline never needs to know about layers.
  // Strokes are composited unless "draw on photo" is off (photo-only output).
  // Read through a ref so compositeLayers stays a stable, dependency-free callback.
  const includeStrokesRef = useRef(true);
  const compositeLayers = useCallback(() => {
    const comp = compositeRef.current;
    const photo = photoCanvasRef.current;
    const stroke = strokeCanvasRef.current;
    if (!comp || !photo || !stroke) return;
    const ctx = comp.getContext('2d');
    ctx.clearRect(0, 0, comp.width, comp.height);
    ctx.drawImage(photo, 0, 0);
    if (includeStrokesRef.current) ctx.drawImage(stroke, 0, 0);
  }, []);

  const resizeLayers = useCallback((w, h, drawPhoto) => {
    const comp = compositeRef.current;
    const photo = photoCanvasRef.current;
    const stroke = strokeCanvasRef.current;
    if (!comp || !photo || !stroke) return;
    comp.width = w; comp.height = h;       // resizing clears all three
    photo.width = w; photo.height = h;
    stroke.width = w; stroke.height = h;
    const pctx = photo.getContext('2d');
    if (drawPhoto) {
      pctx.drawImage(drawPhoto, 0, 0, w, h);
    } else {
      pctx.fillStyle = '#fff';
      pctx.fillRect(0, 0, w, h);
    }
    compositeLayers();
  }, [compositeLayers]);

  // init: create the offscreen layers and lay down white paper
  useEffect(() => {
    photoCanvasRef.current = document.createElement('canvas');
    strokeCanvasRef.current = document.createElement('canvas');
    resizeLayers(PAPER_W, PAPER_H, null);
  }, [resizeLayers]);

  // "draw on photo" only applies with a photo loaded; blank paper always draws.
  // Recompose whenever the effective setting changes so live/bake pick it up.
  useEffect(() => {
    includeStrokesRef.current = drawOnPhoto || !hasPhoto;
    compositeLayers();
  }, [drawOnPhoto, hasPhoto, compositeLayers]);

  // Fullscreen draw only makes sense while drawing is available; drop it and
  // support Escape to exit.
  useEffect(() => {
    const enabled = sourceType === 'image' && (!hasPhoto || drawOnPhoto);
    if (!enabled) setDrawFullscreen(false);
  }, [sourceType, hasPhoto, drawOnPhoto]);
  useEffect(() => {
    if (!drawFullscreen) return;
    const onKey = (e) => { if (e.key === 'Escape') setDrawFullscreen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [drawFullscreen]);
  // Scale the canvas up to fill the fullscreen area (preserving aspect and keeping
  // the element box == the drawn bitmap, so pointer mapping stays exact). CSS can't
  // aspect-fit-upscale a <canvas> without object-fit, which would break coords.
  useEffect(() => {
    const canvas = compositeRef.current;
    if (!canvas) return;
    if (!drawFullscreen) { canvas.style.width = ''; canvas.style.height = ''; return; }
    const fit = () => {
      const bar = document.querySelector('.fs-drawbar');
      const availW = window.innerWidth - 20;
      const availH = window.innerHeight - 20 - (bar ? bar.offsetHeight : 84);
      if (availW <= 0 || availH <= 0) return;
      const scale = Math.min(availW / canvas.width, availH / canvas.height);
      canvas.style.width = `${Math.round(canvas.width * scale)}px`;
      canvas.style.height = `${Math.round(canvas.height * scale)}px`;
    };
    fit();
    window.addEventListener('resize', fit);
    return () => {
      window.removeEventListener('resize', fit);
      canvas.style.width = ''; canvas.style.height = '';
    };
  }, [drawFullscreen, hasPhoto]);

  // ── switch source type ────────────────────────────────────────
  const switchSource = (type) => {
    setSourceType(type);
    setBaked(null);
    setMode('live');
    setError('');
    setCrop(null);
    setCropMode(false);
    setCropDraft(null);
    setPicking(false);
    // Point the rows calc at the new source's dimensions.
    if (type === 'image') {
      const c = compositeRef.current;
      setDims(c ? { w: c.width, h: c.height } : { w: PAPER_W, h: PAPER_H });
    } else {
      const v = videoRef.current;
      setDims(v && v.videoWidth ? { w: v.videoWidth, h: v.videoHeight } : { w: 0, h: 0 });
    }
  };

  // ── load a video file ─────────────────────────────────────────
  const loadFile = useCallback((file) => {
    if (!file) return;
    if (!file.type.startsWith('video/')) {
      setError(`"${file.name}" isn't a video — try mp4, mov, or webm`);
      return;
    }
    setError('');
    const url = URL.createObjectURL(file);
    setVideoName(file.name);
    setBaked(null);
    setMode('live');
    setBakeProgress(0);
    setCrop(null);
    const v = videoRef.current;
    v.src = url;
    v.load();
  }, []);

  const onDrop = useCallback((e) => {
    e.preventDefault();
    setDragOver(false);
    loadFile(e.dataTransfer.files?.[0]);
  }, [loadFile]);

  // ── load a photo into the image layers ────────────────────────
  const loadImage = useCallback((file) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setError(`"${file.name}" isn't an image — try jpg, png, or webp`);
      return;
    }
    setError('');
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, MAX_PHOTO / Math.max(img.naturalWidth, img.naturalHeight));
      const w = Math.max(1, Math.round(img.naturalWidth * scale));
      const h = Math.max(1, Math.round(img.naturalHeight * scale));
      photoImgRef.current = img;
      // resizing the layers clears the strokes — coordinates wouldn't survive
      // the aspect change anyway (hinted in the UI)
      resizeLayers(w, h, img);
      setHasPhoto(true);
      setImageName(file.name);
      setDims({ w, h });
      setCrop(null);
      setBaked(null);
      setMode('live');
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      setError('couldn’t read that image — try another file');
    };
    img.src = url;
  }, [resizeLayers]);

  const onDropImage = useCallback((e) => {
    e.preventDefault();
    setDragOver(false);
    loadImage(e.dataTransfer.files?.[0]);
  }, [loadImage]);

  // ── video metadata ────────────────────────────────────────────
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const onMeta = () => {
      setHasVideo(true);
      setError('');
      if (sourceTypeRef.current === 'video') setDims({ w: v.videoWidth, h: v.videoHeight });
      setDuration(v.duration || 0);
    };
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onTime = () => setCurrentTime(v.currentTime);
    const onErr = () => {
      if (!v.src) return; // ignore the empty-source state before a clip is picked
      setError('couldn’t read that clip — it may be corrupt or use an unsupported codec');
    };
    v.addEventListener('loadedmetadata', onMeta);
    v.addEventListener('play', onPlay);
    v.addEventListener('pause', onPause);
    v.addEventListener('timeupdate', onTime);
    v.addEventListener('error', onErr);
    return () => {
      v.removeEventListener('loadedmetadata', onMeta);
      v.removeEventListener('play', onPlay);
      v.removeEventListener('pause', onPause);
      v.removeEventListener('timeupdate', onTime);
      v.removeEventListener('error', onErr);
    };
  }, []);

  // The metadata listeners bind once but need the current source type to
  // decide whether to adopt the new dimensions — read it through a ref so they
  // don't have to re-subscribe on every switch.
  const sourceTypeRef = useRef(sourceType);
  useEffect(() => { sourceTypeRef.current = sourceType; }, [sourceType]);

  // ── live preview rAF loop (no React state per frame) ──────────
  useEffect(() => {
    if (!hasSource || mode !== 'live') return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    let raf = 0;

    const render = () => {
      const s = settingsRef.current;
      const src = activeSource();
      if (s && src && sourceReady(src) && s.rows > 0 && previewRef.current) {
        const frame = sampleFrame(ctx, canvas, src, s);
        previewRef.current.textContent = frame;
        if (miniPreviewRef.current) miniPreviewRef.current.textContent = frame;
      }
      raf = requestAnimationFrame(render);
    };
    raf = requestAnimationFrame(render);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasSource, sourceType, mode]);

  // ── baked playback loop ───────────────────────────────────────
  useEffect(() => {
    if (mode !== 'baked' || !baked) return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const el = previewRef.current;
    const write = (frame) => {
      el.textContent = frame;
      if (miniPreviewRef.current) miniPreviewRef.current.textContent = frame;
    };
    write(baked.frames[0]);
    if (reduce || baked.frames.length <= 1) return;
    let raf = 0, i = 0, last = performance.now();
    const interval = 1000 / baked.fps;
    const tick = (now) => {
      if (now - last >= interval) {
        last = now;
        i = (i + 1) % baked.frames.length;
        write(baked.frames[i]);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [mode, baked]);

  // ── fit the frame into the monitor ────────────────────────────
  // The <pre> renders at cols × pixel-size, which easily exceeds the
  // monitor at higher grids. Scale it down so the whole frame is always
  // visible (never clipped, never upscaled past the chosen pixel size).
  // offsetWidth/Height ignore the applied transform, so measuring stays
  // stable and the ResizeObserver can't feed back into itself. The same
  // measurement is the "real pixels" readout in the resolution block.
  useEffect(() => {
    const screen = screenRef.current;
    const pre = previewRef.current;
    if (!screen || !pre) return;
    const fit = () => {
      const pad = 16; // breathing room inside the screen bezel
      const availW = screen.clientWidth - pad;
      const availH = screen.clientHeight - pad;
      const natW = pre.offsetWidth;
      const natH = pre.offsetHeight;
      if (natW <= 0 || natH <= 0 || availW <= 0 || availH <= 0) return;
      const next = Math.min(1, availW / natW, availH / natH);
      setPreviewScale((prev) => (Math.abs(prev - next) > 0.004 ? next : prev));
      setOutputPx((prev) =>
        prev && Math.abs(prev.w - natW) < 1 && Math.abs(prev.h - natH) < 1
          ? prev
          : { w: Math.round(natW), h: Math.round(natH) });
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(screen);
    ro.observe(pre);
    return () => ro.disconnect();
  }, [hasSource, sourceType, mode, cols, rows, cellPx, baked]);

  // ── mobile: reveal the floating mini-monitor once the main one scrolls off ──
  // A scroll-position check (not IntersectionObserver, which misses fast/edge
  // transitions). The monitor is compared to the VIEWPORT — correct whether the
  // page scrolls inside .create-page or the document body scrolls. Listeners are
  // attached to the scroll container itself, window (capture, for either model),
  // and visualViewport (mobile address-bar show/hide), so it fires on real
  // devices regardless of which element owns the scroll.
  useEffect(() => {
    const page = pageRef.current;
    const mon = monitorRef.current;
    if (!mon || !hasSource) { setMiniVisible(false); return; }
    const check = () => {
      const mr = mon.getBoundingClientRect();
      const vh = window.innerHeight || document.documentElement.clientHeight;
      const off = mr.bottom <= 4 || mr.top >= vh - 4; // monitor fully above / below the screen
      setMiniVisible((prev) => (prev === off ? prev : off));   // no re-render unless it changed
      if (!off) setMiniDismissed((d) => (d ? false : d));      // re-arm when the monitor is back
    };
    check();
    page?.addEventListener('scroll', check, { passive: true });
    window.addEventListener('scroll', check, true);
    window.addEventListener('resize', check);
    const vv = window.visualViewport;
    vv?.addEventListener('scroll', check);
    vv?.addEventListener('resize', check);
    return () => {
      page?.removeEventListener('scroll', check);
      window.removeEventListener('scroll', check, true);
      window.removeEventListener('resize', check);
      vv?.removeEventListener('scroll', check);
      vv?.removeEventListener('resize', check);
    };
  }, [hasSource]);

  // ── transport (video only) ────────────────────────────────────
  const togglePlay = () => {
    const v = videoRef.current;
    if (v.paused) v.play(); else v.pause();
  };
  const onScrub = (e) => {
    const v = videoRef.current;
    v.currentTime = Number(e.target.value);
  };
  const stepFrame = (dir) => {
    const v = videoRef.current;
    if (!v || !duration) return;
    v.pause();
    const t = v.currentTime + dir / fps;
    v.currentTime = Math.min(Math.max(0, t), Math.max(0, duration - 1e-3));
  };

  // ── drawing (on the composite canvas, into the layers) ────────
  const drawPos = (e) => {
    const c = compositeRef.current;
    const rect = c.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) * (c.width / rect.width),
      y: (e.clientY - rect.top) * (c.height / rect.height),
    };
  };
  const strokeTo = (pt) => {
    // draw/erase live on the stroke layer; cut punches through the photo layer
    const target = tool === 'cut' ? photoCanvasRef.current : strokeCanvasRef.current;
    const ctx = target.getContext('2d');
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = brush;
    if (tool === 'draw') {
      ctx.globalCompositeOperation = 'source-over';
      ctx.strokeStyle = brushShade;
      ctx.fillStyle = brushShade;
    } else {
      // erase and cut both remove pixels from their layer → transparent
      ctx.globalCompositeOperation = 'destination-out';
      ctx.strokeStyle = '#000';
      ctx.fillStyle = '#000';
    }
    const last = lastPtRef.current;
    if (last) {
      ctx.beginPath();
      ctx.moveTo(last.x, last.y);
      ctx.lineTo(pt.x, pt.y);
      ctx.stroke();
    } else {
      // first touch → a dot so a tap leaves a mark
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, brush / 2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';
    lastPtRef.current = pt;
    compositeLayers();
  };
  // Bucket fill: from the clicked pixel, flood the connected region of similar
  // color in the COMPOSITE (what you see) and paint the current shade onto the
  // STROKE layer only — so the photo underneath is preserved and existing
  // strokes outside the region survive. tolerance 0..1 = how far it spreads.
  const floodFill = (pt) => {
    const comp = compositeRef.current;
    const stroke = strokeCanvasRef.current;
    const w = comp.width, h = comp.height;
    const sx = Math.floor(pt.x), sy = Math.floor(pt.y);
    if (sx < 0 || sy < 0 || sx >= w || sy >= h) return;
    const rgb = hexToRgb(brushShade) || [0, 0, 0];
    const cctx = comp.getContext('2d');
    const src = cctx.getImageData(0, 0, w, h).data;
    const sctx = stroke.getContext('2d');
    const dstImg = sctx.getImageData(0, 0, w, h);
    const dst = dstImg.data;

    const seed = (sy * w + sx) * 4;
    const sr = src[seed], sg = src[seed + 1], sb = src[seed + 2], sa = src[seed + 3];
    // 4-channel Euclidean distance, normalized to 0..1 (max = sqrt(4)*255).
    const maxDist = 510; // sqrt(4) * 255
    const tol = fillTolerance * maxDist;
    const tol2 = tol * tol;
    const matches = (p) => {
      const dr = src[p] - sr, dg = src[p + 1] - sg, db = src[p + 2] - sb, da = src[p + 3] - sa;
      return dr * dr + dg * dg + db * db + da * da <= tol2;
    };

    const seen = new Uint8Array(w * h);
    const stack = [sx, sy];
    seen[sy * w + sx] = 1;
    while (stack.length) {
      const y = stack.pop();
      const x = stack.pop();
      const p = (y * w + x) * 4;
      // paint the shade opaque onto the stroke layer
      dst[p] = rgb[0]; dst[p + 1] = rgb[1]; dst[p + 2] = rgb[2]; dst[p + 3] = 255;
      const push = (nx, ny) => {
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) return;
        const idx = ny * w + nx;
        if (seen[idx]) return;
        if (!matches(idx * 4)) return;
        seen[idx] = 1;
        stack.push(nx, ny);
      };
      push(x + 1, y); push(x - 1, y); push(x, y + 1); push(x, y - 1);
    }
    sctx.putImageData(dstImg, 0, 0);
    compositeLayers();
  };

  const onDrawDown = (e) => {
    if (picking || cropMode) return; // the overlay owns the pointer then
    if (hasPhoto && !drawOnPhoto) return; // drawing disabled (converting the photo only)
    e.preventDefault();
    if (tool === 'fill') { floodFill(drawPos(e)); return; } // click action, no drag
    // capture keeps the stroke tracking outside the canvas; a pointer that
    // vanished between events must not kill the stroke, so failure is fine
    try { compositeRef.current.setPointerCapture(e.pointerId); } catch { /* stroke still draws */ }
    drawingRef.current = true;
    lastPtRef.current = null;
    strokeTo(drawPos(e));
  };
  const onDrawMove = (e) => {
    if (!drawingRef.current) return;
    e.preventDefault();
    strokeTo(drawPos(e));
  };
  const onDrawUp = () => {
    drawingRef.current = false;
    lastPtRef.current = null;
  };
  // A ring cursor the size of the brush footprint on screen (brush is in backing
  // px; the canvas is displayed scaled, so multiply by the display/backing ratio).
  const brushCursorRef = useRef(null);
  const moveBrushCursor = (e) => {
    const el = brushCursorRef.current;
    const canvas = compositeRef.current;
    if (!el || !canvas) return;
    const rect = canvas.getBoundingClientRect();
    const d = brush * (rect.width / (canvas.width || 1));
    el.style.width = `${d}px`;
    el.style.height = `${d}px`;
    el.style.left = `${e.clientX}px`;
    el.style.top = `${e.clientY}px`;
    el.style.display = 'block';
  };
  const hideBrushCursor = () => { if (brushCursorRef.current) brushCursorRef.current.style.display = 'none'; };
  const onCanvasMove = (e) => { moveBrushCursor(e); onDrawMove(e); };
  const onCanvasLeave = (e) => { hideBrushCursor(); onDrawUp(e); };
  const clearInk = () => {
    const s = strokeCanvasRef.current;
    s.getContext('2d').clearRect(0, 0, s.width, s.height);
    compositeLayers();
  };
  // Redraw the photo layer from the kept decoded image — undoes every cut.
  const restorePhoto = () => {
    const photo = photoCanvasRef.current;
    const img = photoImgRef.current;
    const pctx = photo.getContext('2d');
    pctx.clearRect(0, 0, photo.width, photo.height);
    if (img) {
      pctx.drawImage(img, 0, 0, photo.width, photo.height);
    } else {
      pctx.fillStyle = '#fff';
      pctx.fillRect(0, 0, photo.width, photo.height);
    }
    compositeLayers();
  };

  // ── crop marquee + eyedropper (shared stage overlay) ──────────
  const overlayPos = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const clamp01 = (v) => Math.min(1, Math.max(0, v));
    return {
      x: clamp01((e.clientX - rect.left) / rect.width),
      y: clamp01((e.clientY - rect.top) / rect.height),
    };
  };
  const draftRect = (a, b) => ({
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    w: Math.abs(a.x - b.x),
    h: Math.abs(a.y - b.y),
  });
  const sampleColorAt = (pos) => {
    let d = null;
    if (sourceType === 'image') {
      const c = compositeRef.current;
      d = c.getContext('2d').getImageData(
        Math.min(c.width - 1, Math.floor(pos.x * c.width)),
        Math.min(c.height - 1, Math.floor(pos.y * c.height)), 1, 1).data;
    } else {
      const v = videoRef.current;
      if (!v || v.readyState < 2) return;
      const t = document.createElement('canvas');
      t.width = 1; t.height = 1;
      const tctx = t.getContext('2d', { willReadFrequently: true });
      tctx.drawImage(v,
        Math.min(v.videoWidth - 1, Math.floor(pos.x * v.videoWidth)),
        Math.min(v.videoHeight - 1, Math.floor(pos.y * v.videoHeight)), 1, 1, 0, 0, 1, 1);
      d = tctx.getImageData(0, 0, 1, 1).data;
    }
    if (!d) return;
    const hex = '#' + [d[0], d[1], d[2]].map((v) => v.toString(16).padStart(2, '0')).join('');
    setKeyColor(hex);
    setKeyMode('custom');
    setPicking(false);
  };
  const onOverlayDown = (e) => {
    e.preventDefault();
    const pos = overlayPos(e);
    if (picking) {
      sampleColorAt(pos);
      return;
    }
    if (!cropMode) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    cropStartRef.current = pos;
    setCropDraft({ ...pos, w: 0, h: 0 });
  };
  const onOverlayMove = (e) => {
    if (!cropMode || !cropStartRef.current) return;
    e.preventDefault();
    setCropDraft(draftRect(cropStartRef.current, overlayPos(e)));
  };
  const onOverlayUp = (e) => {
    if (!cropMode || !cropStartRef.current) return;
    const rect = draftRect(cropStartRef.current, overlayPos(e));
    cropStartRef.current = null;
    setCropDraft(null);
    setCropMode(false);
    // ignore accidental clicks — a crop needs real area
    if (rect.w > 0.02 && rect.h > 0.02) {
      setCrop(rect);
      setBaked(null);
      setMode('live');
    }
  };

  // ── bake ──────────────────────────────────────────────────────
  const seekTo = (v, t) =>
    new Promise((res) => {
      const onSeeked = () => { v.removeEventListener('seeked', onSeeked); res(); };
      v.addEventListener('seeked', onSeeked);
      v.currentTime = Math.min(t, Math.max(0, v.duration - 1e-3));
    });

  // cellPx (the tuned display size) rides along so a player can size the figure
  // exactly as previewed here. name/createdAt identify the figure once it's
  // uploaded to the backend; players ignore keys they don't know.
  const finishBake = async (frames) => {
    const name = fileName
      ? fileName.replace(/\.[^.]+$/, '')
      : isStill ? 'drawing' : 'untitled';
    const result = {
      cols, rows, fps, color: false, cellPx,
      name, createdAt: new Date().toISOString(),
      frames,
    };
    setBaked(result);
    setMode('baked');
    setBaking(false);
    const json = JSON.stringify(result);
    const raw = new Blob([json]).size;
    const gz = await gzipSize(json);
    setSizes({ raw, gz });
  };

  const bake = async () => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const settings = { cols, rows, ramp, invert, gamma, blockAvg, dither, keyMode, keyThreshold, keyColor, crop };

    // Photos and drawings are a single still — sample once.
    if (isStill) {
      const src = activeSource();
      if (!src || !sourceReady(src) || rows <= 0) return;
      setBaking(true);
      setBakeProgress(100);
      await finishBake([sampleFrame(ctx, canvas, src, settings)]);
      return;
    }

    // Video: seek across the clip, sample each frame.
    const v = videoRef.current;
    if (!v || !duration) return;
    v.pause();
    setBaking(true);
    setMode('live');
    setBakeProgress(0);

    const total = Math.max(1, Math.round(duration * fps));
    const frames = [];
    for (let f = 0; f < total; f++) {
      await seekTo(v, f / fps);
      frames.push(sampleFrame(ctx, canvas, v, settings));
      setBakeProgress(Math.round(((f + 1) / total) * 100));
      // yield so the progress bar can paint
      if (f % 4 === 0) await new Promise((r) => setTimeout(r, 0));
    }
    await finishBake(frames);
  };

  const exportJson = () => {
    if (!baked) return;
    const json = JSON.stringify(baked);
    const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'figure.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  // Each cell renders at exactly cellPx — a direct handle on block size.
  // Lower `cols` (fewer, fatter cells) + a high pixel size = chunky pixels.
  const previewFontSize = `${cellPx}px`;

  // "real pixels" readout: measured when a source renders; estimated before
  // (monospace advance ≈ 0.6 × font size — only the height is exact).
  const readoutW = hasSource && outputPx ? outputPx.w : Math.round(cols * cellPx * 0.6);
  const readoutH = hasSource && outputPx ? outputPx.h : rows * cellPx;

  const hasMedia = sourceType === 'video' ? hasVideo : true;
  // Drawing is on for blank paper always, and for a photo only when "draw on photo" is on.
  const drawEnabled = sourceType === 'image' && (!hasPhoto || drawOnPhoto);
  const overlayActive = hasMedia && (cropMode || picking);

  // Tool modes + shade swatches + size slider — rendered both in the rail and in
  // the fullscreen bar, so it's defined once (closes over the shared state).
  const drawControls = (
    <>
      <div className="draw-tools__row">
        <div className="keymodes toolmodes">
          {[['draw', 'draw'], ['fill', 'fill'], ['erase', 'erase'], ['cut', 'cut']].map(([k, label]) => (
            <button
              key={k}
              className={`keymode ${tool === k ? 'is-active' : ''}`}
              onClick={() => setTool(k)}
              title={
                k === 'cut' ? 'remove a section of the photo — cut areas become transparent'
                  : k === 'fill' ? 'bucket-fill the clicked region with the selected shade'
                  : undefined
              }
            >
              {label}
            </button>
          ))}
        </div>
        <div className="swatches" role="group" aria-label="brush shade">
          {BRUSH_SHADES.map((c) => (
            <button
              key={c}
              className={`swatch ${(tool === 'draw' || tool === 'fill') && brushShade === c ? 'is-active' : ''}`}
              style={{ background: c }}
              // pick a shade for draw/fill; if erase/cut is active, jump to draw
              onClick={() => { setBrushShade(c); if (tool !== 'fill') setTool('draw'); }}
              aria-label={`brush shade ${c}`}
            />
          ))}
        </div>
      </div>
      {tool === 'fill' ? (
        <Slider label="fill tolerance" value={fillTolerance} min={0} max={1} step={0.01}
                onChange={setFillTolerance} fixed={2} suffix=" · higher spreads more" />
      ) : (
        <Slider label="brush" value={brush} min={2} max={80} step={1}
                onChange={setBrush} suffix="px" />
      )}
    </>
  );
  const shownRect = cropDraft || crop;

  // Mini-monitor scale: fit the same cols×rows frame into a small fixed box,
  // reusing the already-measured render size (no extra observer).
  const MINI_W = 140, MINI_H = 108;
  const miniScale = outputPx
    ? Math.min(1, MINI_W / outputPx.w, MINI_H / outputPx.h)
    : 0.12;

  // ── mini-monitor drag (and tap-to-jump) ──────────────────────
  // Position lives in a ref, mutated on the DOM directly during a drag so the
  // per-frame textContent writes and any parent re-render don't fight it; the
  // ref is re-applied to `style` on every render so the position sticks. The
  // jump-to-monitor uses onClick (reliable) guarded by a "did we drag" flag.
  const onMiniDown = (e) => {
    if (e.target.closest('.mini-close')) return; // the close button owns its click
    const el = miniElRef.current;
    const r = el.getBoundingClientRect();
    miniDragRef.current = { sx: e.clientX, sy: e.clientY, baseL: r.left, baseT: r.top };
    draggedRef.current = false;
    try { el.setPointerCapture(e.pointerId); } catch { /* fine */ }
  };
  const onMiniMove = (e) => {
    const d = miniDragRef.current;
    if (!d) return;
    const dx = e.clientX - d.sx, dy = e.clientY - d.sy;
    if (!draggedRef.current && Math.hypot(dx, dy) < 5) return; // ignore jitter → keep tap semantics
    draggedRef.current = true;
    const el = miniElRef.current;
    const left = Math.min(Math.max(6, d.baseL + dx), window.innerWidth - el.offsetWidth - 6);
    const top = Math.min(Math.max(6, d.baseT + dy), window.innerHeight - el.offsetHeight - 6);
    miniPosRef.current = { left, top };
    el.style.left = `${left}px`; el.style.top = `${top}px`;
    el.style.right = 'auto'; el.style.bottom = 'auto';
  };
  const onMiniUp = () => { miniDragRef.current = null; };
  const onMiniClick = () => {
    if (draggedRef.current) { draggedRef.current = false; return; } // it was a drag, not a tap
    monitorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  const miniPosStyle = miniPosRef.current
    ? { left: miniPosRef.current.left, top: miniPosRef.current.top, right: 'auto', bottom: 'auto' }
    : null;

  return (
    <div className="create-page" ref={pageRef}>
      <div className="app">
        <header className="masthead">
          <Link to="/" className="home-link">← Christian Bianchi</Link>
          <h1 className="title">
            ascii<span className="tcursor">▮</span>media converter
          </h1>
          <p className="tagline">
            drop a clip or a photo — or draw one — tune the grid → bake to frames → export json for the web
          </p>
        </header>

        <div className="workbench">
          {/* ── left rail: settings by category ── */}
          <aside className="rail">
            <SettingsBlock label="resolution" open={openBlocks.resolution} onToggle={() => toggleBlock('resolution')}>
              <div className="keymodes">
                {Object.entries(QUALITY_PRESETS).map(([k, v]) => (
                  <button
                    key={k}
                    className={`keymode ${cols === v ? 'is-active' : ''}`}
                    onClick={() => setCols(v)}
                  >
                    {k}
                  </button>
                ))}
              </div>
              <Slider label="fine tune" value={cols} min={30} max={320} step={1}
                      onChange={setCols} suffix=" cols" />
              <div className="keymodes">
                {[['auto', 'auto height'], ['custom', 'custom height']].map(([k, label]) => (
                  <button
                    key={k}
                    className={`keymode ${resMode === k ? 'is-active' : ''}`}
                    onClick={() => {
                      // seed the explicit height from the current aspect-derived rows
                      // so switching to custom doesn't make the picture jump.
                      if (k === 'custom') setCustomRows(rows);
                      setResMode(k);
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {resMode === 'custom' && (
                <Slider label="rows" value={customRows} min={10} max={240} step={1}
                        onChange={setCustomRows} />
              )}
              {/* cell aspect only feeds the auto rows calc — inert under custom */}
              {resMode === 'auto' && (
                <Slider label="cell aspect" value={cellAspect} min={1.4} max={2.6} step={0.1}
                        onChange={setCellAspect} fixed={1} />
              )}
              <Slider label="character size" value={cellPx} min={6} max={48} step={1}
                      onChange={setCellPx} suffix="px" />
              <div className="res-readout">
                {effW > 0
                  ? `output ≈ ${readoutW} × ${readoutH} px · ${cols} × ${rows} characters`
                  : 'load a source to size the output'}
              </div>
            </SettingsBlock>

            {sourceType === 'video' && (
              <SettingsBlock label="playback" open={openBlocks.playback} onToggle={() => toggleBlock('playback')}>
                <Slider label="fps" value={fps} min={5} max={30} step={1} onChange={setFps} />
                <p className="hint">frames sampled per second of video — lower = smaller export</p>
              </SettingsBlock>
            )}

            <SettingsBlock label="characters" open={openBlocks.characters} onToggle={() => toggleBlock('characters')}>
              <div className="ramps">
                {Object.entries(RAMP_PRESETS).map(([k, v]) => (
                  <button
                    key={k}
                    className={`ramp ${rampKey === k ? 'is-active' : ''}`}
                    onClick={() => setRampKey(k)}
                  >
                    <span className="ramp-name">{k}</span>
                    <span className="ramp-chars">{v}</span>
                  </button>
                ))}
              </div>
            </SettingsBlock>

            <SettingsBlock label="effects" open={openBlocks.effects} onToggle={() => toggleBlock('effects')}>
              <Slider label="gamma" value={gamma} min={0.4} max={2.4} step={0.1}
                      onChange={setGamma} fixed={1} />
              <label className="toggle">
                <input type="checkbox" checked={invert} onChange={(e) => setInvert(e.target.checked)} />
                invert <span className="muted">(dark ink on light bg)</span>
              </label>
              <label className="toggle">
                <input type="checkbox" checked={blockAvg} onChange={(e) => setBlockAvg(e.target.checked)} />
                block averaging <span className="muted">({SUPERSAMPLE}× supersample)</span>
              </label>
              <div className="field-label">dithering</div>
              <div className="keymodes">
                {[['off', 'off'], ['floyd', 'floyd'], ['bayer', 'bayer']].map(([k, label]) => (
                  <button
                    key={k}
                    className={`keymode ${dither === k ? 'is-active' : ''}`}
                    onClick={() => setDither(k)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </SettingsBlock>
          </aside>

          {/* ── main: source panel + preview monitor (hero) ── */}
          <main className="monitor-wrap">
            <div className="stage-row">
            <section className="block source-panel">
              <div className="block-label">source</div>
              <div className="source-body">
                <div className="source-toolbar">
                  {/* video · image — both source elements stay mounted so their
                      refs exist and each source's state persists across tabs. */}
                  <div className="keymodes source-tabs">
                    {[['video', 'video'], ['image', 'image']].map(([k, label]) => (
                      <button
                        key={k}
                        className={`keymode ${sourceType === k ? 'is-active' : ''}`}
                        onClick={() => switchSource(k)}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  <div className="toolbar-right">
                    <div className="keymodes size-modes" role="group" aria-label="source preview size">
                      {['s', 'm', 'l'].map((k) => (
                        <button
                          key={k}
                          className={`keymode ${sourceScale === k ? 'is-active' : ''}`}
                          onClick={() => setSourceScale(k)}
                        >
                          {k.toUpperCase()}
                        </button>
                      ))}
                    </div>
                    {hasMedia && (
                      <button
                        className={`keymode ${cropMode ? 'is-active' : ''}`}
                        onClick={() => { setCropMode((m) => !m); setPicking(false); }}
                        title="drag a rectangle on the preview to convert only that region"
                      >
                        ▦ crop
                      </button>
                    )}
                    {crop && (
                      <button className="keymode" onClick={() => { setCrop(null); setBaked(null); setMode('live'); }}>
                        ✕ reset crop
                      </button>
                    )}
                  </div>
                </div>

                <div
                  className={`source-stage source-stage--${sourceScale} ${drawFullscreen ? 'is-fullscreen' : ''}`}
                  onDragOver={sourceType === 'image' ? (e) => { e.preventDefault(); setDragOver(true); } : undefined}
                  onDragLeave={sourceType === 'image' ? () => setDragOver(false) : undefined}
                  onDrop={sourceType === 'image' ? onDropImage : undefined}
                >
                  <div className={`stage-media ${sourceType === 'image' ? 'is-image' : ''}`} ref={mediaBoxRef}>
                    <video
                      ref={videoRef}
                      className="source-vid"
                      muted
                      playsInline
                      loop={loop}
                      style={{ display: sourceType === 'video' && hasVideo ? 'block' : 'none' }}
                    />
                    <canvas
                      ref={compositeRef}
                      className={`draw-pad ${!drawEnabled ? 'is-locked' : ''} ${drawEnabled && tool !== 'fill' ? 'brush-active' : ''}`}
                      style={{ display: sourceType === 'image' ? 'block' : 'none' }}
                      onPointerDown={onDrawDown}
                      onPointerEnter={moveBrushCursor}
                      onPointerMove={onCanvasMove}
                      onPointerUp={onDrawUp}
                      onPointerLeave={onCanvasLeave}
                      onPointerCancel={onCanvasLeave}
                    />
                    {/* committed crop, shown while not re-marqueeing */}
                    {shownRect && hasMedia && (
                      <div
                        className="crop-rect"
                        style={{
                          left: `${shownRect.x * 100}%`,
                          top: `${shownRect.y * 100}%`,
                          width: `${shownRect.w * 100}%`,
                          height: `${shownRect.h * 100}%`,
                        }}
                        aria-hidden="true"
                      />
                    )}
                    {/* crop marquee / eyedropper capture layer */}
                    {overlayActive && (
                      <div
                        className={`stage-overlay ${picking ? 'is-picking' : ''}`}
                        onPointerDown={onOverlayDown}
                        onPointerMove={onOverlayMove}
                        onPointerUp={onOverlayUp}
                        onPointerCancel={onOverlayUp}
                      />
                    )}
                  </div>

                  {sourceType === 'video' && !hasVideo && (
                    <label
                      className={`dropzone ${dragOver ? 'is-over' : ''}`}
                      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                      onDragLeave={() => setDragOver(false)}
                      onDrop={onDrop}
                    >
                      <input type="file" accept="video/*" onChange={(e) => loadFile(e.target.files?.[0])} hidden />
                      <div className="dropzone-art">{'[  +  ]'}</div>
                      <div>drop a video here<br />or click to choose</div>
                      <div className="hint">mp4 · mov · webm — never leaves your browser</div>
                    </label>
                  )}
                </div>

                {/* ── video transport ── */}
                {sourceType === 'video' && hasVideo && (
                  <>
                    <div className="filename" title={videoName}>{videoName}</div>
                    <div className="transport">
                      <button className="tbtn" onClick={() => stepFrame(-1)} aria-label="back one frame">‹</button>
                      <button className="tbtn tbtn-play" onClick={togglePlay} aria-label={playing ? 'pause' : 'play'}>
                        {playing ? '❚❚' : '▶'}
                      </button>
                      <button className="tbtn" onClick={() => stepFrame(1)} aria-label="forward one frame">›</button>
                      <span className="time-readout">{fmtTime(currentTime)} / {fmtTime(duration)}</span>
                      <input
                        className="scrub"
                        type="range"
                        min="0"
                        max={duration || 0}
                        step="0.01"
                        value={Math.min(currentTime, duration || 0)}
                        onChange={onScrub}
                        aria-label="seek video"
                      />
                      <button
                        className={`tbtn tbtn-loop ${loop ? 'on' : ''}`}
                        onClick={() => setLoop((l) => !l)}
                        aria-pressed={loop}
                        title="repeat playback to check the loop"
                      >
                        ⟳ loop
                      </button>
                    </div>
                    <label className="relink">
                      <input type="file" accept="video/*" onChange={(e) => loadFile(e.target.files?.[0])} hidden />
                      ↺ replace clip
                    </label>
                  </>
                )}

                {/* ── image tools: photo + drawing share one canvas ── */}
                {sourceType === 'image' && (
                  <div className="draw-tools">
                    {/* with a photo loaded, choose photo-only vs drawing over it */}
                    {hasPhoto && (
                      <label className="toggle">
                        <input type="checkbox" checked={drawOnPhoto} onChange={(e) => setDrawOnPhoto(e.target.checked)} />
                        draw on photo <span className="muted">(overlay your drawing on the photo)</span>
                      </label>
                    )}
                    {drawEnabled && drawControls}
                    <div className="draw-tools__row">
                      <div className="draw-actions">
                        {drawEnabled && <button className="btn" onClick={clearInk}>clear ink</button>}
                        {drawEnabled && <button className="btn" onClick={() => setDrawFullscreen(true)}>⛶ fullscreen</button>}
                        {hasPhoto && <button className="btn" onClick={restorePhoto}>restore photo</button>}
                        <label className="btn file-btn">
                          <input type="file" accept="image/*" onChange={(e) => loadImage(e.target.files?.[0])} hidden />
                          {hasPhoto ? '↺ replace photo' : '+ add photo'}
                        </label>
                      </div>
                    </div>
                    {hasPhoto && <div className="filename" title={imageName}>{imageName}</div>}
                    <p className="hint">
                      {drawEnabled
                        ? `draw over the ${hasPhoto ? 'photo' : 'blank paper'} — shade = brightness · fill buckets a region · erase removes ink · cut removes photo (transparent)${hasPhoto ? ' · replacing the photo clears the drawing' : ''}`
                        : 'converting the photo only — turn on “draw on photo” to overlay your drawing'}
                    </p>
                  </div>
                )}

                {error && <p className="source-error" role="alert">⚠ {error}</p>}

                {/* ── background removal — keyed on the source you see above ── */}
                {hasMedia && (
                  <div className="keyzone">
                    <div className="field-label">background removal</div>
                    <div className="keymodes">
                      {[
                        ['off', 'keep'],
                        ['green', 'green'],
                        ['black', 'black'],
                        ['white', 'white'],
                        ['custom', 'custom'],
                      ].map(([k, label]) => (
                        <button
                          key={k}
                          className={`keymode ${keyMode === k ? 'is-active' : ''}`}
                          onClick={() => setKeyMode(k)}
                        >
                          {label}
                        </button>
                      ))}
                      <button
                        className={`keymode ${picking ? 'is-active' : ''}`}
                        onClick={() => { setPicking((p) => !p); setCropMode(false); }}
                        title="click a pixel on the preview to key out that color"
                      >
                        ⌖ pick
                      </button>
                    </div>
                    {keyMode === 'custom' && (
                      <label className="keycolor">
                        <span className="keycolor-label">key color</span>
                        {/* native swatch + text field stay in sync — pick or type a hex */}
                        <input
                          type="color"
                          className="keycolor-swatch"
                          value={/^#[0-9a-f]{6}$/i.test(keyColor) ? keyColor : '#000000'}
                          onChange={(e) => setKeyColor(e.target.value)}
                          aria-label="pick key color"
                        />
                        <input
                          type="text"
                          className="keycolor-hex"
                          value={keyColor}
                          onChange={(e) => setKeyColor(e.target.value)}
                          spellCheck={false}
                          placeholder="#00ff00"
                          aria-label="key color hex"
                        />
                      </label>
                    )}
                    {keyMode !== 'off' && (
                      <Slider label="threshold" value={keyThreshold} min={0} max={1} step={0.02}
                              onChange={setKeyThreshold} fixed={2} suffix=" · higher removes more" />
                    )}
                  </div>
                )}
              </div>
            </section>

            <div className="monitor" ref={monitorRef}>
              <div className={`statusline ${mode === 'baked' ? 'is-baked' : ''}`}>
                <span className="dot" />
                {hasSource
                  ? mode === 'baked'
                    ? isStill
                      ? `still · 1 frame · ${cols}×${rows}`
                      : `baked · ${baked.frames.length} frames · ${cols}×${rows} @ ${baked.fps}fps`
                    : isStill
                      ? `still · ${cols}×${rows}`
                      : `live · ${cols}×${rows} · ~${frameEstimate} frames @ ${fps}fps`
                  : 'no signal'}
                {hasSource && baked && (
                  <span className="toggle-mode">
                    <button className={mode === 'live' ? 'on' : ''} onClick={() => setMode('live')}>live</button>
                    <button className={mode === 'baked' ? 'on' : ''} onClick={() => setMode('baked')}>baked</button>
                  </span>
                )}
              </div>
              <div className={`screen ${keyMode !== 'off' ? 'is-keying' : ''}`} ref={screenRef}>
                {hasSource ? (
                  <pre
                    ref={previewRef}
                    className="preview"
                    style={{
                      fontSize: previewFontSize,
                      transform: previewScale !== 1 ? `scale(${previewScale})` : undefined,
                    }}
                    aria-hidden="true"
                  />
                ) : (
                  <div className="noise">drop a clip to begin</div>
                )}
                <div className="scanline" aria-hidden="true" />
              </div>
            </div>
            </div>

            {/* ── bake + export bar ── */}
            <div className="actions">
              <button className="btn primary" onClick={bake} disabled={!hasSource || baking}>
                {baking ? `baking… ${bakeProgress}%` : isStill ? '● bake still' : '● bake animation'}
              </button>
              <button className="btn" onClick={exportJson} disabled={!baked || baking}>
                ↓ export figure.json
              </button>
              <div className="readout">
                {baked
                  ? `raw ${formatBytes(sizes.raw)} · gzip ~${formatBytes(sizes.gz)}`
                  : isStill
                    ? 'bake to export the still'
                    : frameEstimate > 480
                      ? `heads up: ~${frameEstimate} frames is a lot — lower fps or trim`
                      : 'bake to measure output size'}
              </div>
              {baking && (
                <div className="progress"><span style={{ width: `${bakeProgress}%` }} /></div>
              )}
            </div>

            {baked && (
              <pre className="snippet">{`// react (portfolio) — size with fit / width / fontSize:
import AsciiPlayer from './components/AsciiPlayer.jsx';
import figure from './data/figure.json';
<AsciiPlayer data={figure} fit />

// any site — copy ascii-player.js + figure.json:
<script type="module" src="ascii-player.js"></script>
<ascii-player src="figure.json" fit></ascii-player>`}</pre>
            )}
          </main>
        </div>

        <canvas ref={canvasRef} style={{ display: 'none' }} />

        {/* brush-size ring that follows the pointer over the canvas (brush tools only) */}
        {sourceType === 'image' && drawEnabled && tool !== 'fill' && (
          <div ref={brushCursorRef} className="brush-cursor" aria-hidden="true" />
        )}

        {/* Mobile only (CSS-gated): a floating live preview that appears once the
            main monitor scrolls out of view. Tap to jump back up, drag to move,
            × to dismiss (it re-arms when you scroll back to the monitor). */}
        <div
          ref={miniElRef}
          className={`mini-monitor ${(drawFullscreen || miniVisible) && hasSource && !miniDismissed ? 'is-visible' : ''} ${mode === 'baked' ? 'is-baked' : ''} ${drawFullscreen ? 'is-fs' : ''}`}
          style={miniPosStyle || undefined}
          onPointerDown={onMiniDown}
          onPointerMove={onMiniMove}
          onPointerUp={onMiniUp}
          onPointerCancel={onMiniUp}
          onClick={onMiniClick}
          role="button"
          tabIndex={0}
          aria-label="ASCII preview — tap to jump to the full monitor, drag to move"
        >
          <pre
            ref={miniPreviewRef}
            className="preview mini-preview"
            style={{
              fontSize: previewFontSize,
              transform: `scale(${miniScale})`,
            }}
            aria-hidden="true"
          />
          <span className="mini-dot" aria-hidden="true" />
          <button
            type="button"
            className="mini-close"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => { e.stopPropagation(); setMiniDismissed(true); }}
            aria-label="hide the preview"
          >
            ×
          </button>
        </div>

        {/* Fullscreen drawing: a compact tool bar over the maximized canvas; the
            floating mini-monitor above shows the live ASCII while you draw. */}
        {drawFullscreen && (
          <div className="fs-drawbar">
            {drawControls}
            <div className="fs-actions">
              <button className="btn" onClick={clearInk}>clear ink</button>
              {hasPhoto && <button className="btn" onClick={restorePhoto}>restore photo</button>}
              <button className="btn primary" onClick={() => setDrawFullscreen(false)}>✕ exit</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Draw the current source frame into the offscreen canvas and return the
 * ascii for it. `source` is a <video> or <canvas> — drawImage handles both.
 * With blockAvg on, the canvas is SUPERSAMPLE× the grid and each cell
 * averages its block. A crop maps only that region of the source onto the
 * grid. The canvas is cleared first because the image source can carry
 * transparency (cut regions) that must not reveal the previous frame.
 */
function sampleFrame(ctx, canvas, source, s) {
  const ss = s.blockAvg ? SUPERSAMPLE : 1;
  const w = s.cols * ss;
  const h = s.rows * ss;
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  ctx.clearRect(0, 0, w, h);
  const natW = source.videoWidth || source.width;
  const natH = source.videoHeight || source.height;
  const c = s.crop;
  if (c && natW && natH) {
    ctx.drawImage(source, c.x * natW, c.y * natH, c.w * natW, c.h * natH, 0, 0, w, h);
  } else {
    ctx.drawImage(source, 0, 0, w, h);
  }
  const { data } = ctx.getImageData(0, 0, w, h);
  return convertFrame(data, w, h, {
    cols: s.cols,
    rows: s.rows,
    ramp: s.ramp,
    invert: s.invert,
    gamma: s.gamma,
    key: { mode: s.keyMode, threshold: s.keyThreshold, color: s.keyColor },
    dither: s.dither,
  });
}

/** A collapsible settings category — the label bar toggles the body. */
function SettingsBlock({ label, open, onToggle, children }) {
  return (
    <section className="block">
      <button className="block-label block-toggle" aria-expanded={open} onClick={onToggle}>
        <span>{label}</span>
        <span className="caret" aria-hidden="true">{open ? '▾' : '▸'}</span>
      </button>
      {open && <div className="block-body">{children}</div>}
    </section>
  );
}

function Slider({ label, value, min, max, step, onChange, suffix = '', fixed }) {
  const shown = fixed != null ? Number(value).toFixed(fixed) : value;
  return (
    <label className="slider">
      <span className="slider-top">
        <span>{label}</span>
        <span className="slider-val">{shown}{suffix}</span>
      </span>
      <input type="range" min={min} max={max} step={step} value={value}
             onChange={(e) => onChange(Number(e.target.value))} />
    </label>
  );
}
