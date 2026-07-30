/**
 * Seeking a <video> and knowing when the frame is actually there. Shared by
 * the bake (which walks the clip frame by frame) and the trim handles (which
 * show the frame under the pointer).
 */

/**
 * Seek and resolve once the frame has landed.
 *
 * Every exit is covered, because callers queue on this: a seek to where we
 * already are fires no `seeked` at all, a dead or re-sourced element never
 * fires one either, and a stalled decoder can simply not answer. Any of those
 * hanging would wedge the queue behind it permanently.
 */
export const seekTo = (v, t) =>
  new Promise((res) => {
    const target = Math.min(
      Math.max(0, t),
      Math.max(0, (v.duration || 0) - 1e-3),
    );
    if (Math.abs(v.currentTime - target) < 1e-3) {
      res();
      return;
    }
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      v.removeEventListener("seeked", finish);
      v.removeEventListener("error", finish);
      v.removeEventListener("emptied", finish);
      clearTimeout(timer);
      res();
    };
    v.addEventListener("seeked", finish);
    v.addEventListener("error", finish); // don't queue behind a broken element
    v.addEventListener("emptied", finish); // src swapped mid-seek
    const timer = setTimeout(finish, 3000); // stalled-decoder backstop
    v.currentTime = target;
  });

/**
 * A seeker that keeps only the LATEST requested time while one seek is in
 * flight. A trim drag emits positions far faster than a decoder can serve
 * them; without coalescing the seeks queue up and the picture lags the handle
 * by seconds. Driven by the `seeked` event rather than rAF so it self-paces to
 * the decoder (and keeps working when rAF is throttled).
 */
export function makeSeeker(getVideo, minGapMs = 80) {
  let want = null;
  let busy = false;
  return (t) => {
    const v = getVideo();
    if (!v || !v.src || !isFinite(v.duration)) return;
    want = t;
    if (busy) return; // the in-flight seek will pick the newest value up
    busy = true;
    (async () => {
      try {
        while (want != null) {
          const next = want;
          want = null;
          await seekTo(v, next);
          // Breathe between seeks. Some streams (long-GOP, B-frames, low
          // bitrate) can make Chrome's decoder fail outright after a handful
          // of back-to-back seeks; the pause both thins them out and lets any
          // newer target arrive so it's served instead of the stale one.
          if (minGapMs > 0)
            await new Promise((r) => setTimeout(r, minGapMs));
        }
      } finally {
        busy = false;
      }
    })();
  };
}
