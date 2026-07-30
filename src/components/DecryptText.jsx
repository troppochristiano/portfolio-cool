import { Fragment, useEffect, useMemo, useRef } from "react";
import { prefersReducedMotion } from "../lib/utils.js";
import {
  lockCellWidths,
  clearCellWidths,
  sweepResolve,
} from "../lib/noiseText.js";

// "Scramble-in" reveal for the About headline (after the Osmo effect-02 look):
// the line starts empty, and when `active` flips on a front sweeps left→right
// typing the text on. Behind the front the real text sits solid; just ahead
// of it a short window of pool glyphs flickers, fading out toward its tip —
// so the noise never covers the whole line, it's a fringe the text emerges
// from. Beyond the fringe there is nothing. Flipping `active` off empties the
// line again, so the reveal replays on every open.
//
// Alphabet, cadence, and the sweep live in lib/noiseText.js (the fringe mode
// of sweepResolve is this component's); the reveal is time-driven (on overlay
// settle), not scroll-driven like the reference.
//
// Layout safety in a proportional face: every glyph cell is locked to the
// advance measured from the real laid-out text for the whole idle+reveal
// lifetime, and words are wrapped in white-space:nowrap spans (spaces are
// their own cells), so the empty line, the fringe, and the final text all
// occupy identical geometry — nothing reflows as glyphs appear. The lock is
// released once the reveal completes. The overlay is visibility:hidden while
// closed but still laid out, so the idle pass can measure real metrics.

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
    let cancelSweep = null;

    const restore = () => {
      root.classList.remove("decrypt--locked");
      cells.forEach((c, i) => {
        c.textContent = original[i];
        c.style.opacity = "";
      });
      clearCellWidths(cells);
    };

    // Freeze every cell at its natural advance. Restore first — metrics must
    // come from the real glyphs at full flow, not leftover state. Re-measured
    // on every `active` flip, so resizes can't bake in stale widths.
    const lock = () => {
      restore();
      // Null = not laid out (unpainted corner case) — locking to 0px would
      // collapse the headline; leave the real text alone.
      if (!lockCellWidths(cells)) return false;
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

    // Settled open → type on.
    if (!lock()) return;
    hideAll();
    cancelSweep = sweepResolve({
      cells,
      target: original,
      sweepMs: SWEEP_MS,
      fringe: {
        head: HEAD,
        opacityMax: HEAD_OPACITY_MAX,
        opacityMin: HEAD_OPACITY_MIN,
      },
      onDone: () => {
        // Fully typed on → unlock back to plain inline text (zero layout
        // impact), ready to be measured fresh by the next pass.
        done = true;
        restore();
      },
    });

    return () => {
      unbind();
      cancelSweep?.();
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
