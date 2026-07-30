import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { SUPERSAMPLE, computeRows } from "../create/asciify.js";
import { FONT_STACKS, STYLE_DEFAULTS } from "../create/styleOptions.js";
import {
  RAMP_PRESETS,
  QUALITY_PRESETS,
  PAPER_W,
  PAPER_H,
  BRUSH_SHADES,
} from "../create/createConstants.js";
import { useBake } from "../create/hooks/useBake.js";
import { useCrop, CROP_HANDLES } from "../create/hooks/useCrop.js";
import { useVideoSource } from "../create/hooks/useVideoSource.js";
import { useImageCanvas } from "../create/hooks/useImageCanvas.js";
import { useAsciiPreviewLoop } from "../create/hooks/useAsciiPreviewLoop.js";
import { useExport } from "../create/hooks/useExport.js";
import { useMiniMonitor } from "../create/hooks/useMiniMonitor.js";
import Slider from "../create/controls/Slider.jsx";
import SegmentedControl from "../create/controls/SegmentedControl.jsx";
import ToggleRow from "../create/controls/ToggleRow.jsx";
import SourceButton from "../create/controls/SourceButton.jsx";
import {
  PencilIcon,
  EraserIcon,
  FillIcon,
  TrashIcon,
  UndoIcon,
  RedoIcon,
} from "../create/controls/DrawIcons.jsx";
import { SettingsBlock } from "../create/controls/Sections.jsx";
import UploadModal from "../components/UploadModal.jsx";
import PngFrameModal from "../components/PngFrameModal.jsx";
import {
  capturePointer,
  clamp,
  fmtTime,
  formatBytes,
  MONO_ADVANCE,
} from "../lib/utils.js";
import { useLiveRef } from "../hooks/useLiveRef.js";
import { videoExportLabel } from "../hooks/useVideoExport.js";
import "./Create.css";

// The two-layer ascii monitor (base <pre> + optional edge overlay), styled
// identically wherever it appears — the main monitor and the floating mini
// monitor share this one definition, so a styling tweak can't land in only
// one of them.
function PreviewStack({
  baseRef,
  edgeRef,
  showEdge,
  fontSize,
  fontFamily,
  color,
  edgeColor,
  scale,
  mini = false,
}) {
  const layerStyle = (layerColor) => ({
    fontSize,
    fontFamily,
    color: layerColor,
    transform: scale !== 1 ? `scale(${scale})` : undefined,
  });
  const layerClass = `preview${mini ? " mini-preview" : ""}`;
  return (
    <div className="preview-stack">
      <pre ref={baseRef} className={layerClass} style={layerStyle(color)} aria-hidden="true" />
      {showEdge && (
        <pre
          ref={edgeRef}
          className={`${layerClass} preview-edge`}
          style={layerStyle(edgeColor)}
          aria-hidden="true"
        />
      )}
    </div>
  );
}

// With an adminSecret (the /admin/create route), the tool is identical except
// the share dialog: no Turnstile and the server waives the upload limits.
export default function Create({ adminSecret = null }) {
  const videoRef = useRef(null);
  const compositeRef = useRef(null); // displayed <canvas> = photo + strokes; also the sample source
  const canvasRef = useRef(null); // offscreen sampler
  const freezeRef = useRef(null); // last good video frame, shown during a reload
  const monitorRef = useRef(null); // the main monitor (observed for the mini's visibility)
  const pageRef = useRef(null); // the .create-page scroll container
  const screenRef = useRef(null); // monitor interior the <pre> must fit inside
  const mediaBoxRef = useRef(null); // wrapper that shrink-wraps the visible media (crop/eyedropper coords)
  const settingsRef = useRef(null); // latest settings for the rAF loop
  const settingsVersionRef = useRef(0); // bumped with settingsRef — the loop's dirty check

  // 'video' | 'image' — which input feeds the converter. The image source is
  // one canvas the user can both load a photo into and draw on.
  const [sourceType, setSourceType] = useState("video");
  const [dims, setDims] = useState({ w: 0, h: 0 });
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState("");
  // source stage display height — drag-resizable via the grip under the stage
  const [stageH, setStageH] = useState(360);
  const stageDragRef = useRef(null); // { startY, startH } while the grip is held

  // settings
  const [cols, setCols] = useState(110);
  // font + colors — display styling that rides into the baked figure's
  // optional `style` block (validated server-side on upload). Spacing/line
  // height knobs are gone: cell aspect shapes the grid at the sampling stage.
  const [fontKey, setFontKey] = useState(STYLE_DEFAULTS.font);
  const [fgColor, setFgColor] = useState(STYLE_DEFAULTS.color);
  const [bgColor, setBgColor] = useState(STYLE_DEFAULTS.background);
  // resolution: 'auto' locks rows to the source aspect; 'custom' sets rows freely
  // (the frame stretches to the forced grid). customRows is the explicit height.
  const [resMode, setResMode] = useState("auto");
  const [customRows, setCustomRows] = useState(60);
  const [cellPx, setCellPx] = useState(11);
  const [fps, setFps] = useState(15);
  const [gamma, setGamma] = useState(1);
  const [contrast, setContrast] = useState(1);
  const [invert, setInvert] = useState(false);
  // edge detection: replace (or isolate) cells on strong luma gradients with
  // direction glyphs — see detectEdges in asciify.js.
  const [edgeMode, setEdgeMode] = useState("off"); // 'off' | 'overlay' | 'only'
  const [edgeThreshold, setEdgeThreshold] = useState(0.25);
  // Edge glyph color. null = linked to the text color (the default look); a hex
  // string means the user picked a distinct color, which splits edges onto their
  // own tinted layer and rides into the figure as style.edgeColor.
  const [edgeColor, setEdgeColor] = useState(null);
  const [cellAspect, setCellAspect] = useState(2);
  const [rampKey, setRampKey] = useState("classic");
  const [blockAvg, setBlockAvg] = useState(false);
  const [dither, setDither] = useState("off"); // 'off' | 'floyd' | 'bayer'
  // background key: drop the keyColor background to transparent (RGB-distance
  // keyed). threshold 0..1, higher removes more. keyMode is 'off' | 'custom'
  // in the UI now; the engine still understands the old preset modes.
  const [keyMode, setKeyMode] = useState("off");
  const [keyThreshold, setKeyThreshold] = useState(0.4);
  const [keyColor, setKeyColor] = useState("#3cba54");

  // which rail settings categories are expanded
  const [openBlocks, setOpenBlocks] = useState({
    resolution: true,
    playback: true,
    characters: true,
    effects: true,
  });
  const toggleBlock = (id) => setOpenBlocks((o) => ({ ...o, [id]: !o[id] }));
  // last non-off edge mode, restored when the toggle comes back on
  const lastEdgeModeRef = useRef("overlay");

  // fit the frame into the monitor
  const [previewScale, setPreviewScale] = useState(1);
  const [outputPx, setOutputPx] = useState(null); // measured size of the rendered <pre>

  // The metadata listeners in useVideoSource bind once but need the current
  // source type to decide whether to adopt new dimensions.
  const sourceTypeRef = useRef(sourceType);
  useEffect(() => {
    sourceTypeRef.current = sourceType;
  }, [sourceType]);

  const { baking, bakeProgress, baked, sizes, mode, setMode, invalidate, bake } =
    useBake();

  const {
    crop,
    setCrop,
    cropMode,
    setCropMode,
    cropDraft,
    picking,
    setPicking,
    onOverlayDown,
    onOverlayMove,
    onOverlayUp,
    onCropEditDown,
    onCropEditMove,
    onCropEditUp,
    resetCrop,
    clearCropState,
  } = useCrop({
    mediaBoxRef,
    sourceType,
    videoRef,
    compositeRef,
    setKeyColor,
    setKeyMode,
    mode,
    setMode,
    invalidate,
  });

  const {
    hasVideo,
    duration,
    playing,
    recovering,
    recoverySlow,
    currentTime,
    loop,
    setLoop,
    trim,
    trimStart,
    trimEnd,
    videoName,
    trimBarRef,
    loadFile,
    togglePlay,
    onScrub,
    onScrubDown,
    onScrubUp,
    holdStep,
    playFromTrimStart,
    enableTrim,
    setTrimFromPlayhead,
    onTrimDown,
    onTrimMove,
    onTrimUp,
    onHandleDown,
    onHandleKey,
  } = useVideoSource(videoRef, {
    fps,
    freezeRef,
    sourceTypeRef,
    setDims,
    setError,
    onNewClip: () => {
      invalidate();
      setCrop(null);
    },
  });

  const {
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
  } = useImageCanvas(compositeRef, {
    sourceType,
    picking,
    cropMode,
    setError,
    onNewImage: ({ w, h }) => {
      setDims({ w, h });
      setCrop(null);
      invalidate();
    },
  });

  const ramp = RAMP_PRESETS[rampKey] || RAMP_PRESETS.classic;
  // The color edges actually render in (falls back to the text color when
  // unlinked), and whether that warrants a separate tinted edge layer. Splitting
  // only happens when edges are on AND their color truly differs from the text —
  // otherwise the output is the single-string default, byte-for-byte.
  const effectiveEdgeColor = edgeColor ?? fgColor;
  const splitEdges =
    edgeMode !== "off" &&
    effectiveEdgeColor.toLowerCase() !== fgColor.toLowerCase();
  // Whether the tinted edge overlay <pre> should exist: while editing when the
  // live render is split, or while playing a baked figure that carries its own
  // edge layer (its edgeFrames outlive later control changes).
  const showEdgeLayer = splitEdges || (mode === "baked" && !!baked?.edgeFrames);
  // Photos/drawings are single stills — one frame, no transport.
  const isStill = sourceType !== "video";
  // The crop changes what's converted, so the aspect the rows derive from
  // must be the cropped region's, not the full source's.
  const effW = crop ? dims.w * crop.w : dims.w;
  const effH = crop ? dims.h * crop.h : dims.h;
  const rows =
    resMode === "custom"
      ? Math.max(1, customRows)
      : computeRows(effW, effH, cols, cellAspect);
  const frameEstimate = Math.max(0, Math.round((trimEnd - trimStart) * fps));
  // Trimming deliberately keeps an existing bake ("what's baked remains as is,
  // only the live changes until it's baked again") — so the statusline says so
  // when the live range has drifted from the one the bake was made at.
  const bakeRangeStale =
    !!baked?.bakedRange &&
    (Math.abs(baked.bakedRange.start - trimStart) > 1e-3 ||
      Math.abs(baked.bakedRange.end - trimEnd) > 1e-3);
  // The two trim endpoints, so the handle markup is written once.
  const TRIM_HANDLES = [
    { which: "in", label: "trim in point", t: trimStart },
    { which: "out", label: "trim out point", t: trimEnd },
  ];

  // The image source is always renderable — a blank white canvas is a valid still.
  const hasSource = sourceType === "video" ? hasVideo : true;
  const fileName = sourceType === "video" ? videoName : imageName;

  const activeSource = () =>
    sourceType === "image" ? compositeRef.current : videoRef.current;
  const sourceReady = (el) => {
    if (!el) return false;
    if (sourceType === "video") return el.readyState >= 2;
    return true; // the composite canvas is always ready
  };

  // keep the rAF loop reading current settings without re-subscribing
  useEffect(() => {
    settingsRef.current = {
      cols,
      rows,
      ramp,
      invert,
      gamma,
      contrast,
      blockAvg,
      dither,
      edge: {
        mode: edgeMode,
        threshold: edgeThreshold,
        color: effectiveEdgeColor,
      },
      splitEdges,
      keyMode,
      keyThreshold,
      keyColor,
      crop,
    };
    // Paired with the source counter in useImageCanvas: together they tell the
    // live loop whether the next pass could possibly differ from the last.
    settingsVersionRef.current += 1;
  }, [
    cols,
    rows,
    ramp,
    invert,
    gamma,
    contrast,
    blockAvg,
    dither,
    edgeMode,
    edgeThreshold,
    effectiveEdgeColor,
    splitEdges,
    keyMode,
    keyThreshold,
    keyColor,
    crop,
  ]);

  // Ahead of the render loop on purpose: the loop needs to know which monitors
  // are actually on screen before it decides whether to run at all.
  const {
    miniShown,
    miniVisible,
    miniDismissed,
    setMiniDismissed,
    miniElRef,
    miniPosStyle,
    onMiniDown,
    onMiniMove,
    onMiniUp,
    onMiniClick,
  } = useMiniMonitor({ monitorRef, hasSource, drawFullscreen });

  // Both monitors are off screen — the main one has scrolled away and the mini
  // isn't showing (dismissed, or simply a viewport that has no mini). Converting
  // frames into two <pre>s nobody can see is the one cost with no upside.
  const previewHidden = miniVisible && !miniShown;

  // The loop's dirty check treats a video's currentTime as its frame identity,
  // which two events can defeat by landing on the SAME time with different
  // pixels behind it: loading a second clip (both start at 0) and a decoder
  // recovery (it seeks back to exactly where it died). Both change this, and a
  // change re-subscribes the loop, which forces one unconditional repaint.
  const videoEpoch = `${videoName}|${duration}|${recovering}`;

  const { previewRef, previewEdgeRef, miniPreviewRef, miniPreviewEdgeRef } =
    useAsciiPreviewLoop({
      hasSource,
      sourceType,
      mode,
      baked,
      settingsRef,
      canvasRef,
      activeSource,
      sourceReady,
      sourceVersionRef,
      settingsVersionRef,
      previewHidden,
      miniShown,
      videoEpoch,
    });

  const {
    canVideo,
    videoExt,
    videoProgress,
    exportJson,
    exportPng,
    exportVideo,
    shareOpen,
    setShareOpen,
    pngOpen,
    setPngOpen,
  } = useExport({ baked, setError });

  // ── fit the frame into the monitor ────────────────────────────
  // The <pre> renders at cols × pixel-size, which easily exceeds the
  // monitor at higher grids. Scale it down so the whole frame is always
  // visible (never clipped, never upscaled past the chosen pixel size).
  // offsetWidth/Height ignore the applied transform, so measuring stays
  // stable and the ResizeObserver can't feed back into itself. The same
  // measurement is the "real pixels" readout in the resolution block.
  const fit = () => {
    const screen = screenRef.current;
    const pre = previewRef.current;
    if (!screen || !pre) return;
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
        : { w: Math.round(natW), h: Math.round(natH) },
    );
  };
  const fitRef = useLiveRef(fit);

  // The observer is bound to the two ELEMENTS, which never change while the
  // monitor is mounted — so it is built once, not per settings value. Keying
  // it on cols/rows/cellPx meant a crop drag (rows is derived from the crop)
  // disconnected and rebuilt it on every pointermove, each rebuild firing an
  // immediate fit() that read four layout properties.
  useEffect(() => {
    const screen = screenRef.current;
    const pre = previewRef.current;
    if (!screen || !pre) return;
    const ro = new ResizeObserver(() => fitRef.current());
    ro.observe(screen);
    ro.observe(pre);
    return () => ro.disconnect();
  }, [hasSource, fitRef]);

  // A settings change resizes the <pre>, which the observer reports on its own
  // — but a frame later. Measuring here too keeps the readout and the scale in
  // step with the control you just moved.
  useEffect(() => {
    fitRef.current();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasSource, sourceType, mode, cols, rows, cellPx, baked, miniShown]);

  // ── switch source type ────────────────────────────────────────
  const switchSource = (type) => {
    setSourceType(type);
    invalidate();
    setError("");
    clearCropState();
    // Point the rows calc at the new source's dimensions.
    if (type === "image") {
      const c = compositeRef.current;
      setDims(c ? { w: c.width, h: c.height } : { w: PAPER_W, h: PAPER_H });
    } else {
      const v = videoRef.current;
      setDims(
        v && v.videoWidth
          ? { w: v.videoWidth, h: v.videoHeight }
          : { w: 0, h: 0 },
      );
    }
  };

  // One intake for both media kinds: sniff the MIME and route to the right
  // pipeline, switching the source type when the kind changes.
  const loadAny = (file) => {
    if (!file) return;
    if (file.type.startsWith("video/")) {
      if (sourceType !== "video") switchSource("video");
      loadFile(file);
    } else if (file.type.startsWith("image/")) {
      if (sourceType !== "image") switchSource("image");
      loadImage(file);
    } else {
      setError(
        `"${file.name}" isn't an image or video — try jpg, png, webp, mp4, mov, or webm`,
      );
    }
  };
  const startBlankPaper = () => {
    if (sourceType !== "image") switchSource("image");
    setImageIntro(false);
  };
  const onDropAny = (e) => {
    e.preventDefault();
    setDragOver(false);
    loadAny(e.dataTransfer.files?.[0]);
  };

  // Drag-resize the stage from the grip under it (clamped 200–640px).
  const onStageResizeDown = (e) => {
    e.preventDefault();
    stageDragRef.current = { startY: e.clientY, startH: stageH };
    capturePointer(e);
  };
  const onStageResizeMove = (e) => {
    const drag = stageDragRef.current;
    if (!drag) return;
    const next = Math.round(drag.startH + (e.clientY - drag.startY));
    setStageH(clamp(next, 200, 640));
  };
  const onStageResizeUp = () => {
    stageDragRef.current = null;
  };

  // Each cell renders at exactly cellPx — a direct handle on block size.
  // Lower `cols` (fewer, fatter cells) + a high pixel size = chunky pixels.
  //
  // …except the on-screen <pre> must never actually be laid out that big. At
  // high cols × cellPx × spacing the natural size reaches 10–30k real pixels;
  // the fit transform only shrinks it VISUALLY, so the browser still has to
  // rasterize a layer that large — past GPU texture limits it drops tiles and
  // whole parts of the page flash/blank (worst on Safari). Clamp the displayed
  // font instead: letter-spacing (em) and line-height (unitless) scale with it,
  // so the grid stays proportionally identical and previewScale compensates —
  // in the clamped regime the pre dwarfs the monitor, so the fitted result is
  // pixel-identical. Exports are untouched (they render their own canvas from
  // the true cellPx), only the readout must divide the measurement back.
  const MAX_PRE_PX = 4000;
  const estNatW = cols * cellPx * MONO_ADVANCE;
  const estNatH = rows * cellPx;
  const fitK = Math.min(
    1,
    MAX_PRE_PX / Math.max(estNatW, 1),
    MAX_PRE_PX / Math.max(estNatH, 1),
  );
  const previewFontSize = `${cellPx * fitK}px`;

  // "real pixels" readout: measured when a source renders; estimated before
  // (monospace advance ≈ 0.6 × font size — only the height is exact). The
  // measurement sees the clamped font, so scale it back to true export size.
  const readoutW =
    hasSource && outputPx
      ? Math.round(outputPx.w / fitK)
      : Math.round(cols * cellPx * MONO_ADVANCE);
  const readoutH =
    hasSource && outputPx ? Math.round(outputPx.h / fitK) : rows * cellPx;

  // Image source shows the upload-first intro until a photo lands or the user
  // opts into blank paper — the canvas/crop/draw chrome waits behind it.
  const showImageIntro = sourceType === "image" && !hasPhoto && imageIntro;
  const hasMedia = sourceType === "video" ? hasVideo : !showImageIntro;
  // Drawing is on for blank paper always, and for a photo only when "draw on photo" is on.
  const drawEnabled =
    sourceType === "image" && !showImageIntro && (!hasPhoto || drawOnPhoto);
  const overlayActive = hasMedia && (cropMode || picking);
  const shownRect = cropDraft || crop;

  // Mini-monitor: fit the same cols×rows frame into a small fixed box, reusing
  // the already-measured render size (no extra observer).
  //
  // It renders at its OWN font size rather than sharing the main monitor's and
  // shrinking it with transform. Sharing meant a 148px box laid out and
  // rasterized a text layer up to MAX_PRE_PX (4000px) across and scaled it by
  // ~0.12 — precisely the GPU-texture cost the clamp above exists to avoid,
  // paid a second time, 30×/s, on the device least able to afford it. Render
  // at MINI_SS× the display box instead (enough oversampling that the residual
  // downscale still reads crisp) and scale that: same picture, ~20× less layer.
  const MINI_W = 140,
    MINI_H = 108;
  const MINI_SS = 3;
  const miniFit = outputPx
    ? Math.min(1, MINI_W / outputPx.w, MINI_H / outputPx.h)
    : 0.12;
  const miniFontRatio = Math.min(1, miniFit * MINI_SS);
  const miniFontSize = `${cellPx * fitK * miniFontRatio}px`;
  const miniScale = miniFit / miniFontRatio;

  // Everything bake() needs to sample the exact preview: the settingsRef the
  // live loop reads plus the source handles and figure metadata.
  const bakeCtx = {
    canvasRef,
    settingsRef,
    videoRef,
    activeSource,
    sourceReady,
    isStill,
    rows,
    cols,
    cellPx,
    fps,
    duration,
    trimStart,
    trimEnd,
    fileName,
    style: {
      font: fontKey,
      background: bgColor,
      color: fgColor,
      edgeColor: splitEdges ? effectiveEdgeColor : undefined,
    },
  };

  // One palette row — shades, then cut/fill/erase as inline "colors"/chips —
  // plus the size slider. Rendered both in the rail flyout and the fullscreen
  // bar, so it's defined once (closes over the shared state). "draw" mode has
  // no button of its own: picking any shade returns to it.
  const toolRow = (
    <div className="swatches" role="group" aria-label="draw tools">
      {BRUSH_SHADES.map((c) => (
        <button
          key={c}
          className={`swatch ${(tool === "draw" || tool === "fill") && brushShade === c ? "is-active" : ""}`}
          style={{ background: c }}
          // pick a shade for draw/fill; if erase/cut is active, jump to draw
          onClick={() => {
            setBrushShade(c);
            if (tool !== "fill") setTool("draw");
          }}
          aria-label={`brush shade ${c}`}
        />
      ))}
      <button
        className={`swatch swatch--cut ${tool === "cut" ? "is-active" : ""}`}
        onClick={() => setTool(tool === "cut" ? "draw" : "cut")}
        aria-pressed={tool === "cut"}
        aria-label="cut tool"
        title="remove a section of the photo — cut areas become transparent"
      />
      <span className="swatches__divider" aria-hidden="true" />
      <button
        className={`tool-chip ${tool === "fill" ? "is-active" : ""}`}
        onClick={() => setTool(tool === "fill" ? "draw" : "fill")}
        aria-pressed={tool === "fill"}
        aria-label="fill tool"
        title="bucket-fill the clicked region with the selected shade"
      >
        <FillIcon />
      </button>
      <button
        className={`tool-chip ${tool === "erase" ? "is-active" : ""}`}
        onClick={() => setTool(tool === "erase" ? "draw" : "erase")}
        aria-pressed={tool === "erase"}
        aria-label="erase tool"
        title="erase ink & cuts"
      >
        <EraserIcon />
      </button>
      <span className="swatches__divider" aria-hidden="true" />
      <button
        className="tool-chip"
        onClick={undo}
        disabled={!canUndo}
        aria-label="undo draw action"
        title="undo draw action"
      >
        <UndoIcon />
      </button>
      <button
        className="tool-chip"
        onClick={redo}
        disabled={!canRedo}
        aria-label="redo draw action"
        title="redo"
      >
        <RedoIcon />
      </button>
      <button
        className="tool-chip"
        onClick={trashAll}
        aria-label="clear drawing and restore photo"
        title="clear drawing & restore photo"
      >
        <TrashIcon />
      </button>
    </div>
  );
  const toolSlider =
    tool === "fill" ? (
      <Slider
        label="fill tolerance"
        value={fillTolerance}
        min={0}
        max={1}
        step={0.01}
        onChange={setFillTolerance}
        fixed={2}
        suffix=" · higher spreads more"
      />
    ) : (
      <Slider
        label="brush"
        value={brush}
        min={2}
        max={80}
        step={1}
        onChange={setBrush}
        suffix="px"
      />
    );
  const drawControls = (
    <>
      <div className="draw-tools__row">{toolRow}</div>
      {toolSlider}
    </>
  );

  // The arm → confirm crop flow, rendered in both the source toolbar (while
  // drawing) and the fullscreen drawbar.
  const armCropButton = (btnClass) => (
    <button
      className={btnClass}
      onClick={() => {
        if (cropMode) {
          setCropMode(false); // confirm → back to drawing
        } else {
          setCropMode(true); // arm / re-open the editor
          setPicking(false);
        }
      }}
      title={
        cropMode
          ? "confirm the crop and return to drawing"
          : crop
            ? "edit the crop region"
            : "drag a rectangle on the preview to crop"
      }
    >
      {cropMode ? "✓ done" : crop ? "▦ edit crop" : "▦ crop"}
    </button>
  );

  return (
    <div className="create-page" ref={pageRef}>
      <div className="app">
        <header className="masthead">
          <Link to={adminSecret ? "/admin" : "/"} className="home-link">
            {adminSecret ? "← moderation" : "← Home"}
          </Link>
          {/* Single slim row — the tool below should own the viewport, so no
              chapter rows here: just the pill and the squeezed title. */}
          <h1 className="chapter-band__line masthead__title">
            ASCII media converter{adminSecret ? " · admin" : ""}
          </h1>
        </header>

        <div className="workbench">
          {/* left rail: settings by category */}
          <aside className="rail">
            <SettingsBlock
              label="resolution"
              open={openBlocks.resolution}
              onToggle={() => toggleBlock("resolution")}
            >
              <SegmentedControl
                value={cols}
                onChange={setCols}
                options={Object.entries(QUALITY_PRESETS).map(([k, v]) => ({
                  value: v,
                  label: k,
                }))}
              />
              <Slider
                label="fine tune"
                value={cols}
                min={30}
                max={320}
                step={1}
                onChange={setCols}
                suffix=" cols"
              />
              <SegmentedControl
                value={resMode}
                onChange={(k) => {
                  // seed the explicit height from the current aspect-derived rows
                  // so switching to custom doesn't make the picture jump.
                  if (k === "custom") setCustomRows(rows);
                  setResMode(k);
                }}
                options={[
                  { value: "auto", label: "auto height" },
                  { value: "custom", label: "custom height" },
                ]}
              />
              {resMode === "custom" && (
                <Slider
                  label="rows"
                  value={customRows}
                  min={10}
                  max={240}
                  step={1}
                  onChange={setCustomRows}
                />
              )}
              {/* cell aspect only feeds the auto rows calc — inert under custom */}
              {resMode === "auto" && (
                <Slider
                  label="cell aspect"
                  value={cellAspect}
                  min={1.4}
                  max={2.6}
                  step={0.1}
                  onChange={setCellAspect}
                  fixed={1}
                />
              )}
              <Slider
                label="character size"
                value={cellPx}
                min={6}
                max={48}
                step={1}
                onChange={setCellPx}
                suffix="px"
              />
              <div className="res-readout">
                {effW > 0
                  ? `output ≈ ${readoutW} × ${readoutH} px · ${cols} × ${rows} characters`
                  : "load a source to size the output"}
              </div>
            </SettingsBlock>

            {sourceType === "video" && (
              <SettingsBlock
                label="playback"
                open={openBlocks.playback}
                onToggle={() => toggleBlock("playback")}
              >
                <Slider
                  label="fps"
                  value={fps}
                  min={5}
                  max={30}
                  step={1}
                  onChange={setFps}
                />
                <p className="hint">
                  frames sampled per second of video — lower = smaller export
                </p>
              </SettingsBlock>
            )}

            {/* characters + typography merged: what the ascii is drawn with —
                glyph ramp, font, colors. Spacing/line-height knobs removed
                (cell aspect owns proportions at the sampling stage). */}
            <SettingsBlock
              label="characters"
              open={openBlocks.characters}
              onToggle={() => toggleBlock("characters")}
            >
              <div className="ramps">
                {Object.entries(RAMP_PRESETS).map(([k, v]) => (
                  <button
                    key={k}
                    className={`ramp ${rampKey === k ? "is-active" : ""}`}
                    onClick={() => setRampKey(k)}
                  >
                    <span className="ramp-name">{k}</span>
                    <span className="ramp-chars">{v}</span>
                  </button>
                ))}
              </div>
              <div className="field-label">font</div>
              <SegmentedControl
                value={fontKey}
                onChange={setFontKey}
                options={Object.keys(FONT_STACKS).map((k) => ({
                  value: k,
                  label: k,
                }))}
              />
              <div className="keycolor">
                <span className="keycolor-label">text</span>
                <input
                  type="color"
                  className="keycolor-swatch"
                  value={fgColor}
                  onChange={(e) => setFgColor(e.target.value)}
                  aria-label="text color"
                />
                <span className="keycolor-label">background</span>
                <input
                  type="color"
                  className="keycolor-swatch"
                  value={bgColor}
                  onChange={(e) => setBgColor(e.target.value)}
                  aria-label="background color"
                />
                <button
                  className="keymode"
                  onClick={() => {
                    setFgColor(STYLE_DEFAULTS.color);
                    setBgColor(STYLE_DEFAULTS.background);
                  }}
                  title="back to white on black"
                >
                  reset
                </button>
              </div>
            </SettingsBlock>

            <SettingsBlock
              label="effects"
              open={openBlocks.effects}
              onToggle={() => toggleBlock("effects")}
            >
              <Slider
                label="gamma"
                value={gamma}
                min={0.4}
                max={2.4}
                step={0.1}
                onChange={setGamma}
                fixed={1}
              />
              <Slider
                label="contrast"
                value={contrast}
                min={0.5}
                max={2}
                step={0.05}
                onChange={setContrast}
                fixed={2}
              />
              <ToggleRow checked={invert} onChange={setInvert}>
                invert <span className="muted">(dark ink on light bg)</span>
              </ToggleRow>
              <ToggleRow checked={blockAvg} onChange={setBlockAvg}>
                block averaging{" "}
                <span className="muted">({SUPERSAMPLE}× supersample)</span>
              </ToggleRow>
              <div className="field-label">dithering</div>
              <SegmentedControl
                value={dither}
                onChange={setDither}
                options={[
                  { value: "off", label: "off" },
                  { value: "floyd", label: "floyd" },
                  { value: "bayer", label: "bayer" },
                ]}
              />
            </SettingsBlock>
          </aside>

          {/* main: source panel + preview monitor (hero) */}
          <main className="monitor-wrap">
            <div className="stage-row">
              <section className="block source-panel">
                <div className="block-label">source</div>
                <div className="source-body">
                  <div className="source-toolbar">
                    {/* the source kind is auto-detected from whatever file lands
                      in loadAny; both source elements stay mounted so their
                      refs exist and each source's state persists across swaps. */}
                    <div className="toolbar-right">
                      {hasMedia &&
                        (drawEnabled ? (
                          // While drawing, the live crop editor would sit over the
                          // canvas — so cropping is an explicit arm → confirm step
                          // that puts the overlay away and hands the pointer back.
                          <>
                            {armCropButton(
                              `keymode ${cropMode ? "is-active" : ""}`,
                            )}
                            {crop && (
                              <button
                                className="keymode"
                                onClick={resetCrop}
                                title="clear the crop"
                              >
                                ✕ reset crop
                              </button>
                            )}
                          </>
                        ) : (
                          <button
                            className={`keymode ${cropMode && !crop ? "is-active" : ""}`}
                            onClick={() => {
                              if (crop) {
                                resetCrop();
                              } else {
                                setCropMode((m) => !m);
                                setPicking(false);
                              }
                            }}
                            title={
                              crop
                                ? "clear the crop"
                                : "drag a rectangle on the preview — adjust it with the handles, the ascii follows live"
                            }
                          >
                            {crop ? "✕ reset crop" : "▦ crop"}
                          </button>
                        ))}
                      {drawEnabled && (
                        <button
                          className="keymode"
                          onClick={() => setDrawFullscreen(true)}
                          title="fullscreen drawing"
                          aria-label="fullscreen drawing"
                        >
                          ⛶
                        </button>
                      )}
                    </div>
                  </div>

                  <div
                    className={`source-stage ${drawFullscreen ? "is-fullscreen" : ""}`}
                    style={{ "--stage-h": `${stageH}px` }}
                    onDragOver={(e) => {
                      e.preventDefault();
                      setDragOver(true);
                    }}
                    onDragLeave={() => setDragOver(false)}
                    onDrop={onDropAny}
                  >
                    <div
                      className={`stage-media ${sourceType === "image" ? "is-image" : ""}`}
                      ref={mediaBoxRef}
                    >
                      <video
                        ref={videoRef}
                        className="source-vid"
                        muted
                        playsInline
                        // No native `loop`: it wraps to 0, not to the in point,
                        // so the trim effect owns looping in every case.
                        style={{
                          display:
                            sourceType === "video" && hasVideo && !recovering
                              ? "block"
                              : "none",
                        }}
                      />
                      {/* Stand-in for the video while it reloads after a
                          decoder failure. It carries the frame's real pixel
                          dimensions, so it holds the stage box open where the
                          stripped <video> would collapse to 300×150 and drag
                          every section below it up ~90px. */}
                      <canvas
                        ref={freezeRef}
                        className="stage-freeze"
                        aria-hidden="true"
                        style={{
                          display:
                            sourceType === "video" && hasVideo && recovering
                              ? "block"
                              : "none",
                        }}
                      />
                      {recoverySlow && (
                        <p className="stage-note" role="status">
                          ↻ reloading the clip…
                        </p>
                      )}
                      <canvas
                        ref={compositeRef}
                        className={`draw-pad ${!drawEnabled ? "is-locked" : ""} ${drawEnabled && tool !== "fill" ? "brush-active" : ""}`}
                        style={{
                          display:
                            sourceType === "image" && !showImageIntro
                              ? "block"
                              : "none",
                        }}
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
                          className={`stage-overlay ${picking ? "is-picking" : ""}`}
                          onPointerDown={onOverlayDown}
                          onPointerMove={onOverlayMove}
                          onPointerUp={onOverlayUp}
                          onPointerCancel={onOverlayUp}
                        />
                      )}
                      {/* Paint-style crop editor: move the rect, resize from any
                        handle — hidden while a fresh marquee is being drawn or
                        the eyedropper needs the click (even inside the rect) */}
                      {cropMode &&
                        crop &&
                        !cropDraft &&
                        hasMedia &&
                        !picking && (
                          <div
                            className="crop-editor"
                            style={{
                              left: `${crop.x * 100}%`,
                              top: `${crop.y * 100}%`,
                              width: `${crop.w * 100}%`,
                              height: `${crop.h * 100}%`,
                            }}
                            onPointerDown={onCropEditDown("move")}
                            onPointerMove={onCropEditMove}
                            onPointerUp={onCropEditUp}
                            onPointerCancel={onCropEditUp}
                          >
                            {CROP_HANDLES.map(([role, lx, ty]) => (
                              <div
                                key={role}
                                className={`crop-handle crop-handle--${role}`}
                                style={{ left: `${lx}%`, top: `${ty}%` }}
                                onPointerDown={onCropEditDown(role)}
                              />
                            ))}
                          </div>
                        )}
                    </div>

                    {/* one intake for both kinds — the file's MIME decides the
                      pipeline; blank paper is the no-file opt-in underneath */}
                    {((sourceType === "video" && !hasVideo) ||
                      showImageIntro) && (
                      <label className={`dropzone ${dragOver ? "is-over" : ""}`}>
                        <input
                          type="file"
                          accept="image/*,video/*"
                          onChange={(e) => loadAny(e.target.files?.[0])}
                          hidden
                        />
                        <div className="dropzone-art">{"[  +  ]"}</div>
                        <div>
                          drop a photo or video here
                          <br />
                          or click to choose
                        </div>
                        <div className="hint">
                          jpg · png · webp · mp4 · mov · webm
                        </div>
                        <button
                          type="button"
                          className="btn dropzone-alt"
                          onClick={(e) => {
                            e.preventDefault();
                            startBlankPaper();
                          }}
                        >
                          ✎ or start with blank paper
                        </button>
                      </label>
                    )}

                    {!drawFullscreen && (
                      <button
                        className="stage-resize"
                        aria-label="resize preview"
                        title="drag to resize the preview"
                        onPointerDown={onStageResizeDown}
                        onPointerMove={onStageResizeMove}
                        onPointerUp={onStageResizeUp}
                        onPointerCancel={onStageResizeUp}
                      />
                    )}
                  </div>

                  {/* video transport */}
                  {sourceType === "video" && hasVideo && (
                    <>
                      <div className="filename" title={videoName}>
                        {videoName}
                      </div>
                      <div className="transport">
                        <button
                          className="tbtn"
                          {...holdStep(-1)}
                          aria-label="back one frame"
                          title="back one frame — hold to keep going"
                        >
                          ‹
                        </button>
                        <button
                          className="tbtn tbtn-play"
                          onClick={togglePlay}
                          aria-label={playing ? "pause" : "play"}
                        >
                          {playing ? "❚❚" : "▶"}
                        </button>
                        <button
                          className="tbtn"
                          {...holdStep(1)}
                          aria-label="forward one frame"
                          title="forward one frame — hold to keep going"
                        >
                          ›
                        </button>
                        {/* range-relative: with trim on, the cut footage stops
                            existing as far as the transport is concerned */}
                        <span
                          className="time-readout"
                          title={`${fmtTime(currentTime, 2)} of ${fmtTime(duration, 2)} in the full clip`}
                        >
                          {fmtTime(Math.max(0, currentTime - trimStart), 2)} /{" "}
                          {fmtTime(Math.max(0, trimEnd - trimStart), 2)}
                        </span>
                        <input
                          className="scrub"
                          type="range"
                          min={trimStart}
                          max={trimEnd || 0}
                          step="0.01"
                          value={Math.min(
                            Math.max(currentTime, trimStart),
                            trimEnd || 0,
                          )}
                          onChange={onScrub}
                          onPointerDown={onScrubDown}
                          onPointerUp={onScrubUp}
                          onPointerCancel={onScrubUp}
                          onBlur={onScrubUp}
                          aria-label="seek video"
                        />
                        <button
                          className={`tbtn tbtn-loop ${loop ? "on" : ""}`}
                          onClick={() => setLoop((l) => !l)}
                          aria-pressed={loop}
                          title="repeat playback to check the loop"
                        >
                          ⟳ loop
                        </button>
                      </div>

                      <SourceButton onFile={loadAny} />
                    </>
                  )}

                  {/* image tools: photo + drawing share one canvas */}
                  {sourceType === "image" && !showImageIntro && (
                    <div className="draw-tools">
                      {/* with a photo loaded, the pencil toggles draw-on-photo;
                          the palette flies out to its right while it's on */}
                      <div className="draw-tools__row draw-tools__row--main">
                        {hasPhoto && (
                          <button
                            className={`draw-launch ${drawOnPhoto ? "is-active" : ""}`}
                            aria-pressed={drawOnPhoto}
                            aria-label="draw on photo"
                            title="draw on photo"
                            onClick={() => setDrawOnPhoto(!drawOnPhoto)}
                          >
                            <PencilIcon size={15} />
                          </button>
                        )}
                        {drawEnabled && toolRow}
                      </div>
                      {drawEnabled && toolSlider}
                      <div className="draw-tools__row">
                        <div className="draw-actions">
                          <SourceButton onFile={loadAny} hasSource={hasPhoto} />
                        </div>
                      </div>
                      {hasPhoto && (
                        <div className="filename" title={imageName}>
                          {imageName}
                        </div>
                      )}
                    </div>
                  )}

                  {error && (
                    <p className="source-error" role="alert">
                      ⚠ {error}
                    </p>
                  )}

                  {/* trim — its own section, same anatomy as the two below it.
                      Off = the whole clip; only [in, out] previews-in-loop and
                      bakes. The toggle IS the reset, so there's no ✕. */}
                  {sourceType === "video" && hasVideo && (
                    <div className="keyzone trimzone">
                      <div className="keyzone__row">
                        <ToggleRow checked={trim !== null} onChange={enableTrim}>
                          <span className="field-label">trim</span>
                        </ToggleRow>
                        {trim && (
                          <>
                            <button
                              className="keymode"
                              onClick={() => setTrimFromPlayhead("in")}
                              title="set the in point to the playhead"
                            >
                              [ in
                            </button>
                            <button
                              className="keymode"
                              onClick={() => setTrimFromPlayhead("out")}
                              title="set the out point to the playhead"
                            >
                              out ]
                            </button>
                            <span className="time-readout">
                              {fmtTime(trimStart, 2)}–{fmtTime(trimEnd, 2)} ·{" "}
                              {frameEstimate}f
                            </span>
                          </>
                        )}
                      </div>
                      {trim && (
                        <div className="zone-body">
                          <div
                            className="trimbar"
                            ref={trimBarRef}
                            onPointerDown={onTrimDown}
                            onPointerMove={onTrimMove}
                            onPointerUp={onTrimUp}
                            onPointerCancel={onTrimUp}
                            role="group"
                            aria-label="trim range"
                          >
                            <div
                              className="trimbar__range"
                              style={{
                                left: `${duration ? (trimStart / duration) * 100 : 0}%`,
                                width: `${duration ? ((trimEnd - trimStart) / duration) * 100 : 100}%`,
                              }}
                            />
                            <div
                              className="trimbar__played"
                              style={{
                                left: `${duration ? (Math.min(currentTime, duration) / duration) * 100 : 0}%`,
                              }}
                            />
                            {TRIM_HANDLES.map(({ which, label, t }) => (
                              <button
                                key={which}
                                type="button"
                                className={`trimbar__handle trimbar__handle--${which}`}
                                style={{
                                  left: `${duration ? (t / duration) * 100 : which === "in" ? 0 : 100}%`,
                                }}
                                onPointerDown={onHandleDown(which)}
                                onKeyDown={onHandleKey(which)}
                                role="slider"
                                aria-label={label}
                                aria-valuemin={0}
                                aria-valuemax={duration}
                                aria-valuenow={t}
                                aria-valuetext={fmtTime(t, 2)}
                              />
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* background removal — one keyed color (RGB distance): the
                      wheel or the eyedropper picks it, everything inline with
                      the toggle; the old green/black/white presets are gone */}
                  {hasMedia && (
                    <div className="keyzone">
                      <div className="keyzone__row">
                        <ToggleRow
                          checked={keyMode !== "off"}
                          onChange={(on) => {
                            setKeyMode(on ? "custom" : "off");
                            if (!on) setPicking(false);
                          }}
                        >
                          <span className="field-label">background removal</span>
                        </ToggleRow>
                        {keyMode !== "off" && (
                          <>
                            <input
                              type="color"
                              className="keycolor-swatch"
                              value={
                                /^#[0-9a-f]{6}$/i.test(keyColor)
                                  ? keyColor
                                  : "#000000"
                              }
                              onChange={(e) => setKeyColor(e.target.value)}
                              aria-label="color to remove"
                              title="the color to remove"
                            />
                            <button
                              className={`keymode ${picking ? "is-active" : ""}`}
                              onClick={() => setPicking((p) => !p)}
                              title="click a pixel on the preview to key out that color"
                            >
                              ⌖ pick
                            </button>
                          </>
                        )}
                      </div>
                      {keyMode !== "off" && (
                        <div className="zone-body">
                          <Slider
                            label="threshold"
                            value={keyThreshold}
                            min={0}
                            max={1}
                            step={0.02}
                            onChange={setKeyThreshold}
                            fixed={2}
                            suffix=" · higher removes more"
                          />
                        </div>
                      )}
                    </div>
                  )}

                  {/* edge detection — strong luma gradients become direction glyphs;
                      the two modes sit inline with the toggle */}
                  {hasMedia && (
                    <div className="keyzone">
                      <div className="keyzone__row">
                        <ToggleRow
                          checked={edgeMode !== "off"}
                          onChange={(on) => {
                            if (on) {
                              setEdgeMode(lastEdgeModeRef.current);
                            } else {
                              lastEdgeModeRef.current = edgeMode;
                              setEdgeMode("off");
                            }
                          }}
                        >
                          <span className="field-label">edge detection</span>
                        </ToggleRow>
                        {edgeMode !== "off" && (
                          <SegmentedControl
                            value={edgeMode}
                            onChange={setEdgeMode}
                            options={[
                              { value: "overlay", label: "overlay" },
                              { value: "only", label: "edges only" },
                            ]}
                          />
                        )}
                      </div>
                      {edgeMode !== "off" && (
                        <div className="zone-body">
                          <Slider
                            label="edge threshold"
                            value={edgeThreshold}
                            min={0.05}
                            max={0.8}
                            step={0.01}
                            onChange={setEdgeThreshold}
                            fixed={2}
                          />
                          <div className="keycolor">
                            <span className="keycolor-label">edge color</span>
                            <input
                              type="color"
                              className="keycolor-swatch"
                              value={effectiveEdgeColor}
                              onChange={(e) => setEdgeColor(e.target.value)}
                              aria-label="edge color"
                            />
                            <button
                              className="keymode"
                              onClick={() => setEdgeColor(null)}
                              disabled={edgeColor === null}
                              title="match the text color"
                            >
                              {edgeColor === null ? "matches text" : "match text"}
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </section>

              {/* monitor + bake/export bar share a column so the actions sit
                  right under the ASCII view and pin with it on desktop */}
              <div className="monitor-col">
                <div className="monitor" ref={monitorRef}>
                  <div
                    className={`statusline ${mode === "baked" ? "is-baked" : ""}`}
                  >
                    <span className="dot" />
                    {hasSource
                      ? mode === "baked"
                        ? isStill
                          ? `still · 1 frame · ${cols}×${rows}`
                          : `baked · ${baked.frames.length} frames · ${cols}×${rows} @ ${baked.fps}fps${bakeRangeStale ? " · trim changed" : ""}`
                        : isStill
                          ? `still · ${cols}×${rows}`
                          : `live · ${cols}×${rows} · ~${frameEstimate} frames @ ${fps}fps`
                      : "no signal"}
                    {hasSource && baked && (
                      <span className="toggle-mode">
                        <button
                          className={mode === "live" ? "on" : ""}
                          onClick={() => {
                            setMode("live");
                            // The bake left the video paused on its last
                            // sampled frame — rewind to the in point and run,
                            // so live view shows motion rather than a still.
                            if (!isStill && hasVideo) playFromTrimStart();
                          }}
                        >
                          live
                        </button>
                        <button
                          className={mode === "baked" ? "on" : ""}
                          onClick={() => setMode("baked")}
                        >
                          baked
                        </button>
                      </span>
                    )}
                  </div>
                  <div
                    className={`screen ${keyMode !== "off" ? "is-keying" : ""}`}
                    ref={screenRef}
                    style={
                      bgColor !== STYLE_DEFAULTS.background
                        ? { background: bgColor }
                        : undefined
                    }
                  >
                    {hasSource ? (
                      <PreviewStack
                        baseRef={previewRef}
                        edgeRef={previewEdgeRef}
                        showEdge={showEdgeLayer}
                        fontSize={previewFontSize}
                        fontFamily={FONT_STACKS[fontKey]}
                        color={fgColor}
                        edgeColor={effectiveEdgeColor}
                        scale={previewScale}
                      />
                    ) : (
                      <div className="noise">drop a clip to begin</div>
                    )}
                    <div className="scanline" aria-hidden="true" />
                  </div>
                </div>

                {/* bake + export bar */}
                <div className="actions">
                  <button
                    className="btn primary"
                    onClick={() => bake(bakeCtx)}
                    disabled={!hasSource || baking}
                  >
                    {baking
                      ? `baking… ${bakeProgress}%`
                      : isStill
                        ? "● bake still"
                        : "● bake animation"}
                  </button>
                  <button
                    className="btn"
                    onClick={exportJson}
                    disabled={!baked || baking}
                  >
                    ↓ json
                  </button>
                  <button
                    className="btn"
                    onClick={exportPng}
                    disabled={!baked || baking}
                  >
                    ↓ png
                  </button>
                  {canVideo && !isStill && (
                    <button
                      className="btn"
                      onClick={exportVideo}
                      disabled={!baked || baking || videoProgress !== null}
                    >
                      {videoExportLabel(videoProgress, videoExt)}
                    </button>
                  )}
                  <button
                    className="btn"
                    onClick={() => setShareOpen(true)}
                    disabled={!baked || baking}
                  >
                    ↑ share to gallery
                  </button>
                  <div className="readout">
                    {baked
                      ? `raw ${formatBytes(sizes.raw)} · gzip ~${formatBytes(sizes.gz)}`
                      : isStill
                        ? "bake to export the still"
                        : frameEstimate > 480
                          ? `heads up: ~${frameEstimate} frames is a lot — lower fps or trim`
                          : "bake to measure output size"}
                  </div>
                  {/* always in flow — appearing/disappearing used to add a wrapped
                      row to the actions bar and jolt the layout on every bake */}
                  <div className={`progress ${baking ? "is-active" : ""}`}>
                    {/* scaleX, not width: this bar advances while the bake is
                        saturating the main thread, and a width tween relayouts
                        on every step where a transform only composites */}
                    <span
                      style={{
                        transform: `scaleX(${baking ? bakeProgress / 100 : 0})`,
                      }}
                    />
                  </div>
                </div>
              </div>
            </div>
          </main>
        </div>

        <canvas ref={canvasRef} style={{ display: "none" }} />

        {/* brush-size ring that follows the pointer over the canvas (brush tools only) */}
        {sourceType === "image" && drawEnabled && tool !== "fill" && (
          <div
            ref={brushCursorRef}
            className="brush-cursor"
            aria-hidden="true"
          />
        )}

        {/* Mobile only (CSS-gated): a floating live preview that appears once the
            main monitor scrolls out of view. Tap to jump back up, drag to move,
            × to dismiss (it re-arms when you scroll back to the monitor). */}
        <div
          ref={miniElRef}
          className={`mini-monitor ${miniShown ? "is-visible" : ""} ${mode === "baked" ? "is-baked" : ""} ${drawFullscreen ? "is-fs" : ""}`}
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
          {/* Mounted only while it is actually on screen. Left mounted, its
              <pre> collected a full-grid textContent write 30×/s on every
              device — including desktop, where it is never visible. */}
          {miniShown && (
            <PreviewStack
              mini
              baseRef={miniPreviewRef}
              edgeRef={miniPreviewEdgeRef}
              showEdge={showEdgeLayer}
              fontSize={miniFontSize}
              fontFamily={FONT_STACKS[fontKey]}
              color={fgColor}
              edgeColor={effectiveEdgeColor}
              scale={miniScale}
            />
          )}
          <span className="mini-dot" aria-hidden="true" />
          <button
            type="button"
            className="mini-close"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              setMiniDismissed(true);
            }}
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
              {/* same arm → confirm crop flow as the windowed draw toolbar: the
                  overlay/handles live inside .stage-media, which fullscreens
                  with the stage, so the existing pointer math works unchanged */}
              {armCropButton(`btn ${cropMode ? "primary" : ""}`)}
              {crop && !cropMode && (
                <button
                  className="btn"
                  onClick={resetCrop}
                  title="clear the crop"
                >
                  ✕ reset crop
                </button>
              )}
              <button
                className="btn primary"
                onClick={() => setDrawFullscreen(false)}
              >
                ✕ exit
              </button>
            </div>
          </div>
        )}

        {shareOpen && baked && (
          <UploadModal
            baked={baked}
            adminSecret={adminSecret}
            onClose={() => setShareOpen(false)}
          />
        )}
        {pngOpen && baked && (
          <PngFrameModal
            baked={baked}
            onClose={() => setPngOpen(false)}
            onError={setError}
          />
        )}
      </div>
    </div>
  );
}
