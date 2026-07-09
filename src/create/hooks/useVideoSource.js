import { useCallback, useEffect, useRef, useState } from "react";

const MIN_TRIM = 0.2; // seconds — trim handles can't cross closer than this

/**
 * The video input: file loading, metadata, transport (play/scrub/frame-step)
 * and the trim bar. `onNewClip` fires when a clip loads so the caller can drop
 * stale bake/crop state; `sourceTypeRef` gates dims adoption (the metadata
 * listeners bind once but must not clobber the image source's dimensions).
 */
export function useVideoSource(videoRef, { fps, sourceTypeRef, setDims, setError, onNewClip }) {
  const [hasVideo, setHasVideo] = useState(false);
  const [duration, setDuration] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [loop, setLoop] = useState(true);
  // trim: only [start, end] of the clip previews-in-loop and bakes.
  // null = full clip (and the state new clips reset to).
  const [trim, setTrim] = useState(null);
  const [videoName, setVideoName] = useState("");
  const trimBarRef = useRef(null);
  const trimDragRef = useRef(null); // 'in' | 'out' while a handle drags
  const onNewClipRef = useRef(onNewClip);
  useEffect(() => {
    onNewClipRef.current = onNewClip;
  });

  const loadFile = useCallback(
    (file) => {
      if (!file) return;
      if (!file.type.startsWith("video/")) {
        setError(`"${file.name}" isn't a video — try mp4, mov, or webm`);
        return;
      }
      setError("");
      const url = URL.createObjectURL(file);
      setVideoName(file.name);
      onNewClipRef.current();
      const v = videoRef.current;
      v.src = url;
      v.load();
    },
    [videoRef, setError],
  );

  // ── video metadata ────────────────────────────────────────────
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const onMeta = () => {
      setHasVideo(true);
      setError("");
      if (sourceTypeRef.current === "video")
        setDims({ w: v.videoWidth, h: v.videoHeight });
      setDuration(v.duration || 0);
      setTrim(null); // a new clip starts untrimmed
    };
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onTime = () => setCurrentTime(v.currentTime);
    const onErr = () => {
      if (!v.src) return; // ignore the empty-source state before a clip is picked
      setError(
        "couldn’t read that clip — it may be corrupt or use an unsupported codec",
      );
    };
    v.addEventListener("loadedmetadata", onMeta);
    v.addEventListener("play", onPlay);
    v.addEventListener("pause", onPause);
    v.addEventListener("timeupdate", onTime);
    v.addEventListener("error", onErr);
    return () => {
      v.removeEventListener("loadedmetadata", onMeta);
      v.removeEventListener("play", onPlay);
      v.removeEventListener("pause", onPause);
      v.removeEventListener("timeupdate", onTime);
      v.removeEventListener("error", onErr);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── trim playback ─────────────────────────────────────────────
  // While trimmed, playback lives inside [start, end]: reaching the out point
  // loops back (or pauses when loop is off), and pressing play from outside
  // the range jumps to the in point first.
  useEffect(() => {
    const v = videoRef.current;
    if (!v || !trim) return;
    const onTime = () => {
      if (v.currentTime >= trim.end) {
        if (loop) v.currentTime = trim.start;
        else v.pause();
      }
    };
    const onPlay = () => {
      if (v.currentTime < trim.start || v.currentTime >= trim.end) {
        v.currentTime = trim.start;
      }
    };
    v.addEventListener("timeupdate", onTime);
    v.addEventListener("play", onPlay);
    return () => {
      v.removeEventListener("timeupdate", onTime);
      v.removeEventListener("play", onPlay);
    };
  }, [videoRef, trim, loop]);

  // Effective trim range (whole clip when untrimmed) — what previews loop
  // over and what the bake samples.
  const trimStart = trim?.start ?? 0;
  const trimEnd = trim?.end ?? duration;

  // ── transport ─────────────────────────────────────────────────
  const togglePlay = () => {
    const v = videoRef.current;
    if (v.paused) v.play();
    else v.pause();
  };
  const onScrub = (e) => {
    const v = videoRef.current;
    // stay inside the trim range so the scrubber can't wander into cut footage
    v.currentTime = Math.min(
      Math.max(trimStart, Number(e.target.value)),
      Math.max(trimStart, trimEnd - 1e-3),
    );
  };
  const stepFrame = (dir) => {
    const v = videoRef.current;
    if (!v || !duration) return;
    v.pause();
    const t = v.currentTime + dir / fps;
    v.currentTime = Math.min(
      Math.max(trimStart, t),
      Math.max(trimStart, trimEnd - 1e-3),
    );
  };

  // ── trim bar (in/out handles on a custom track) ───────────────
  const trimPosOf = (e) => {
    const rect = trimBarRef.current.getBoundingClientRect();
    return (
      Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width)) * duration
    );
  };
  const applyTrimPoint = (t, which /* 'in' | 'out' */) => {
    setTrim((prev) => {
      const s = prev?.start ?? 0;
      const en = prev?.end ?? duration;
      let next;
      if (which === "in") next = { start: Math.min(t, en - MIN_TRIM), end: en };
      else next = { start: s, end: Math.max(t, s + MIN_TRIM) };
      next.start = Math.max(0, next.start);
      next.end = Math.min(duration, next.end);
      // dragged back to the full clip → untrimmed
      return next.start <= 0.005 && next.end >= duration - 0.005 ? null : next;
    });
  };
  const applyTrimDrag = (t) => applyTrimPoint(t, trimDragRef.current);
  // precise cuts: scrub / frame-step to the exact moment, then set that point.
  // Reads the video element (not currentTime state, which lags behind seeks).
  const setTrimFromPlayhead = (which) => {
    const v = videoRef.current;
    if (!v || !duration) return;
    applyTrimPoint(v.currentTime, which);
  };
  const onTrimDown = (e) => {
    if (!duration) return;
    e.preventDefault();
    const t = trimPosOf(e);
    const s = trim?.start ?? 0;
    const en = trim?.end ?? duration;
    // grab whichever handle is closer to the press
    trimDragRef.current = Math.abs(t - s) <= Math.abs(t - en) ? "in" : "out";
    e.currentTarget.setPointerCapture(e.pointerId);
    applyTrimDrag(t);
  };
  const onTrimMove = (e) => {
    if (!trimDragRef.current) return;
    e.preventDefault();
    applyTrimDrag(trimPosOf(e));
  };
  const onTrimUp = () => {
    trimDragRef.current = null;
  };

  return {
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
  };
}
