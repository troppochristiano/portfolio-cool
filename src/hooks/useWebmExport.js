import { useState } from "react";
import { downloadWebm, webmMimeType } from "../create/exportMedia.js";

/**
 * WebM export progress state machine, shared by the converter's export bar and
 * the figure dialog. MediaRecorder records in real time, so progress (0..1)
 * drives a busy readout; only offered when the browser can encode webm at all.
 */
export function useWebmExport({ onError } = {}) {
  const canWebm = !!webmMimeType();
  const [webmProgress, setWebmProgress] = useState(null); // null | 0..1
  const exportWebm = async (data) => {
    if (!data || webmProgress !== null) return;
    setWebmProgress(0);
    try {
      await downloadWebm(data, { onProgress: setWebmProgress });
    } catch {
      onError?.("webm export failed");
    } finally {
      setWebmProgress(null);
    }
  };
  return { canWebm, webmProgress, exportWebm };
}
