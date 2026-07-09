import { useRef, useState } from "react";
import { clamp01, rgbToHex } from "../../lib/utils.js";

const MIN_CROP = 0.02;

// handle roles + their anchor positions on the rect (as percentages)
export const CROP_HANDLES = [
  ["nw", 0, 0],
  ["n", 50, 0],
  ["ne", 100, 0],
  ["e", 100, 50],
  ["se", 100, 100],
  ["s", 50, 100],
  ["sw", 0, 100],
  ["w", 0, 50],
];

/**
 * Crop marquee + Paint-style crop editor (move + 8 resize handles) + the
 * eyedropper, which share one stage overlay. The committed rect is normalized
 * {x,y,w,h}. Every crop change invalidates the current bake; the eyedropper
 * feeds the sampled pixel into the background-removal key controls.
 */
export function useCrop({
  mediaBoxRef,
  sourceType,
  videoRef,
  compositeRef,
  setKeyColor,
  setKeyMode,
  mode,
  setMode,
  invalidate,
}) {
  const [crop, setCrop] = useState(null); // {x,y,w,h} normalized, or null
  const [cropMode, setCropMode] = useState(false); // marquee armed
  const [cropDraft, setCropDraft] = useState(null); // rect while dragging
  const [picking, setPicking] = useState(false); // eyedropper armed
  const cropStartRef = useRef(null);
  const cropEditRef = useRef(null); // { role, start:{x,y}, rect } during a drag

  // ── crop marquee + eyedropper (shared stage overlay) ──────────
  const overlayPos = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
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
    if (sourceType === "image") {
      const c = compositeRef.current;
      d = c
        .getContext("2d")
        .getImageData(
          Math.min(c.width - 1, Math.floor(pos.x * c.width)),
          Math.min(c.height - 1, Math.floor(pos.y * c.height)),
          1,
          1,
        ).data;
    } else {
      const v = videoRef.current;
      if (!v || v.readyState < 2) return;
      const t = document.createElement("canvas");
      t.width = 1;
      t.height = 1;
      const tctx = t.getContext("2d", { willReadFrequently: true });
      tctx.drawImage(
        v,
        Math.min(v.videoWidth - 1, Math.floor(pos.x * v.videoWidth)),
        Math.min(v.videoHeight - 1, Math.floor(pos.y * v.videoHeight)),
        1,
        1,
        0,
        0,
        1,
        1,
      );
      d = tctx.getImageData(0, 0, 1, 1).data;
    }
    if (!d) return;
    setKeyColor(rgbToHex(d[0], d[1], d[2]));
    setKeyMode("custom");
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
    // ignore accidental clicks — a crop needs real area. Crop mode stays on:
    // the committed rect grows handles for Paint-style adjustment, and the
    // crop button becomes "✕ reset crop".
    if (rect.w > 0.02 && rect.h > 0.02) {
      setCrop(rect);
      invalidate();
    }
  };

  // ── crop editing session (move + 8 resize handles) ────────────
  // While crop mode is on and a rect exists, a .crop-editor overlay lets the
  // rect be dragged (move) or resized from any edge/corner — every change
  // calls setCrop immediately, so the ASCII preview follows live.
  const stagePos = (e) => {
    const rect = mediaBoxRef.current.getBoundingClientRect();
    return {
      x: clamp01((e.clientX - rect.left) / rect.width),
      y: clamp01((e.clientY - rect.top) / rect.height),
    };
  };
  const applyCropEdit = (r, role, dx, dy) => {
    if (role === "move") {
      return {
        x: Math.min(Math.max(0, r.x + dx), 1 - r.w),
        y: Math.min(Math.max(0, r.y + dy), 1 - r.h),
        w: r.w,
        h: r.h,
      };
    }
    let x0 = r.x,
      y0 = r.y,
      x1 = r.x + r.w,
      y1 = r.y + r.h;
    if (role.includes("w")) x0 = Math.min(Math.max(0, x0 + dx), x1 - MIN_CROP);
    if (role.includes("e")) x1 = Math.max(Math.min(1, x1 + dx), x0 + MIN_CROP);
    if (role.includes("n")) y0 = Math.min(Math.max(0, y0 + dy), y1 - MIN_CROP);
    if (role.includes("s")) y1 = Math.max(Math.min(1, y1 + dy), y0 + MIN_CROP);
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  };
  const onCropEditDown = (role) => (e) => {
    e.preventDefault();
    e.stopPropagation(); // don't fall through to the marquee overlay
    e.currentTarget.setPointerCapture(e.pointerId);
    cropEditRef.current = { role, start: stagePos(e), rect: { ...crop } };
    if (mode === "baked") setMode("live"); // editing invalidates the baked view
  };
  const onCropEditMove = (e) => {
    const ed = cropEditRef.current;
    if (!ed) return;
    e.preventDefault();
    const pos = stagePos(e);
    setCrop(
      applyCropEdit(ed.rect, ed.role, pos.x - ed.start.x, pos.y - ed.start.y),
    );
  };
  const onCropEditUp = () => {
    cropEditRef.current = null;
  };
  // Clear the crop and put the crop tool away (a cropped bake is now stale).
  const resetCrop = () => {
    setCrop(null);
    setCropMode(false);
    setCropDraft(null);
    invalidate();
  };
  // Full reset (no bake invalidation) — used when the source type switches.
  const clearCropState = () => {
    setCrop(null);
    setCropMode(false);
    setCropDraft(null);
    setPicking(false);
  };

  return {
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
  };
}
