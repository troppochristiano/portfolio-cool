import { useEffect, useRef } from "react";
import { hoverEffectsDisabled } from "../lib/utils.js";
import {
  SWAP_MS,
  SWAP_JITTER_MS,
  randGlyph,
  lockCellWidths,
  clearCellWidths,
} from "../lib/noiseText.js";
import { GlyphCells } from "./GlyphCells.jsx";

// Cursor-localized scramble label (the aino.agency nav effect): while the
// pointer is over the parent pill, only the glyphs near the cursor's x flicker
// through random characters — the rest of the label stays legible. Excitation
// is edge-triggered: a glyph flickers for a short burst when the cursor first
// reaches it, then settles back to the real text even under a resting cursor;
// sweeping along the label excites glyph after glyph, so the wave of noise
// resolves behind the pointer instead of churning forever.
//
// The component renders one span per glyph and drives them imperatively
// (textContent) from a rAF loop; React never re-renders during the effect.
// It listens on the *parent* pill (closest button/a), not on itself, so the
// pill's padding is part of the hover surface.
//
// Alphabet, cadence, and the width-lock protocol live in lib/noiseText.js —
// shared with every other text-noise effect on the site. Locked widths are
// re-measured on every arm, so late font loads or resizes can never bake in
// stale metrics.

const RADIUS = 22; // px each side of the cursor that scrambles (~2-3 glyphs)
const SETTLE_MS = 300; // an excited glyph flickers this long, then settles

export function ScrambleText({ text }) {
  const rootRef = useRef(null);

  useEffect(() => {
    // Hover-only effect: skip on touch devices and for reduced motion (same
    // evaluate-per-mount semantics as the rest of the chrome).
    if (hoverEffectsDisabled()) return;
    const root = rootRef.current;
    const pill = root.closest("button, a") ?? root.parentElement;
    const cells = Array.from(root.querySelectorAll(".scramble__char"));
    const original = cells.map((c) => c.textContent);

    let rafId = 0;
    let hovering = false;
    let cursorX = 0;
    const centers = new Array(cells.length).fill(0);
    const wasNear = new Array(cells.length).fill(false);
    const hotUntil = new Array(cells.length).fill(0);
    const nextSwap = new Array(cells.length).fill(0);

    const restoreAll = () => {
      root.classList.remove("scramble--locked");
      cells.forEach((c, i) => {
        c.textContent = original[i];
      });
      clearCellWidths(cells);
    };

    const tick = (now) => {
      let anyHot = false;
      cells.forEach((c, i) => {
        if (original[i] === " ") return; // word gaps never scramble
        // Excite only on the cursor's arrival at a glyph (false→true edge);
        // holding still lets the burst expire so the label always resolves.
        const near = hovering && Math.abs(centers[i] - cursorX) <= RADIUS;
        if (near && !wasNear[i]) hotUntil[i] = now + SETTLE_MS;
        wasNear[i] = near;
        if (now < hotUntil[i]) {
          anyHot = true;
          if (now >= nextSwap[i]) {
            c.textContent = randGlyph();
            nextSwap[i] = now + SWAP_MS + Math.random() * SWAP_JITTER_MS;
          }
        } else if (c.textContent !== original[i]) {
          c.textContent = original[i];
        }
      });
      if (hovering || anyHot) {
        rafId = requestAnimationFrame(tick);
      } else {
        rafId = 0;
        restoreAll();
      }
    };

    const arm = (e) => {
      if (e.pointerType === "touch") return; // hybrid screens: taps must not stick
      hovering = true;
      cursorX = e.clientX;
      // Still cooling from the previous hover → the cells are locked and some
      // may show scrambled glyphs; re-measuring now would capture the wrong
      // metrics. The old geometry is still valid, so just keep the loop going.
      if (rafId) return;
      // lockCellWidths reads every rect before the first write, so layout is
      // computed once; null = not laid out (a real hover can't reach an
      // unpainted pill; stay idle).
      const rects = lockCellWidths(cells);
      if (!rects) {
        hovering = false;
        return;
      }
      rects.forEach((r, i) => {
        centers[i] = r.left + r.width / 2;
      });
      root.classList.add("scramble--locked");
      rafId = requestAnimationFrame(tick);
    };
    const move = (e) => {
      cursorX = e.clientX;
    };
    // No teardown here — the loop runs on until the trail has cooled, then
    // restores and unlocks itself.
    const disarm = () => {
      hovering = false;
    };

    pill.addEventListener("pointerenter", arm);
    pill.addEventListener("pointermove", move);
    pill.addEventListener("pointerleave", disarm);
    return () => {
      pill.removeEventListener("pointerenter", arm);
      pill.removeEventListener("pointermove", move);
      pill.removeEventListener("pointerleave", disarm);
      if (rafId) cancelAnimationFrame(rafId);
      restoreAll();
    };
  }, [text]);

  return (
    <span className="scramble" ref={rootRef}>
      <GlyphCells text={text} prefix="scramble" />
    </span>
  );
}
