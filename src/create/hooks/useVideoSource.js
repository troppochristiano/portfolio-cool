import { useCallback, useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { capturePointer, clamp, pointerFracInRect } from "../../lib/utils.js";
import { useLiveRef } from "../../hooks/useLiveRef.js";
import { seekTo, makeSeeker } from "../seekVideo.js";
import {
  applyTrimPoint,
  frameOf,
  minTrim,
  snapT,
  timeOfFrame,
} from "../trimMath.js";

/**
 * The video input: file loading, metadata, transport (play/scrub/frame-step)
 * and the trim range. `onNewClip` fires when a clip loads so the caller can
 * drop stale bake/crop state; `sourceTypeRef` gates dims adoption (the metadata
 * listeners bind once but must not clobber the image source's dimensions).
 *
 * Trim is a toggled section, so `trim === null` means exactly one thing — the
 * section is OFF (= use the whole clip). Only the toggle and a new clip write
 * null; dragging a handle out to the clip edge must never switch the section
 * off under the user's finger.
 *
 * Everything downstream of the trim range is scoped to it: the seek bar spans
 * [start, end], the readout is range-relative, frame-step lands on bake frames,
 * and playback loops inside the range rather than the clip.
 */
export function useVideoSource(
  videoRef,
  { fps, freezeRef, sourceTypeRef, setDims, setError, onNewClip },
) {
  const [hasVideo, setHasVideo] = useState(false);
  const [duration, setDuration] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [loop, setLoop] = useState(true);
  const [trim, setTrim] = useState(null);
  const [videoName, setVideoName] = useState("");
  // Two separate things, on purpose. `recovering` flips the stage over to the
  // frozen frame and must be IMMEDIATE — a reload is ~15ms, and anything later
  // than instant means the stripped <video> gets a frame or two on screen,
  // which is the blank-and-collapse we're preventing. `recoverySlow` only
  // gates the explanatory line, which should stay quiet for a fast fix.
  const [recovering, setRecovering] = useState(false);
  const [recoverySlow, setRecoverySlow] = useState(false);
  const trimBarRef = useRef(null);
  const trimDragRef = useRef(null); // 'in' | 'out' while a handle drags
  // Mirror of `trim`, written synchronously. Pointer moves can outrun React's
  // commit, so the drag math reads this rather than a possibly-stale closure.
  const trimRef = useRef(null);
  const lastTrimRef = useRef(null); // restored when the toggle comes back on
  const wasPlayingRef = useRef(false);
  const playTokenRef = useRef(0);
  const srcUrlRef = useRef(null); // current blob URL, kept for error recovery
  const recoverRef = useRef(0); // recovery attempts on this clip
  const newClipRef = useRef(false); // distinguishes a fresh clip from a reload
  const playingRef = useRef(false); // survives the implicit pause on error
  const lastGoodTimeRef = useRef(0); // where to put the playhead back
  const scrubbingRef = useRef(false); // the scrub bar owns currentTime meanwhile
  const recoverNoticeRef = useRef(0); // delays the "reloading" line past a fast fix
  const stepBaseRef = useRef(null); // frame index a held frame-step counts from
  const stepTimersRef = useRef({ delay: 0, repeat: 0 });
  const onNewClipRef = useRef(onNewClip);
  useEffect(() => {
    onNewClipRef.current = onNewClip;
  });

  // Coalescing seeker: a drag emits positions faster than the decoder serves
  // them, so only the newest one survives.
  const seekRef = useRef(null);
  if (!seekRef.current) seekRef.current = makeSeeker(() => videoRef.current);

  const writeTrim = (next) => {
    trimRef.current = next;
    setTrim(next);
  };

  const loadFile = useCallback(
    (file) => {
      if (!file) return;
      if (!file.type.startsWith("video/")) {
        setError(`"${file.name}" isn't a video — try mp4, mov, or webm`);
        return;
      }
      setError("");
      const url = URL.createObjectURL(file);
      // Keep the URL: it's what a decoder-error recovery re-loads from (and it
      // used to leak — the previous clip's blob was never released).
      if (srcUrlRef.current) URL.revokeObjectURL(srcUrlRef.current);
      srcUrlRef.current = url;
      recoverRef.current = 0;
      newClipRef.current = true;
      clearTimeout(recoverNoticeRef.current);
      setRecovering(false);
      setRecoverySlow(false);
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
      setError(""); // also clears a stale error once a recovery lands
      if (sourceTypeRef.current === "video")
        setDims({ w: v.videoWidth, h: v.videoHeight });
      setDuration(v.duration || 0);
      // Only a genuinely new clip resets the trim — a recovery reload must
      // leave the user's in/out points exactly where they were.
      if (newClipRef.current) {
        newClipRef.current = false;
        trimRef.current = null;
        lastTrimRef.current = null;
        setTrim(null);
      }
    };
    const onPlay = () => {
      playingRef.current = true;
      setPlaying(true);
    };
    const onPause = () => {
      playingRef.current = false;
      setPlaying(false);
    };
    const onPlaying = () => {
      recoverRef.current = 0; // healthy again; give later hiccups a full budget
    };
    // Keep a full-resolution copy of the last frame that actually rendered.
    // A recovery reload strips the element of its frame AND its intrinsic size,
    // so without this the stage both blanks and collapses; the canvas stands in
    // for the video and, carrying real width/height attributes, holds the box
    // open by itself. One drawImage per seek is nothing.
    const grabFrame = () => {
      const c = freezeRef?.current;
      if (!c || v.readyState < 2 || !v.videoWidth) return;
      if (c.width !== v.videoWidth || c.height !== v.videoHeight) {
        c.width = v.videoWidth;
        c.height = v.videoHeight;
      }
      try {
        c.getContext("2d").drawImage(v, 0, 0);
      } catch {
        /* a frame can go unavailable mid-teardown — keep the previous one */
      }
    };
    const onTime = () => {
      lastGoodTimeRef.current = v.currentTime;
      grabFrame();
      // While a scrub drag is live the pointer owns the thumb; a timeupdate
      // from the previous position would yank it backwards mid-drag.
      if (!scrubbingRef.current) setCurrentTime(v.currentTime);
    };
    const onErr = () => {
      const err = v.error;
      // No source yet, or an `error` with nothing behind it — not ours to report.
      if (!v.src || !err) return;
      // Scrubbing hard through a long clip can make the decoder give up
      // mid-seek: the element pauses and stays dead even though the file is
      // perfectly fine. Reload it and put the playhead back, so a scrub
      // hiccup is a stutter instead of the end of the session.
      const transient = err.code === err.MEDIA_ERR_DECODE || err.code === err.MEDIA_ERR_NETWORK;
      // The budget counts CONSECUTIVE FAILED RELOADS, not decoder hiccups — a
      // reload demonstrably brings this element back, so a clip the user
      // scrubs a lot should never run out. (Counting hiccups and only
      // resetting on `playing` meant three scrubs while paused killed the clip
      // for good, which is exactly what left the stage blank.)
      if (transient && srcUrlRef.current && recoverRef.current < 3) {
        recoverRef.current++;
        // The element usually still reports where it died; lastGoodTime is the
        // fallback for when it doesn't (timeupdate only fires ~4×/s, so it can
        // trail a scrub by a noticeable margin).
        const at = isFinite(v.currentTime) && v.currentTime > 0
          ? v.currentTime
          : lastGoodTimeRef.current;
        const resume = playingRef.current;
        // Swap to the frozen frame NOW. flushSync, not a plain setState: the
        // very next statement strips the element, and a batched update would
        // let the browser paint the collapsed <video> first — which is the
        // whole artifact being fixed.
        flushSync(() => setRecovering(true));
        // The line explaining it can wait: a reload is typically ~15ms, and
        // announcing that would just flicker text on and off.
        clearTimeout(recoverNoticeRef.current);
        recoverNoticeRef.current = setTimeout(() => setRecoverySlow(true), 250);
        const onReady = () => {
          v.removeEventListener("loadeddata", onReady);
          recoverRef.current = 0; // the reload produced a working element
          clearTimeout(recoverNoticeRef.current);
          setRecovering(false);
          setRecoverySlow(false);
          v.currentTime = at;
          if (resume) v.play().catch(() => {});
        };
        v.addEventListener("loadeddata", onReady);
        v.src = srcUrlRef.current;
        v.load();
        return;
      }
      clearTimeout(recoverNoticeRef.current);
      setRecovering(false);
      setRecoverySlow(false);
      setError(
        "couldn’t read that clip — it may be corrupt or use an unsupported codec",
      );
    };
    v.addEventListener("loadedmetadata", onMeta);
    v.addEventListener("play", onPlay);
    v.addEventListener("pause", onPause);
    v.addEventListener("playing", onPlaying);
    v.addEventListener("timeupdate", onTime);
    v.addEventListener("seeked", onTime); // keeps the recovery position fresh
    // so a clip that's loaded but never seeked or played still has a stand-in
    v.addEventListener("loadeddata", grabFrame);
    v.addEventListener("error", onErr);
    return () => {
      v.removeEventListener("loadedmetadata", onMeta);
      v.removeEventListener("play", onPlay);
      v.removeEventListener("pause", onPause);
      v.removeEventListener("playing", onPlaying);
      v.removeEventListener("timeupdate", onTime);
      v.removeEventListener("seeked", onTime);
      v.removeEventListener("loadeddata", grabFrame);
      v.removeEventListener("error", onErr);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Effective range — the whole clip when the trim section is off. This is what
  // the transport spans, what previews loop over, and what the bake samples.
  const trimStart = trim?.start ?? 0;
  const trimEnd = trim?.end ?? duration;

  // ── trim playback ─────────────────────────────────────────────
  // Playback lives inside [trimStart, trimEnd] whether or not trim is on (when
  // off the range IS the clip, so one code path covers every case — and the
  // <video> carries no native `loop`, so this is the only loop authority).
  //
  // The wrap is driven by a timer, not `timeupdate`: timeupdate fires ~4×/s, so
  // waiting for it overshot the out point by up to ~250ms every loop.
  //
  // The range is read through refs, so the six listeners below are bound once
  // per clip instead of once per range value. Dragging a trim handle sets
  // trimStart/trimEnd on every pointermove, and with them in the dep array the
  // whole effect tore down and re-subscribed on each of those frames — pure
  // waste, since every handler here early-returns during a drag anyway.
  const trimStartRef = useLiveRef(trimStart);
  const trimEndRef = useLiveRef(trimEnd);
  const loopRef = useLiveRef(loop);
  const armRef = useRef(null);
  useEffect(() => {
    const v = videoRef.current;
    if (!v || !duration) return;
    let timer = 0;
    const clear = () => {
      clearTimeout(timer);
      timer = 0;
    };
    const wrap = () => {
      // Only playback wraps. A PAUSED playhead sitting on the out point is a
      // legitimate resting state — it's exactly where a trim drag leaves you —
      // and rewinding it to the in point would throw away the frame you just
      // cut on. A stale playhead outside the range is corrected by onPlay.
      if (trimDragRef.current || v.paused) return;
      if (loopRef.current) v.currentTime = trimStartRef.current;
      else v.pause();
    };
    const arm = () => {
      clear();
      if (v.paused || trimDragRef.current) return;
      const ms =
        ((trimEndRef.current - v.currentTime) / (v.playbackRate || 1)) * 1000;
      timer = setTimeout(wrap, Math.max(0, ms));
    };
    armRef.current = arm;
    const onTime = () => {
      if (trimDragRef.current) return;
      // safety net in case the timer was missed or the range moved under it
      if (v.currentTime >= trimEndRef.current) wrap();
      else arm();
    };
    const onPlay = () => {
      if (
        v.currentTime < trimStartRef.current ||
        v.currentTime >= trimEndRef.current - 1e-3
      )
        v.currentTime = trimStartRef.current;
      arm();
    };
    // Backstop for a range that runs to the true end of the clip, where the
    // element can end before the timer fires.
    const onEnded = () => {
      if (trimDragRef.current || !loopRef.current) return;
      v.currentTime = trimStartRef.current;
      v.play().catch(() => {});
    };
    v.addEventListener("play", onPlay);
    v.addEventListener("timeupdate", onTime);
    v.addEventListener("seeked", arm);
    v.addEventListener("ratechange", arm);
    v.addEventListener("pause", clear);
    v.addEventListener("ended", onEnded);
    arm();
    return () => {
      clear();
      armRef.current = null;
      v.removeEventListener("play", onPlay);
      v.removeEventListener("timeupdate", onTime);
      v.removeEventListener("seeked", arm);
      v.removeEventListener("ratechange", arm);
      v.removeEventListener("pause", clear);
      v.removeEventListener("ended", onEnded);
    };
  }, [videoRef, duration, trimStartRef, trimEndRef, loopRef]);

  // The timer was armed against the OLD out point, so a range change has to
  // re-arm it. Cheap and idempotent — and it no longer costs six listener
  // swaps to get there.
  useEffect(() => {
    armRef.current?.();
  }, [trimStart, trimEnd, loop]);

  // ── transport ─────────────────────────────────────────────────
  const seekInRange = (t) =>
    clamp(t, trimStart, Math.max(trimStart, trimEnd - 1e-3));

  const togglePlay = () => {
    const v = videoRef.current;
    if (v.paused) v.play();
    else v.pause();
  };
  // Dragging the bar emits far more positions than a decoder can serve. Setting
  // currentTime on every one of them queues dozens of long-distance seeks into
  // a long clip, which is what makes the decoder give up (see onErr). Coalescing
  // keeps only the newest target, so the picture still lands where the thumb is.
  // The thumb itself moves optimistically so it never lags the pointer.
  const onScrub = (e) => {
    const t = seekInRange(Number(e.target.value));
    setCurrentTime(t);
    seekRef.current(t);
  };
  const onScrubDown = () => {
    scrubbingRef.current = true;
  };
  const onScrubUp = () => {
    scrubbingRef.current = false;
  };
  // Steps land on exact bake frames: quantising against trimStart stops
  // repeated steps accumulating float drift off the grid.
  //
  // The step counts from a BASE frame captured when the gesture starts, not
  // from v.currentTime. Seeks are coalesced and asynchronous, so a held arrow
  // firing faster than the decoder answers would keep re-reading a position
  // that hasn't caught up — and stall on the same frame. Counting from a base
  // advances by exactly one frame per press however far the element lags.
  const stepFrame = (dir) => {
    const v = videoRef.current;
    if (!v || !duration) return;
    v.pause();
    if (stepBaseRef.current == null)
      stepBaseRef.current = frameOf(v.currentTime, trimStart, fps);
    stepBaseRef.current += dir;
    const t = seekInRange(timeOfFrame(stepBaseRef.current, trimStart, fps));
    // Re-anchor at the ends so holding into a boundary doesn't build up a debt
    // of frames that has to be unwound before the arrow responds again.
    stepBaseRef.current = frameOf(t, trimStart, fps);
    setCurrentTime(t);
    seekRef.current(t);
  };
  /** Drop the step anchor — anything else that moves the playhead invalidates it. */
  const releaseStep = () => {
    clearTimeout(stepTimersRef.current.delay);
    clearInterval(stepTimersRef.current.repeat);
    stepTimersRef.current = { delay: 0, repeat: 0 };
    stepBaseRef.current = null;
  };
  /**
   * Press-and-hold on the frame arrows: one step immediately, then a steady
   * repeat after a short delay. The repeat interval sits just above the
   * seeker's own gap so a held arrow can't outrun the decoder.
   */
  const holdStep = (dir) => ({
    onPointerDown: (e) => {
      if (!duration) return;
      e.preventDefault();
      capturePointer(e);
      releaseStep();
      stepFrame(dir);
      stepTimersRef.current.delay = setTimeout(() => {
        stepTimersRef.current.repeat = setInterval(() => stepFrame(dir), 125);
      }, 400);
    },
    onPointerUp: releaseStep,
    onPointerCancel: releaseStep,
  });
  // A held arrow must not outlive the page.
  useEffect(() => releaseStep, []);

  /** Rewind to the in point and play — used when returning to the live view. */
  const playFromTrimStart = useCallback(async () => {
    const v = videoRef.current;
    if (!v || !v.src || !duration) return;
    const token = ++playTokenRef.current;
    // Seek FIRST: a bake leaves the element one frame short of the out point,
    // so playing from there shows a frame of the tail before the loop wraps.
    await seekTo(v, trimStart);
    if (playTokenRef.current !== token) return; // a newer call/clip won
    v.play().catch(() => {});
  }, [videoRef, duration, trimStart]);

  // ── trim section ──────────────────────────────────────────────
  const enableTrim = (on) => {
    if (!duration) return;
    if (!on) {
      lastTrimRef.current = trimRef.current;
      writeTrim(null);
      return;
    }
    const prev = lastTrimRef.current;
    const usable =
      prev && prev.end <= duration && prev.end - prev.start >= minTrim(fps);
    writeTrim(usable ? prev : { start: 0, end: snapT(duration, fps, duration) });
  };

  /** Move one endpoint; returns where it actually landed (after clamping). */
  const applyTrimPointAt = (t, which) => {
    const next = applyTrimPoint(trimRef.current, t, which, { fps, duration });
    writeTrim(next);
    return which === "in" ? next.start : next.end;
  };

  // precise cuts: scrub / frame-step to the exact moment, then set that point.
  // Reads the video element (not currentTime state, which lags behind seeks).
  const setTrimFromPlayhead = (which) => {
    const v = videoRef.current;
    if (!v || !duration) return;
    applyTrimPointAt(v.currentTime, which);
  };

  const trimPosOf = (e) =>
    snapT(
      pointerFracInRect(e, trimBarRef.current).x * duration,
      fps,
      duration,
    );

  // Pause for the duration of a drag so the wrap logic can't fight it, and
  // remember whether to resume afterwards.
  const beginTrimDrag = (which) => {
    trimDragRef.current = which;
    const v = videoRef.current;
    if (!v) return;
    wasPlayingRef.current = !v.paused;
    if (!v.paused) v.pause();
  };
  // Showing the frame under the handle is the whole point — you can't cut on a
  // frame you can't see. The ascii preview loop samples the element every frame,
  // so seeking it updates the monitor too, with no coupling needed.
  // Clamped to the CLIP, not the range: the frame being previewed is the one
  // defining the new range, so clamping it to the old range would show the
  // wrong frame while dragging the out point outward.
  const previewAt = (t) =>
    seekRef.current(clamp(t, 0, Math.max(0, duration - 1e-3)));

  const onTrimDown = (e) => {
    // handles own their own presses (grab-in-place); the bare track is the
    // coarse "put the nearer handle here" fallback
    if (!duration || e.target.closest(".trimbar__handle")) return;
    e.preventDefault();
    const t = trimPosOf(e);
    beginTrimDrag(
      Math.abs(t - trimStart) <= Math.abs(t - trimEnd) ? "in" : "out",
    );
    capturePointer(e);
    previewAt(applyTrimPointAt(t, trimDragRef.current));
  };

  const onHandleDown = (which) => (e) => {
    if (!duration) return;
    e.preventDefault();
    const bar = trimBarRef.current;
    // Overlapping hit boxes (handles closer together than the target width):
    // fall back to whichever point the press is actually nearer.
    const px = e.currentTarget.getBoundingClientRect().width || 24;
    const gapPx =
      bar && duration
        ? ((trimEnd - trimStart) / duration) * bar.getBoundingClientRect().width
        : Infinity;
    let role = which;
    if (gapPx < px) {
      const t = trimPosOf(e);
      role = Math.abs(t - trimStart) <= Math.abs(t - trimEnd) ? "in" : "out";
    }
    beginTrimDrag(role);
    if (bar) capturePointer(e, bar);
    // deliberately no value change: grabbing a handle must not teleport it
  };

  const onTrimMove = (e) => {
    if (!trimDragRef.current) return;
    e.preventDefault();
    previewAt(applyTrimPointAt(trimPosOf(e), trimDragRef.current));
  };

  const onTrimUp = () => {
    if (!trimDragRef.current) return;
    trimDragRef.current = null;
    if (!wasPlayingRef.current) return;
    wasPlayingRef.current = false;
    // The range moved, so the old playhead means nothing — restart the loop.
    playFromTrimStart();
  };

  const onHandleKey = (which) => (e) => {
    if (!duration) return;
    const cur = which === "in" ? trimStart : trimEnd;
    const frame = 1 / (fps || 30);
    let t;
    switch (e.key) {
      case "ArrowLeft":
        t = cur - frame * (e.shiftKey ? 10 : 1);
        break;
      case "ArrowRight":
        t = cur + frame * (e.shiftKey ? 10 : 1);
        break;
      case "PageDown":
        t = cur - 1;
        break;
      case "PageUp":
        t = cur + 1;
        break;
      case "Home":
        t = 0;
        break;
      case "End":
        t = duration;
        break;
      default:
        return;
    }
    e.preventDefault(); // arrows would otherwise scroll the rail
    previewAt(applyTrimPointAt(t, which));
  };

  return {
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
  };
}
