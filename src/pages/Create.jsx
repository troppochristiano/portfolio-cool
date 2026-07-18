import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { SUPERSAMPLE, computeRows, formatBytes } from "../create/asciify.js";
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
import { fmtTime, MONO_ADVANCE } from "../lib/utils.js";
import "./Create.css";

// With an adminSecret (the /admin/create route), the tool is identical except
// the share dialog: no Turnstile and the server waives the upload limits.
export default function Create({ adminSecret = null }) {
  const videoRef = useRef(null);
  const compositeRef = useRef(null); // displayed <canvas> = photo + strokes; also the sample source
  const canvasRef = useRef(null); // offscreen sampler
  const monitorRef = useRef(null); // the main monitor (observed for the mini's visibility)
  const pageRef = useRef(null); // the .create-page scroll container
  const screenRef = useRef(null); // monitor interior the <pre> must fit inside
  const mediaBoxRef = useRef(null); // wrapper that shrink-wraps the visible media (crop/eyedropper coords)
  const settingsRef = useRef(null); // latest settings for the rAF loop

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
  // typography + colors — display styling that rides into the baked figure's
  // optional `style` block (validated server-side on upload).
  const [fontKey, setFontKey] = useState(STYLE_DEFAULTS.font);
  const [letterSpacing, setLetterSpacing] = useState(
    STYLE_DEFAULTS.letterSpacing,
  ); // em
  const [lineHeight, setLineHeight] = useState(STYLE_DEFAULTS.lineHeight);
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
    typography: true,
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
    currentTime,
    loop,
    setLoop,
    trim,
    setTrim,
    trimStart,
    trimEnd,
    videoName,
    trimBarRef,
    loadFile,
    togglePlay,
    onScrub,
    stepFrame,
    setTrimFromPlayhead,
    onTrimDown,
    onTrimMove,
    onTrimUp,
  } = useVideoSource(videoRef, {
    fps,
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
    });

  const {
    canWebm,
    webmProgress,
    exportJson,
    exportPng,
    exportWebm,
    shareOpen,
    setShareOpen,
    pngOpen,
    setPngOpen,
  } = useExport({ baked, setError });

  const {
    miniVisible,
    miniDismissed,
    setMiniDismissed,
    miniElRef,
    miniPosStyle,
    onMiniDown,
    onMiniMove,
    onMiniUp,
    onMiniClick,
  } = useMiniMonitor({ pageRef, monitorRef, hasSource });

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
          : { w: Math.round(natW), h: Math.round(natH) },
      );
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(screen);
    ro.observe(pre);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasSource, sourceType, mode, cols, rows, cellPx, baked]);

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
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* drag still tracks while the pointer stays on the grip */
    }
  };
  const onStageResizeMove = (e) => {
    const drag = stageDragRef.current;
    if (!drag) return;
    const next = Math.round(drag.startH + (e.clientY - drag.startY));
    setStageH(Math.min(640, Math.max(200, next)));
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
  const estNatW = cols * cellPx * MONO_ADVANCE * (1 + (letterSpacing || 0));
  const estNatH = rows * cellPx * lineHeight;
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

  // Mini-monitor scale: fit the same cols×rows frame into a small fixed box,
  // reusing the already-measured render size (no extra observer).
  const MINI_W = 140,
    MINI_H = 108;
  const miniScale = outputPx
    ? Math.min(1, MINI_W / outputPx.w, MINI_H / outputPx.h)
    : 0.12;

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
      letterSpacing,
      lineHeight,
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
            </SettingsBlock>

            <SettingsBlock
              label="typography"
              open={openBlocks.typography}
              onToggle={() => toggleBlock("typography")}
            >
              <div className="field-label">font</div>
              <SegmentedControl
                value={fontKey}
                onChange={setFontKey}
                options={Object.keys(FONT_STACKS).map((k) => ({
                  value: k,
                  label: k,
                }))}
              />
              <Slider
                label="char spacing"
                value={letterSpacing}
                min={0}
                max={0.5}
                step={0.01}
                onChange={setLetterSpacing}
                suffix="em"
                fixed={2}
              />
              <Slider
                label="line height"
                value={lineHeight}
                min={0.7}
                max={1.6}
                step={0.05}
                onChange={setLineHeight}
                fixed={2}
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
                        loop={loop}
                        style={{
                          display:
                            sourceType === "video" && hasVideo
                              ? "block"
                              : "none",
                        }}
                      />
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
                          onClick={() => stepFrame(-1)}
                          aria-label="back one frame"
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
                          onClick={() => stepFrame(1)}
                          aria-label="forward one frame"
                        >
                          ›
                        </button>
                        <span className="time-readout">
                          {fmtTime(currentTime)} / {fmtTime(duration)}
                        </span>
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
                          className={`tbtn tbtn-loop ${loop ? "on" : ""}`}
                          onClick={() => setLoop((l) => !l)}
                          aria-pressed={loop}
                          title="repeat playback to check the loop"
                        >
                          ⟳ loop
                        </button>
                      </div>

                      {/* trim: only [in, out] previews-in-loop and bakes */}
                      <div className="trim-row">
                        <span className="field-label">trim</span>
                        <button
                          className="tbtn"
                          onClick={() => setTrimFromPlayhead("in")}
                          title="set trim start to the playhead"
                        >
                          [ in
                        </button>
                        <button
                          className="tbtn"
                          onClick={() => setTrimFromPlayhead("out")}
                          title="set trim end to the playhead"
                        >
                          out ]
                        </button>
                        <div
                          className="trimbar"
                          ref={trimBarRef}
                          onPointerDown={onTrimDown}
                          onPointerMove={onTrimMove}
                          onPointerUp={onTrimUp}
                          onPointerCancel={onTrimUp}
                          role="slider"
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
                          <div
                            className="trimbar__handle"
                            style={{
                              left: `${duration ? (trimStart / duration) * 100 : 0}%`,
                            }}
                          />
                          <div
                            className="trimbar__handle"
                            style={{
                              left: `${duration ? (trimEnd / duration) * 100 : 100}%`,
                            }}
                          />
                        </div>
                        <span className="time-readout">
                          {fmtTime(trimStart)}–{fmtTime(trimEnd)} (
                          {(trimEnd - trimStart).toFixed(1)}s)
                        </span>
                        {trim && (
                          <button
                            className="tbtn"
                            onClick={() => setTrim(null)}
                            title="use the whole clip"
                          >
                            ✕
                          </button>
                        )}
                      </div>
                      <label className="relink">
                        <input
                          type="file"
                          accept="image/*,video/*"
                          onChange={(e) => loadAny(e.target.files?.[0])}
                          hidden
                        />
                        ↺ replace source
                      </label>
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
                          <label className="btn file-btn">
                            <input
                              type="file"
                              accept="image/*,video/*"
                              onChange={(e) => loadAny(e.target.files?.[0])}
                              hidden
                            />
                            {hasPhoto ? "↺ replace source" : "+ add source"}
                          </label>
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
                          : `baked · ${baked.frames.length} frames · ${cols}×${rows} @ ${baked.fps}fps`
                        : isStill
                          ? `still · ${cols}×${rows}`
                          : `live · ${cols}×${rows} · ~${frameEstimate} frames @ ${fps}fps`
                      : "no signal"}
                    {hasSource && baked && (
                      <span className="toggle-mode">
                        <button
                          className={mode === "live" ? "on" : ""}
                          onClick={() => setMode("live")}
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
                      <div className="preview-stack">
                        <pre
                          ref={previewRef}
                          className="preview"
                          style={{
                            fontSize: previewFontSize,
                            fontFamily: FONT_STACKS[fontKey],
                            letterSpacing: letterSpacing
                              ? `${letterSpacing}em`
                              : undefined,
                            lineHeight,
                            color: fgColor,
                            transform:
                              previewScale !== 1
                                ? `scale(${previewScale})`
                                : undefined,
                          }}
                          aria-hidden="true"
                        />
                        {showEdgeLayer && (
                          <pre
                            ref={previewEdgeRef}
                            className="preview preview-edge"
                            style={{
                              fontSize: previewFontSize,
                              fontFamily: FONT_STACKS[fontKey],
                              letterSpacing: letterSpacing
                                ? `${letterSpacing}em`
                                : undefined,
                              lineHeight,
                              color: effectiveEdgeColor,
                              transform:
                                previewScale !== 1
                                  ? `scale(${previewScale})`
                                  : undefined,
                            }}
                            aria-hidden="true"
                          />
                        )}
                      </div>
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
                  {canWebm && !isStill && (
                    <button
                      className="btn"
                      onClick={exportWebm}
                      disabled={!baked || baking || webmProgress !== null}
                    >
                      {webmProgress !== null
                        ? `recording… ${Math.round(webmProgress * 100)}%`
                        : "↓ webm"}
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
                    <span style={{ width: baking ? `${bakeProgress}%` : 0 }} />
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
          className={`mini-monitor ${(drawFullscreen || miniVisible) && hasSource && !miniDismissed ? "is-visible" : ""} ${mode === "baked" ? "is-baked" : ""} ${drawFullscreen ? "is-fs" : ""}`}
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
          <div className="preview-stack">
            <pre
              ref={miniPreviewRef}
              className="preview mini-preview"
              style={{
                fontSize: previewFontSize,
                fontFamily: FONT_STACKS[fontKey],
                letterSpacing: letterSpacing ? `${letterSpacing}em` : undefined,
                lineHeight,
                color: fgColor,
                transform: `scale(${miniScale})`,
              }}
              aria-hidden="true"
            />
            {showEdgeLayer && (
              <pre
                ref={miniPreviewEdgeRef}
                className="preview mini-preview preview-edge"
                style={{
                  fontSize: previewFontSize,
                  fontFamily: FONT_STACKS[fontKey],
                  letterSpacing: letterSpacing
                    ? `${letterSpacing}em`
                    : undefined,
                  lineHeight,
                  color: effectiveEdgeColor,
                  transform: `scale(${miniScale})`,
                }}
                aria-hidden="true"
              />
            )}
          </div>
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
