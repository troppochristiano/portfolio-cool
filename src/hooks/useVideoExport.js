import { useState } from "react";
import { downloadVideo, pickVideoMime } from "../create/exportMedia.js";

/**
 * Video export progress state machine, shared by the converter's export bar and
 * the figure dialog. MediaRecorder records in real time, so progress (0..1)
 * drives a busy readout; only offered when the browser can encode video at all.
 * `videoExt` is the container that won the probe ("mp4" or "webm") — label the
 * button with it so the user knows what they're getting.
 */
// The shared button label for both export surfaces: a live recording readout
// while in flight, the container extension otherwise.
export const videoExportLabel = (videoProgress, videoExt) =>
  videoProgress !== null
    ? `recording… ${Math.round(videoProgress * 100)}%`
    : `↓ ${videoExt}`;

export function useVideoExport({ onError } = {}) {
  const picked = pickVideoMime();
  const [videoProgress, setVideoProgress] = useState(null); // null | 0..1
  const exportVideo = async (data) => {
    if (!data || videoProgress !== null) return;
    setVideoProgress(0);
    try {
      await downloadVideo(data, { onProgress: setVideoProgress });
    } catch {
      onError?.(`${picked?.ext || "video"} export failed`);
    } finally {
      setVideoProgress(null);
    }
  };
  return { canVideo: !!picked, videoExt: picked?.ext || "", videoProgress, exportVideo };
}
