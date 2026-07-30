import { useLayoutEffect, useRef } from "react";
import { prefersReducedMotion } from "../lib/utils.js";
import {
  floodNoise,
  lockCellWidths,
  clearCellWidths,
  sweepResolve,
} from "../lib/noiseText.js";
import { GlyphCells } from "./GlyphCells.jsx";

// Label that DECODES between values instead of cutting: whenever `text`
// changes the whole label floods with pool noise and a left→right front
// resolves it into the new word — the nav menu toggle's "menu" ⇄ "close" swap.
//
// The smallest member of the noise-text family (lib/noiseText.js): no
// sweep-in from empty, no idle state, just a morph between two resting words.
//
// React owns the cells: it commits the NEW text, then this effect (layout
// phase, so the new word never paints bare for a frame) floods them with noise
// and resolves them back. Widths are locked to the target glyphs' measured
// advances for the morph's lifetime — the main face is mono but its fallbacks
// aren't, so noise glyphs could otherwise nudge the label and shove the icon
// beside it. Idle the cells are plain inline text with zero layout impact.

const SWEEP_MS = 340; // resolve front travel across the label, end to end

export function DecodeSwap({ text }) {
  const rootRef = useRef(null);
  // The word the cells are already resting on. Gating on the VALUE (not a
  // first-run flag) keeps the mount silent — the chrome fades in with the rest
  // of the bar and shouldn't churn on arrival — and stays silent through
  // StrictMode's double-invoked effects, which would otherwise morph the label
  // into noise the moment it mounts.
  const shown = useRef(text);

  useLayoutEffect(() => {
    if (shown.current === text) return;
    shown.current = text;
    if (prefersReducedMotion()) return; // the JSX already carries the new word
    const root = rootRef.current;
    const cells = Array.from(root.querySelectorAll(".decode-swap__char"));
    // The PROP is what the cells must resolve to — never read the target back
    // out of the DOM. On a swap the outgoing effect's cleanup runs after React
    // has already committed the new word and writes its own (now stale) text
    // over these cells; reading textContent here would adopt that stale word
    // as the target and the label would rest on it ("close" → "clos").
    const target = Array.from(text);
    if (cells.length !== target.length) return;

    const restore = () => {
      root.classList.remove("decode-swap--locked");
      cells.forEach((c, i) => {
        c.textContent = target[i];
      });
      clearCellWidths(cells);
    };

    // Measure the real target glyphs before writing any noise. Null = not
    // laid out (menu toggled while the bar is unpainted) — locking to 0px
    // would collapse the label; leave the plain swap alone.
    if (!lockCellWidths(cells)) return;
    floodNoise(cells, target);
    root.classList.add("decode-swap--locked");

    // Fully resolved → back to plain inline text, ready to be measured fresh
    // by the next swap.
    const cancel = sweepResolve({
      cells,
      target,
      sweepMs: SWEEP_MS,
      onDone: restore,
    });

    return () => {
      cancel();
      restore();
    };
  }, [text]);

  return (
    <span className="decode-swap" ref={rootRef}>
      <GlyphCells text={text} prefix="decode-swap" />
    </span>
  );
}
