import { useState } from "react";
import {
  downloadJson,
  downloadPng,
  downloadWebm,
  webmMimeType,
} from "../exportMedia.js";

/**
 * Export + share actions for a baked figure. PNG/WebM exports render the baked
 * frames to a canvas client-side. WebM is only offered for animations and when
 * MediaRecorder supports it (the export records in real time, hence the busy
 * readout).
 */
export function useExport({ baked, setError }) {
  const canWebm = !!webmMimeType();
  const [webmProgress, setWebmProgress] = useState(null); // null | 0..1
  // share-to-gallery modal
  const [shareOpen, setShareOpen] = useState(false);
  // png frame-picker modal (animations only)
  const [pngOpen, setPngOpen] = useState(false);

  const exportJson = () => {
    if (!baked) return;
    downloadJson(baked, "figure.json");
  };
  const exportPng = () => {
    if (!baked) return;
    // Animations open a frame picker; stills export their one frame directly.
    if (baked.frames.length > 1) {
      setPngOpen(true);
      return;
    }
    downloadPng(baked).catch(() => setError("png export failed"));
  };
  const exportWebm = async () => {
    if (!baked || webmProgress !== null) return;
    setWebmProgress(0);
    try {
      await downloadWebm(baked, { onProgress: setWebmProgress });
    } catch {
      setError("webm export failed");
    } finally {
      setWebmProgress(null);
    }
  };

  return {
    canWebm,
    webmProgress,
    exportJson,
    exportPng,
    exportWebm,
    shareOpen,
    setShareOpen,
    pngOpen,
    setPngOpen,
  };
}
