import { useEffect, useRef } from "react";
import { POOL } from "./ScrambleText.jsx";
import { isCoarsePointer, prefersReducedMotion } from "../lib/utils.js";

// The ▙▟ appbar brand mark. Hovering (or keyboard-focusing) splits the mark —
// the halves drift apart and the name expands out between them; that reveal is
// pure CSS (.brand-logo in global.css). While the pill stays open, this
// component cycles the revealed text through PHRASES: each swap floods the
// label with pool noise that a left→right front resolves into the next phrase
// — the same alphabet and swap cadence as the nav pills' hover scramble
// (ScrambleText) and the About headline (DecryptText).
//
// The label is one span per glyph, driven imperatively (textContent) from a
// rAF loop; React renders the resting phrase once and never re-renders during
// the effect. Akkurat is proportional, so during a morph every cell is locked
// to the advance measured from the target phrase's real glyphs
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
const SWAP_MS = 34; // min hold per random glyph (same cadence as ScrambleText)
const SWAP_JITTER_MS = 26; // …plus per-glyph jitter so cells don't flip in lockstep

export function BrandLogo({ onClick }) {
  const btnRef = useRef(null);
  const nameRef = useRef(null); // .brand-logo__name — the pinnable grid track
  const cellsRef = useRef(null); // .brand-logo__cells — the glyph cells' parent

  useEffect(() => {
    // Hover-only effect: skip on touch devices and for reduced motion (same
    // evaluate-per-mount semantics as ScrambleText) — the pill then always
    // shows the resting phrase.
    if (prefersReducedMotion() || isCoarsePointer()) return;
    const btn = btnRef.current;
    const nameEl = nameRef.current;
    const wrap = cellsRef.current;

    let rafId = 0;
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
      cancelAnimationFrame(rafId);
      rafId = 0;
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
      // geometry as the noise (DecryptText's lock model).
      const cells = build(glyphs);
      const rects = cells.map((c) => c.getBoundingClientRect());
      // Not laid out (unpainted corner case) — locking to 0px would collapse
      // the label; snap the swap over and keep the loop going.
      if (!rects.length || rects[0].width === 0) {
        nameEl.style.gridTemplateColumns = "";
        holdT = setTimeout(advance, HOLD_MS);
        return;
      }
      wrap.classList.add("brand-logo__cells--locked");
      cells.forEach((c, i) => {
        c.style.width = `${rects[i].width}px`;
        if (glyphs[i] !== " ")
          c.textContent = POOL[(Math.random() * POOL.length) | 0];
      });
      // The cells' summed advances are the phrase's natural width, so when the
      // morph ends and the track goes back on 1fr there is no jump.
      const targetW = rects.reduce((w, r) => w + r.width, 0);
      nameEl.style.gridTemplateColumns = `${targetW}px`;

      const n = cells.length;
      const t0 = performance.now();
      const nextSwap = new Array(n).fill(0);
      const tick = (now) => {
        // Wall-clock front so a throttled tab still lands the swap in
        // ~SWEEP_MS: resolved text behind it, flickering noise ahead of it.
        const front = ((now - t0) / SWEEP_MS) * n;
        for (let i = 0; i < n; i++) {
          const c = cells[i];
          if (i < front) {
            if (c.textContent !== glyphs[i]) c.textContent = glyphs[i];
          } else if (glyphs[i] !== " " && now >= nextSwap[i]) {
            c.textContent = POOL[(Math.random() * POOL.length) | 0];
            nextSwap[i] = now + SWAP_MS + Math.random() * SWAP_JITTER_MS;
          }
        }
        if (front < n) {
          rafId = requestAnimationFrame(tick);
        } else {
          // Fully resolved → back to plain inline text and the 1fr track,
          // ready to be measured fresh by the next morph.
          rafId = 0;
          unlock();
          nameEl.style.gridTemplateColumns = "";
          holdT = setTimeout(advance, HOLD_MS);
        }
      };
      rafId = requestAnimationFrame(tick);
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
