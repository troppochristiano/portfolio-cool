import { useEffect, useRef } from "react";
import { hoverEffectsDisabled } from "../lib/utils.js";
import {
  floodNoise,
  lockCellWidths,
  sweepResolve,
} from "../lib/noiseText.js";

// The ▙▟ appbar brand mark. Hovering (or keyboard-focusing) splits the mark —
// the halves drift apart and the name expands out between them; that reveal is
// pure CSS (.brand-logo in global.css). While the pill stays open, this
// component cycles the revealed text through PHRASES: each swap floods the
// label with pool noise that a left→right front resolves into the next phrase
// — the family alphabet, cadence, and width lock from lib/noiseText.js.
//
// The label is one span per glyph, driven imperatively (textContent) from a
// rAF loop; React renders the resting phrase once and never re-renders during
// the effect. The face may fall back to proportional, so during a morph every
// cell is locked to the advance measured from the target phrase's real glyphs
// (.brand-logo__cells--locked), and the name's grid track is pinned to
// explicit px widths so the pill glides between phrase widths on the
// stylesheet's own transition instead of trusting content-driven 1fr resizes
// to animate. Idle and between morphs the cells are plain inline text and the
// track is back on 0fr/1fr — zero layout impact, and open/close keep their
// fr↔fr interpolation.

// Phrases the pill cycles through while hovered — edit freely; the first one
// is the resting label every hover starts from and returns to.
const PHRASES = [
  "Christian Bianchi",
  "Frontend Developer",
  "Creative Developer",
  "Click for home",
];
const HOLD_MS = 1800; // a phrase rests readable this long between morphs
const SWEEP_MS = 450; // resolve front travel across the label, end to end

export function BrandLogo({ onClick }) {
  const btnRef = useRef(null);
  const nameRef = useRef(null); // .brand-logo__name — the pinnable grid track
  const cellsRef = useRef(null); // .brand-logo__cells — the glyph cells' parent

  useEffect(() => {
    // Hover-only effect: skip on touch devices and for reduced motion (same
    // evaluate-per-mount semantics as ScrambleText) — the pill then always
    // shows the resting phrase.
    if (hoverEffectsDisabled()) return;
    const btn = btnRef.current;
    const nameEl = nameRef.current;
    const wrap = cellsRef.current;

    let cancelSweep = null;
    let holdT = 0;
    let index = 0; // which phrase the cells currently show

    // Swap the label to `glyphs` as plain unlocked spans (the resting shape).
    const build = (glyphs) => {
      wrap.replaceChildren(
        ...glyphs.map((ch) => {
          const s = document.createElement("span");
          s.className = "brand-logo__cell";
          s.textContent = ch;
          return s;
        }),
      );
      return Array.from(wrap.children);
    };

    const unlock = () => {
      wrap.classList.remove("brand-logo__cells--locked");
      for (const c of wrap.children) c.style.width = "";
    };

    // Hard stop + return to the resting phrase. Runs when the pointer leaves,
    // so the pill is already collapsing (opacity is out in 0.12s) — the snap
    // back to the name is effectively unseen, and the next hover always opens
    // on it.
    const reset = () => {
      cancelSweep?.();
      cancelSweep = null;
      clearTimeout(holdT);
      holdT = 0;
      unlock();
      nameEl.style.gridTemplateColumns = "";
      index = 0;
      build(Array.from(PHRASES[0]));
    };

    const morph = (glyphs) => {
      // Pin the track at its current used width first: the resize below is
      // then a reliable px→px transition on the stylesheet's grid-template
      // curve, with no visual change at pin time.
      nameEl.style.gridTemplateColumns = `${nameEl.getBoundingClientRect().width}px`;
      // Real target text in, then measure — locked widths must come from the
      // actual glyphs so the resolved phrase occupies exactly the same
      // geometry as the noise (the family's lock model).
      const cells = build(glyphs);
      const rects = lockCellWidths(cells);
      // Not laid out (unpainted corner case) — locking to 0px would collapse
      // the label; snap the swap over and keep the loop going.
      if (!rects) {
        nameEl.style.gridTemplateColumns = "";
        holdT = setTimeout(advance, HOLD_MS);
        return;
      }
      wrap.classList.add("brand-logo__cells--locked");
      floodNoise(cells, glyphs);
      // The cells' summed advances are the phrase's natural width, so when the
      // morph ends and the track goes back on 1fr there is no jump.
      const targetW = rects.reduce((w, r) => w + r.width, 0);
      nameEl.style.gridTemplateColumns = `${targetW}px`;

      cancelSweep = sweepResolve({
        cells,
        target: glyphs,
        sweepMs: SWEEP_MS,
        onDone: () => {
          // Fully resolved → back to plain inline text and the 1fr track,
          // ready to be measured fresh by the next morph.
          cancelSweep = null;
          unlock();
          nameEl.style.gridTemplateColumns = "";
          holdT = setTimeout(advance, HOLD_MS);
        },
      });
    };

    const advance = () => {
      index = (index + 1) % PHRASES.length;
      morph(Array.from(PHRASES[index]));
    };

    // The loop runs while the pointer is over the pill OR it has visible
    // keyboard focus (the CSS reveal fires on exactly those two states). A
    // plain mouse-click focus keeps `focused` false so the cycle really stops
    // when the pointer leaves.
    let hovering = false;
    let focused = false;
    let engaged = false;
    const update = () => {
      const want = hovering || focused;
      if (want && !engaged) {
        engaged = true;
        holdT = setTimeout(advance, HOLD_MS);
      } else if (!want && engaged) {
        engaged = false;
        reset();
      }
    };
    const enter = (e) => {
      if (e.pointerType === "touch") return; // hybrid screens: taps must not stick
      hovering = true;
      update();
    };
    const leave = () => {
      hovering = false;
      update();
    };
    const focus = () => {
      focused = btn.matches(":focus-visible");
      update();
    };
    const blur = () => {
      focused = false;
      update();
    };

    btn.addEventListener("pointerenter", enter);
    btn.addEventListener("pointerleave", leave);
    btn.addEventListener("focus", focus);
    btn.addEventListener("blur", blur);
    return () => {
      btn.removeEventListener("pointerenter", enter);
      btn.removeEventListener("pointerleave", leave);
      btn.removeEventListener("focus", focus);
      btn.removeEventListener("blur", blur);
      reset();
    };
  }, []);

  return (
    <button
      type="button"
      className="brand-logo"
      aria-label="Christian Bianchi — home"
      onClick={onClick}
      ref={btnRef}
    >
      <span className="brand-logo__half">▙</span>
      <span className="brand-logo__name" ref={nameRef}>
        {/* Stable accessible name comes from the button's aria-label; the
            cycling glyphs are presentation only. */}
        <span className="brand-logo__cells" ref={cellsRef} aria-hidden="true">
          {Array.from(PHRASES[0]).map((ch, i) => (
            <span key={i} className="brand-logo__cell">
              {ch}
            </span>
          ))}
        </span>
      </span>
      <span className="brand-logo__half">▟</span>
    </button>
  );
}
