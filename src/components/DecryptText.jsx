import { Fragment, useEffect, useMemo, useRef } from "react";
import { prefersReducedMotion } from "../lib/utils.js";
import { POOL } from "./ScrambleText.jsx";

// "Scramble-in" reveal for the About headline (after the Osmo effect-02 look):
// the line starts empty, and when `active` flips on a front sweeps left→right
// typing the text on. Behind the front the real text sits solid; just ahead
// of it a short window of pool glyphs flickers, fading out toward its tip —
// so the noise never covers the whole line, it's a fringe the text emerges
// from. Beyond the fringe there is nothing. Flipping `active` off empties the
// line again, so the reveal replays on every open.
//
// Same noise alphabet and swap cadence as the nav pills' hover scramble
// (ScrambleText); the reveal is time-driven (on overlay settle), not
// scroll-driven like the reference.
//
// Layout safety in a proportional face: every glyph cell is locked to the
// advance measured from the real laid-out text for the whole idle+reveal
// lifetime, and words are wrapped in white-space:nowrap spans (spaces are
// their own cells), so the empty line, the fringe, and the final text all
// occupy identical geometry — nothing reflows as glyphs appear. The lock is
// released once the reveal completes. The overlay is visibility:hidden while
// closed but still laid out, so the idle pass can measure real metrics.

const SWAP_MS = 34; // min hold per random glyph (same cadence as ScrambleText)
const SWAP_JITTER_MS = 26; // per-glyph jitter so cells don't flip in lockstep
const SWEEP_MS = 1400; // front travel across the full line, end to end
const HEAD = 10; // scrambled cells ahead of the front…
const HEAD_OPACITY_MAX = 0.75; // …dimmer than the resolved text at the front,
const HEAD_OPACITY_MIN = 0.06; // fading to almost nothing at the tip

// `accent` — optional word(s) to tint via .decrypt__word--accent (e.g. the
// name in the About wordmark). Word-level class, so the tint rides through
// scramble, resize re-locks, and the final restore without the effect loop
// knowing about it; the fringe glyphs inside an accent word inherit it too.
export function DecryptText({ text, active, accent }) {
  const rootRef = useRef(null);
  const words = useMemo(() => text.split(" "), [text]);
  const accentWords = useMemo(
    () => new Set(accent ? accent.split(" ") : []),
    [accent]
  );

  useEffect(() => {
    // Reduced motion: the JSX already carries the real text — never hide,
    // never animate (same evaluate-per-run semantics as ScrambleText).
    if (prefersReducedMotion()) return;
    const root = rootRef.current;
    // querySelectorAll returns document order, i.e. the flat text order the
    // front sweeps over (word cells and space cells interleaved).
    const cells = Array.from(root.querySelectorAll(".decrypt__char"));
    const original = cells.map((c) => c.textContent);
    let rafId = 0;

    const restore = () => {
      root.classList.remove("decrypt--locked");
      cells.forEach((c, i) => {
        c.textContent = original[i];
        c.style.width = "";
        c.style.opacity = "";
      });
    };

    // Freeze every cell at its natural advance. Restore first — metrics must
    // come from the real glyphs at full flow, not leftover state. Re-measured
    // on every `active` flip, so resizes can't bake in stale widths.
    const lock = () => {
      restore();
      const rects = cells.map((c) => c.getBoundingClientRect());
      // Not laid out (unpainted corner case) — locking to 0px would collapse
      // the headline; leave the real text alone.
      if (!rects.length || rects[0].width === 0) return false;
      cells.forEach((c, i) => {
        c.style.width = `${rects[i].width}px`;
      });
      root.classList.add("decrypt--locked");
      return true;
    };

    const hideAll = () => {
      cells.forEach((c) => {
        c.style.opacity = "0";
      });
    };

    // Locked widths go stale when the viewport changes (the wordmark's size
    // is vw-clamped), and at display scale that's not cosmetic — stale cells
    // overflow the band. Re-lock on resize: idle re-hides; mid-reveal the
    // next tick reapplies each cell's visibility/noise over fresh metrics.
    let done = false; // reveal finished — cells are unlocked, nothing to fix
    let resizeT = 0;
    const relock = () => {
      clearTimeout(resizeT);
      resizeT = setTimeout(() => {
        if (done) return;
        if (lock() && !active) hideAll();
      }, 150);
    };
    window.addEventListener("resize", relock);
    const unbind = () => {
      window.removeEventListener("resize", relock);
      clearTimeout(resizeT);
    };

    if (!active) {
      // Idle: an empty line that already owns its final geometry — the
      // dissolve sweep and a partial scrub reveal blank space, never text.
      if (lock()) hideAll();
      return () => {
        unbind();
        restore();
      };
    }

    // Settled open → type on. The front's position is wall-clock based, so a
    // throttled tab still lands the reveal in ~SWEEP_MS.
    if (!lock()) return;
    hideAll();
    const n = cells.length;
    const t0 = performance.now();
    const nextSwap = new Array(n).fill(0);

    const tick = (now) => {
      const front = ((now - t0) / SWEEP_MS) * n;
      for (let i = 0; i < n; i++) {
        const c = cells[i];
        if (i < front) {
          // Behind the front: the real glyph, solid — no per-cell boil, the
          // text is simply there (the fringe already did the flickering).
          if (c.textContent !== original[i]) c.textContent = original[i];
          if (c.style.opacity !== "") c.style.opacity = "";
        } else if (i < front + HEAD && original[i] !== " ") {
          // The fringe: flickering noise, dimming toward its tip.
          if (now >= nextSwap[i]) {
            c.textContent = POOL[(Math.random() * POOL.length) | 0];
            nextSwap[i] = now + SWAP_MS + Math.random() * SWAP_JITTER_MS;
          }
          const fade = (i - front) / HEAD; // 0 at the front → 1 at the tip
          c.style.opacity = String(
            HEAD_OPACITY_MAX - fade * (HEAD_OPACITY_MAX - HEAD_OPACITY_MIN)
          );
        } else if (c.style.opacity !== "0") {
          c.style.opacity = "0"; // not reached yet (or a fringe space): empty
        }
      }
      if (front < n) {
        rafId = requestAnimationFrame(tick);
      } else {
        // Fully typed on → unlock back to plain inline text (zero layout
        // impact), ready to be measured fresh by the next pass.
        done = true;
        restore();
      }
    };
    rafId = requestAnimationFrame(tick);

    return () => {
      unbind();
      cancelAnimationFrame(rafId);
      restore();
    };
  }, [active, text]);

  return (
    <span className="decrypt" ref={rootRef}>
      {/* Stable accessible name; the animated glyphs are presentation only. */}
      <span className="decrypt__sr">{text}</span>
      <span className="decrypt__chars" aria-hidden="true">
        {words.map((word, wi) => (
          <Fragment key={wi}>
            {wi > 0 && <span className="decrypt__char"> </span>}
            <span
              className={`decrypt__word${
                accentWords.has(word) ? " decrypt__word--accent" : ""
              }`}
            >
              {Array.from(word).map((ch, ci) => (
                <span key={ci} className="decrypt__char">
                  {ch}
                </span>
              ))}
            </span>
          </Fragment>
        ))}
      </span>
    </span>
  );
}
