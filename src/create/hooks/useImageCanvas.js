import { useCallback, useEffect, useRef, useState } from "react";
import { hexToRgb } from "../asciify.js";
import { capturePointer } from "../../lib/utils.js";
import { MAX_PHOTO, PAPER_W, PAPER_H } from "../createConstants.js";

/**
 * The image input: photo (bottom, opaque unless cut) + strokes (top) →
 * composite. The composite canvas is what's shown AND what the sampler reads,
 * so the rest of the pipeline never needs to know about layers. Also owns the
 * drawing engine (brush/fill/erase/cut), the fullscreen-draw mode, and the
 * brush-ring cursor.
 *
 * `picking`/`cropMode` gate the pointer (the crop/eyedropper overlay owns it
 * then); `onNewImage({ w, h })` fires when a photo loads so the caller can
 * adopt its dimensions and drop stale bake/crop state.
 */
export function useImageCanvas(compositeRef, {
  sourceType,
  picking,
  cropMode,
  setError,
  onNewImage,
}) {
  const photoCanvasRef = useRef(null); // offscreen: the uploaded photo (or white paper); cut erases here
  const strokeCanvasRef = useRef(null); // offscreen: brush strokes; eraser erases here + heals cuts
  const originalCanvasRef = useRef(null); // pristine photo layer (photo or white) — erase/trash repaint from it
  const erasePatternRef = useRef(null); // cached CanvasPattern of the original (erase heals through it)

  const [hasPhoto, setHasPhoto] = useState(false);
  // Upload-first intro for the image source: landing straight on blank paper
  // hides the fact that photos can be uploaded, so a dropzone shows first and
  // "start with blank paper" (or loading a photo) dismisses it.
  const [imageIntro, setImageIntro] = useState(true);
  const [imageName, setImageName] = useState("");

  // image tools: draw (ink), fill (bucket), erase (ink + heals cuts), cut (photo → transparent)
  const [tool, setTool] = useState("draw");
  const [brush, setBrush] = useState(14);
  const [fillTolerance, setFillTolerance] = useState(0.15);
  const [drawOnPhoto, setDrawOnPhoto] = useState(true); // photo loaded: overlay drawing vs convert photo only
  const [drawFullscreen, setDrawFullscreen] = useState(false); // maximize the canvas for drawing
  const [brushShade, setBrushShade] = useState("#000000");
  const drawingRef = useRef(false);
  const lastPtRef = useRef(null);

  // Undo history: each entry snapshots the layer(s) the action is about to
  // dirty (draw/fill → stroke, cut → photo, erase/trash → both). The stacks
  // live in refs; histTick only forces re-renders for canUndo/canRedo.
  const historyRef = useRef([]);
  const redoRef = useRef([]);
  const [, setHistTick] = useState(0);

  // Strokes are composited unless "draw on photo" is off (photo-only output).
  // Read through a ref so compositeLayers stays a stable, dependency-free callback.
  const includeStrokesRef = useRef(true);
  // The composite canvas is the sampler's source, and a canvas — unlike a
  // <video>'s currentTime — offers no way to ask "did your pixels change?".
  // compositeLayers is the one choke point every mutation goes through
  // (strokes, fill, undo/redo, trash, layer resize, the draw-on-photo
  // toggle), so a counter bumped here IS that signal. The preview loop reads
  // it to skip converting a frame that would come out byte-identical.
  const sourceVersionRef = useRef(0);
  const compositeLayers = useCallback(() => {
    const comp = compositeRef.current;
    const photo = photoCanvasRef.current;
    const stroke = strokeCanvasRef.current;
    if (!comp || !photo || !stroke) return;
    const ctx = comp.getContext("2d");
    ctx.clearRect(0, 0, comp.width, comp.height);
    ctx.drawImage(photo, 0, 0);
    if (includeStrokesRef.current) ctx.drawImage(stroke, 0, 0);
    sourceVersionRef.current += 1;
  }, [compositeRef]);

  const resizeLayers = useCallback(
    (w, h, drawPhoto) => {
      const comp = compositeRef.current;
      const photo = photoCanvasRef.current;
      const stroke = strokeCanvasRef.current;
      const orig = originalCanvasRef.current;
      if (!comp || !photo || !stroke || !orig) return;
      comp.width = w;
      comp.height = h; // resizing clears all four
      photo.width = w;
      photo.height = h;
      stroke.width = w;
      stroke.height = h;
      orig.width = w;
      orig.height = h;
      const octx = orig.getContext("2d");
      if (drawPhoto) {
        octx.drawImage(drawPhoto, 0, 0, w, h);
      } else {
        octx.fillStyle = "#fff";
        octx.fillRect(0, 0, w, h);
      }
      // the photo layer starts as a copy of the pristine original
      photo.getContext("2d").drawImage(orig, 0, 0);
      // a pattern snapshots its source, so a new original invalidates it
      erasePatternRef.current = null;
      // new layer dimensions orphan every snapshot
      historyRef.current = [];
      redoRef.current = [];
      historyBytesRef.current = 0;
      setHistTick((t) => t + 1);
      compositeLayers();
    },
    [compositeRef, compositeLayers],
  );

  // init: create the offscreen layers and lay down white paper
  useEffect(() => {
    photoCanvasRef.current = document.createElement("canvas");
    strokeCanvasRef.current = document.createElement("canvas");
    originalCanvasRef.current = document.createElement("canvas");
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
    const enabled = sourceType === "image" && (!hasPhoto || drawOnPhoto);
    if (!enabled) setDrawFullscreen(false);
  }, [sourceType, hasPhoto, drawOnPhoto]);
  useEffect(() => {
    if (!drawFullscreen) return;
    const onKey = (e) => {
      if (e.key === "Escape") setDrawFullscreen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [drawFullscreen]);
  // Scale the canvas up to fill the fullscreen area (preserving aspect and keeping
  // the element box == the drawn bitmap, so pointer mapping stays exact). CSS can't
  // aspect-fit-upscale a <canvas> without object-fit, which would break coords.
  useEffect(() => {
    const canvas = compositeRef.current;
    if (!canvas) return;
    if (!drawFullscreen) {
      canvas.style.width = "";
      canvas.style.height = "";
      return;
    }
    const fit = () => {
      const bar = document.querySelector(".fs-drawbar");
      const availW = window.innerWidth - 20;
      const availH = window.innerHeight - 20 - (bar ? bar.offsetHeight : 84);
      if (availW <= 0 || availH <= 0) return;
      const scale = Math.min(availW / canvas.width, availH / canvas.height);
      canvas.style.width = `${Math.round(canvas.width * scale)}px`;
      canvas.style.height = `${Math.round(canvas.height * scale)}px`;
    };
    fit();
    window.addEventListener("resize", fit);
    return () => {
      window.removeEventListener("resize", fit);
      canvas.style.width = "";
      canvas.style.height = "";
    };
  }, [compositeRef, drawFullscreen, hasPhoto]);

  // ── load a photo into the layers ──────────────────────────────
  const onNewImageRef = useRef(onNewImage);
  useEffect(() => {
    onNewImageRef.current = onNewImage;
  });
  const loadImage = useCallback(
    (file) => {
      if (!file) return;
      if (!file.type.startsWith("image/")) {
        setError(`"${file.name}" isn't an image — try jpg, png, or webp`);
        return;
      }
      setError("");
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(url);
        const scale = Math.min(
          1,
          MAX_PHOTO / Math.max(img.naturalWidth, img.naturalHeight),
        );
        const w = Math.max(1, Math.round(img.naturalWidth * scale));
        const h = Math.max(1, Math.round(img.naturalHeight * scale));
        // resizing the layers clears the strokes — coordinates wouldn't survive
        // the aspect change anyway (hinted in the UI)
        resizeLayers(w, h, img);
        setHasPhoto(true);
        setImageIntro(false);
        setImageName(file.name);
        onNewImageRef.current({ w, h });
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        setError("couldn’t read that image — try another file");
      };
      img.src = url;
    },
    [resizeLayers, setError],
  );

  // ── drawing (on the composite canvas, into the layers) ────────
  // `rect` is optional: handlers that already measured the canvas this event
  // pass theirs in rather than forcing a second layout (see onCanvasMove).
  const drawPos = (e, rect) => {
    const c = compositeRef.current;
    const r = rect || c.getBoundingClientRect();
    return {
      x: (e.clientX - r.left) * (c.width / r.width),
      y: (e.clientY - r.top) * (c.height / r.height),
    };
  };
  const strokeTo = (pt) => {
    // One geometry pass per affected layer: draw inks the stroke layer, cut
    // punches the photo layer, erase does both — it lifts ink AND heals cuts
    // by repainting the pristine original through the stroke shape (a pattern
    // keeps the pixels aligned; on blank paper the original is just white).
    const passes = [];
    if (tool === "draw") {
      passes.push({
        canvas: strokeCanvasRef.current,
        gco: "source-over",
        paint: brushShade,
      });
    } else if (tool === "cut") {
      passes.push({
        canvas: photoCanvasRef.current,
        gco: "destination-out",
        paint: "#000",
      });
    } else {
      passes.push({
        canvas: strokeCanvasRef.current,
        gco: "destination-out",
        paint: "#000",
      });
      passes.push({
        canvas: photoCanvasRef.current,
        gco: "source-over",
        paint: null, // → pattern of the original
      });
    }
    const last = lastPtRef.current;
    for (const pass of passes) {
      const ctx = pass.canvas.getContext("2d");
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.lineWidth = brush;
      ctx.globalCompositeOperation = pass.gco;
      // The heal pattern was rebuilt from the full (up to 1280px) original on
      // every pointermove of an erase drag. The original only changes when the
      // layers are resized, so build it once and let resizeLayers drop it.
      if (pass.paint === null && !erasePatternRef.current) {
        erasePatternRef.current = ctx.createPattern(
          originalCanvasRef.current,
          "no-repeat",
        );
      }
      const paint = pass.paint ?? erasePatternRef.current;
      ctx.strokeStyle = paint;
      ctx.fillStyle = paint;
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
      ctx.globalCompositeOperation = "source-over";
    }
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
    const w = comp.width,
      h = comp.height;
    const sx = Math.floor(pt.x),
      sy = Math.floor(pt.y);
    if (sx < 0 || sy < 0 || sx >= w || sy >= h) return;
    const rgb = hexToRgb(brushShade) || [0, 0, 0];
    const cctx = comp.getContext("2d");
    const src = cctx.getImageData(0, 0, w, h).data;
    const sctx = stroke.getContext("2d");
    const dstImg = sctx.getImageData(0, 0, w, h);
    const dst = dstImg.data;

    const seed = (sy * w + sx) * 4;
    const sr = src[seed],
      sg = src[seed + 1],
      sb = src[seed + 2],
      sa = src[seed + 3];
    // 4-channel Euclidean distance, normalized to 0..1 (max = sqrt(4)*255).
    const maxDist = 510; // sqrt(4) * 255
    const tol = fillTolerance * maxDist;
    const tol2 = tol * tol;
    const matches = (p) => {
      const dr = src[p] - sr,
        dg = src[p + 1] - sg,
        db = src[p + 2] - sb,
        da = src[p + 3] - sa;
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
      dst[p] = rgb[0];
      dst[p + 1] = rgb[1];
      dst[p + 2] = rgb[2];
      dst[p + 3] = 255;
      const push = (nx, ny) => {
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) return;
        const idx = ny * w + nx;
        if (seen[idx]) return;
        if (!matches(idx * 4)) return;
        seen[idx] = 1;
        stack.push(nx, ny);
      };
      push(x + 1, y);
      push(x - 1, y);
      push(x, y + 1);
      push(x, y - 1);
    }
    sctx.putImageData(dstImg, 0, 0);
    compositeLayers();
  };

  // ── undo history ──────────────────────────────────────────────
  // Two limits, and the byte budget is the one that matters. A depth cap alone
  // is a lie about memory: an entry is 1–2 full-canvas ImageData, so at
  // MAX_PHOTO a "shallow" 15 steps is up to ~150 MB of retained pixels —
  // enough to get the tab killed on a phone mid-drawing. Budget first, depth
  // as a secondary bound; a single entry over budget is still kept (one step
  // of undo is the floor).
  const HISTORY_MAX = 15;
  const HISTORY_MAX_BYTES = 48 * 1024 * 1024;
  const historyBytesRef = useRef(0);
  const entryBytes = (entry) =>
    (entry.stroke?.data.byteLength || 0) + (entry.photo?.data.byteLength || 0);
  const layerData = (canvas) =>
    canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height);
  // capture the layers an action is about to dirty; a new action always
  // abandons the redo branch
  const pushHistory = (withStroke, withPhoto) => {
    const entry = {};
    if (withStroke) entry.stroke = layerData(strokeCanvasRef.current);
    if (withPhoto) entry.photo = layerData(photoCanvasRef.current);
    historyRef.current.push(entry);
    historyBytesRef.current += entryBytes(entry);
    while (
      historyRef.current.length > 1 &&
      (historyRef.current.length > HISTORY_MAX ||
        historyBytesRef.current > HISTORY_MAX_BYTES)
    ) {
      historyBytesRef.current -= entryBytes(historyRef.current.shift());
    }
    redoRef.current = [];
    setHistTick((t) => t + 1);
  };
  // restore an entry's layers, returning the displaced pixels — the same
  // entry shape travels back and forth between the undo and redo stacks
  const applyEntry = (entry) => {
    const swapped = {};
    if (entry.stroke) {
      const s = strokeCanvasRef.current;
      swapped.stroke = layerData(s);
      s.getContext("2d").putImageData(entry.stroke, 0, 0);
    }
    if (entry.photo) {
      const p = photoCanvasRef.current;
      swapped.photo = layerData(p);
      p.getContext("2d").putImageData(entry.photo, 0, 0);
    }
    compositeLayers();
    return swapped;
  };
  const undo = () => {
    const entry = historyRef.current.pop();
    if (!entry) return;
    historyBytesRef.current -= entryBytes(entry);
    redoRef.current.push(applyEntry(entry));
    setHistTick((t) => t + 1);
  };
  const redo = () => {
    const entry = redoRef.current.pop();
    if (!entry) return;
    const swapped = applyEntry(entry);
    historyRef.current.push(swapped);
    historyBytesRef.current += entryBytes(swapped);
    setHistTick((t) => t + 1);
  };
  const canUndo = historyRef.current.length > 0;
  const canRedo = redoRef.current.length > 0;

  const onDrawDown = (e) => {
    if (picking || cropMode) return; // the overlay owns the pointer then
    if (hasPhoto && !drawOnPhoto) return; // drawing disabled (converting the photo only)
    e.preventDefault();
    if (tool === "fill") {
      pushHistory(true, false);
      floodFill(drawPos(e));
      return;
    } // click action, no drag
    // checkpoint once per stroke (down fires once; up can multi-fire)
    pushHistory(tool !== "cut", tool === "cut" || tool === "erase");
    // capture keeps the stroke tracking outside the canvas; a pointer that
    // vanished between events must not kill the stroke, so failure is fine
    capturePointer(e, compositeRef.current);
    drawingRef.current = true;
    lastPtRef.current = null;
    strokeTo(drawPos(e));
  };
  const onDrawMove = (e, rect) => {
    if (!drawingRef.current) return;
    e.preventDefault();
    strokeTo(drawPos(e, rect));
  };
  const onDrawUp = () => {
    drawingRef.current = false;
    lastPtRef.current = null;
  };
  // A ring cursor the size of the brush footprint on screen (brush is in backing
  // px; the canvas is displayed scaled, so multiply by the display/backing ratio).
  const brushCursorRef = useRef(null);
  const moveBrushCursor = (e, measured) => {
    const el = brushCursorRef.current;
    const canvas = compositeRef.current;
    if (!el || !canvas) return;
    const rect = measured || canvas.getBoundingClientRect();
    const d = brush * (rect.width / (canvas.width || 1));
    el.style.width = `${d}px`;
    el.style.height = `${d}px`;
    el.style.left = `${e.clientX}px`;
    el.style.top = `${e.clientY}px`;
    el.style.display = "block";
  };
  const hideBrushCursor = () => {
    if (brushCursorRef.current) brushCursorRef.current.style.display = "none";
  };
  // ONE rect read, shared by the ring and the stroke. These used to measure
  // independently with five style writes between them, so every pointer
  // sample forced layout twice — and coalesced moves reach 120Hz on a phone.
  const onCanvasMove = (e) => {
    const canvas = compositeRef.current;
    const rect = canvas ? canvas.getBoundingClientRect() : null;
    moveBrushCursor(e, rect);
    onDrawMove(e, rect);
  };
  const onCanvasLeave = (e) => {
    hideBrushCursor();
    onDrawUp(e);
  };
  // One-tap reset: wipe the ink AND heal every cut — the old separate
  // "clear ink" / "restore photo" buttons folded into the palette's trash chip.
  const trashAll = () => {
    pushHistory(true, true);
    const s = strokeCanvasRef.current;
    s.getContext("2d").clearRect(0, 0, s.width, s.height);
    const photo = photoCanvasRef.current;
    const pctx = photo.getContext("2d");
    pctx.clearRect(0, 0, photo.width, photo.height);
    pctx.drawImage(originalCanvasRef.current, 0, 0);
    compositeLayers();
  };

  return {
    hasPhoto,
    imageIntro,
    setImageIntro,
    imageName,
    tool,
    setTool,
    brush,
    setBrush,
    fillTolerance,
    setFillTolerance,
    drawOnPhoto,
    setDrawOnPhoto,
    drawFullscreen,
    setDrawFullscreen,
    brushShade,
    setBrushShade,
    brushCursorRef,
    sourceVersionRef,
    loadImage,
    onDrawDown,
    onDrawUp,
    moveBrushCursor,
    onCanvasMove,
    onCanvasLeave,
    trashAll,
    undo,
    redo,
    canUndo,
    canRedo,
  };
}
