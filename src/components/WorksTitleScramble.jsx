import { useEffect, useRef } from "react";
import { prefersReducedMotion } from "../lib/utils.js";
import {
  randGlyph,
  lockCellWidths,
  clearCellWidths,
} from "../lib/noiseText.js";
import { GlyphCells } from "./GlyphCells.jsx";

// Works-row title scramble (the negative-films culture-page services effect):
// entering the row runs one left-to-right burst — each glyph cycles a handful
// of random characters, then settles back to the real text. Unlike
// ScrambleText's cursor-localized flicker, this is a single whole-word pass;
// the timing (25 ms stagger, 25 ms swap, 5 swaps per glyph) is ported from
// that site's scramble.js — deliberately NOT the family cadence in
// lib/noiseText.js, though the alphabet and width-lock protocol are shared.
//
// Hover is not detected here. AboutOverlay owns one hover truth for the works
// list — pointer events plus a scroll-time hit test, so a row scrolled under a
// resting cursor counts — and hands it down as `active`.
const STAGGER_MS = 25; // per-glyph start delay, left to right
const SWAP_MS = 25; // hold per random glyph
const SWAPS = 5; // random glyphs shown before a cell settles

export function WorksTitleScramble({ text, active }) {
  const rootRef = useRef(null);

  useEffect(() => {
    // Reduced motion only — not hoverEffectsDisabled(): on coarse pointers
    // AboutOverlay's scroll spotlight drives `active`, so touch is a valid
    // trigger here. The owner decides when; this effect only honors stillness.
    if (!active || prefersReducedMotion()) return;
    const root = rootRef.current;
    const cells = Array.from(root.querySelectorAll(".scramble__char"));
    const original = cells.map((c) => c.textContent);

    let starts = []; // pending per-glyph stagger timeouts
    let swaps = []; // running per-glyph swap intervals

    const stop = () => {
      starts.forEach(clearTimeout);
      swaps.forEach(clearInterval);
      starts = [];
      swaps = [];
      root.classList.remove("scramble--locked");
      cells.forEach((c, i) => {
        c.textContent = original[i];
      });
      clearCellWidths(cells);
    };

    const arm = () => {
      // Null = not laid out (hidden/unsized frame) — locking to 0px would
      // collapse the title. A real hover can't reach an unpainted row.
      if (!lockCellWidths(cells)) return;
      root.classList.add("scramble--locked");
      cells.forEach((c, i) => {
        if (original[i] === " ") return; // word gaps never scramble
        starts.push(
          setTimeout(() => {
            let n = 0;
            const id = setInterval(() => {
              if (++n > SWAPS) {
                clearInterval(id);
                c.textContent = original[i];
                return;
              }
              c.textContent = randGlyph();
            }, SWAP_MS);
            swaps.push(id);
          }, i * STAGGER_MS),
        );
      });
    };

    arm();
    return stop;
  }, [text, active]);

  return (
    <span className="scramble" ref={rootRef}>
      <GlyphCells text={text} prefix="scramble" />
    </span>
  );
}
