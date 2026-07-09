import { useState } from "react";
import { downloadJson, downloadPng } from "../exportMedia.js";
import { useWebmExport } from "../../hooks/useWebmExport.js";

/**
 * Export + share actions for a baked figure. PNG/WebM exports render the baked
 * frames to a canvas client-side.
 */
export function useExport({ baked, setError }) {
  const { canWebm, webmProgress, exportWebm } = useWebmExport({
    onError: setError,
  });
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

  return {
    canWebm,
    webmProgress,
    exportJson,
    exportPng,
    exportWebm: () => exportWebm(baked),
    shareOpen,
    setShareOpen,
    pngOpen,
    setPngOpen,
  };
}
