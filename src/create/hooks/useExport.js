import { useState } from "react";
import { downloadJson, downloadPng } from "../exportMedia.js";
import { useVideoExport } from "../../hooks/useVideoExport.js";

/**
 * Export + share actions for a baked figure. PNG/video exports render the baked
 * frames to a canvas client-side.
 */
export function useExport({ baked, setError }) {
  const { canVideo, videoExt, videoProgress, exportVideo } = useVideoExport({
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
    canVideo,
    videoExt,
    videoProgress,
    exportJson,
    exportPng,
    exportVideo: () => exportVideo(baked),
    shareOpen,
    setShareOpen,
    pngOpen,
    setPngOpen,
  };
}
