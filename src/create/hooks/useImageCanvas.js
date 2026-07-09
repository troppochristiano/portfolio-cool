import { useCallback, useEffect, useRef, useState } from "react";
import { hexToRgb } from "../asciify.js";
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
  const strokeCanvasRef = useRef(null); // offscreen: brush strokes; eraser erases here only
  const photoImgRef = useRef(null); // decoded photo, kept so "restore photo" can undo cuts

  const [hasPhoto, setHasPhoto] = useState(false);
  // Upload-first intro for the image source: landing straight on blank paper
  // hides the fact that photos can be uploaded, so a dropzone shows first and
  // "start with blank paper" (or loading a photo) dismisses it.
  const [imageIntro, setImageIntro] = useState(true);
  const [imageName, setImageName] = useState("");

  // image tools: draw (ink), fill (bucket), erase (ink only), cut (photo → transparent)
  const [tool, setTool] = useState("draw");
  const [brush, setBrush] = useState(14);
  const [fillTolerance, setFillTolerance] = useState(0.15);
  const [drawOnPhoto, setDrawOnPhoto] = useState(true); // photo loaded: overlay drawing vs convert photo only
  const [drawFullscreen, setDrawFullscreen] = useState(false); // maximize the canvas for drawing
  const [brushShade, setBrushShade] = useState("#000000");
  const drawingRef = useRef(false);
  const lastPtRef = useRef(null);

  // Strokes are composited unless "draw on photo" is off (photo-only output).
  // Read through a ref so compositeLayers stays a stable, dependency-free callback.
  const includeStrokesRef = useRef(true);
  const compositeLayers = useCallback(() => {
    const comp = compositeRef.current;
    const photo = photoCanvasRef.current;
    const stroke = strokeCanvasRef.current;
    if (!comp || !photo || !stroke) return;
    const ctx = comp.getContext("2d");
    ctx.clearRect(0, 0, comp.width, comp.height);
    ctx.drawImage(photo, 0, 0);
    if (includeStrokesRef.current) ctx.drawImage(stroke, 0, 0);
  }, [compositeRef]);

  const resizeLayers = useCallback(
    (w, h, drawPhoto) => {
      const comp = compositeRef.current;
      const photo = photoCanvasRef.current;
      const stroke = strokeCanvasRef.current;
      if (!comp || !photo || !stroke) return;
      comp.width = w;
      comp.height = h; // resizing clears all three
      photo.width = w;
      photo.height = h;
      stroke.width = w;
      stroke.height = h;
      const pctx = photo.getContext("2d");
      if (drawPhoto) {
        pctx.drawImage(drawPhoto, 0, 0, w, h);
      } else {
        pctx.fillStyle = "#fff";
        pctx.fillRect(0, 0, w, h);
      }
      compositeLayers();
    },
    [compositeRef, compositeLayers],
  );

  // init: create the offscreen layers and lay down white paper
  useEffect(() => {
    photoCanvasRef.current = document.createElement("canvas");
    strokeCanvasRef.current = document.createElement("canvas");
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
        photoImgRef.current = img;
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
    const target =
      tool === "cut" ? photoCanvasRef.current : strokeCanvasRef.current;
    const ctx = target.getContext("2d");
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.lineWidth = brush;
    if (tool === "draw") {
      ctx.globalCompositeOperation = "source-over";
      ctx.strokeStyle = brushShade;
      ctx.fillStyle = brushShade;
    } else {
      // erase and cut both remove pixels from their layer → transparent
      ctx.globalCompositeOperation = "destination-out";
      ctx.strokeStyle = "#000";
      ctx.fillStyle = "#000";
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
    ctx.globalCompositeOperation = "source-over";
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

  const onDrawDown = (e) => {
    if (picking || cropMode) return; // the overlay owns the pointer then
    if (hasPhoto && !drawOnPhoto) return; // drawing disabled (converting the photo only)
    e.preventDefault();
    if (tool === "fill") {
      floodFill(drawPos(e));
      return;
    } // click action, no drag
    // capture keeps the stroke tracking outside the canvas; a pointer that
    // vanished between events must not kill the stroke, so failure is fine
    try {
      compositeRef.current.setPointerCapture(e.pointerId);
    } catch {
      /* stroke still draws */
    }
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
    el.style.display = "block";
  };
  const hideBrushCursor = () => {
    if (brushCursorRef.current) brushCursorRef.current.style.display = "none";
  };
  const onCanvasMove = (e) => {
    moveBrushCursor(e);
    onDrawMove(e);
  };
  const onCanvasLeave = (e) => {
    hideBrushCursor();
    onDrawUp(e);
  };
  const clearInk = () => {
    const s = strokeCanvasRef.current;
    s.getContext("2d").clearRect(0, 0, s.width, s.height);
    compositeLayers();
  };
  // Redraw the photo layer from the kept decoded image — undoes every cut.
  const restorePhoto = () => {
    const photo = photoCanvasRef.current;
    const img = photoImgRef.current;
    const pctx = photo.getContext("2d");
    pctx.clearRect(0, 0, photo.width, photo.height);
    if (img) {
      pctx.drawImage(img, 0, 0, photo.width, photo.height);
    } else {
      pctx.fillStyle = "#fff";
      pctx.fillRect(0, 0, photo.width, photo.height);
    }
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
    loadImage,
    onDrawDown,
    onDrawUp,
    moveBrushCursor,
    onCanvasMove,
    onCanvasLeave,
    clearInk,
    restorePhoto,
  };
}
