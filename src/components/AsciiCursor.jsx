import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { hoverEffectsDisabled } from "../lib/utils.js";
import { lastPointer } from "../lib/lastPointer.js";

// The site's pointer: a small monospace reticle that replaces the native
// cursor everywhere under HeroLayout — the hero, the About overlay,
// /gallery and /create — and changes shape to say what's under it:
// bracketed over anything clickable, pinched over the draggable wall, an
// I-beam over reading copy, an x over a dead control, and on /create the
// whole tool vocabulary (crosshair, pick, move, four resize axes). On a
// click it spells C-L-I-C-K through the core cell, one letter at a time,
// while the brackets tuck in.
//
// Two pointers it does NOT replace, both by design: the draw pad's own
// .brush-cursor ring (it shows brush size, which a fixed mark can't) and
// Turnstile's cross-origin iframe (out of our stylesheet's reach). See the
// `hidden` and `none` states for how each steps aside.
//
// This is a replacement, not a companion. The core glyph is the hotspot: its
// transform is written SYNCHRONOUSLY in the pointermove handler, never from
// the rAF loop, so it is pixel-locked to the real pointer at any refresh
// rate. Only the arms carry spring state, and they are purely
// decorative — a cursor that lags its own position is a broken cursor, which
// is the deliberate inversion of CursorArtifact's spring-everything design.
//
// State comes from a selector table + closest(), NOT from
// getComputedStyle(el).cursor. That looks like the obvious approach and it
// cannot work: hiding the native cursor requires `cursor: none !important`
// (a bare inherited `cursor: none` on <html> loses to the UA stylesheet's own
// declarations on a[href]/button/input, and a non-important author rule loses
// to this project's own 3-class selectors like
// `.ascii-gallery.is-grabbing .ascii-plane`) — and that !important then makes
// every element compute to "none". The act of hiding destroys the signal. See
// the matching note over the hide rule in global.css.
//
// The rAF loop is kicked only by a state change or a press — never by
// pointermove. So a resting reticle runs zero frames, and a reticle sweeping
// across empty background at 120Hz also runs zero frames; the loop exists
// only for the ~250ms of arm travel after a change and the click word's
// ~500ms. That is the house rule (effects on interaction, nothing ambient)
// enforced structurally rather than by discipline.
//
// Safety: the <html> class that hides the native cursor is added on the first
// real fine-pointer move — not at mount — so there is never a window where
// the system cursor is gone but the reticle has no position yet. It is
// removed on unmount/route change (effect cleanup, which also covers
// StrictMode's dev double-invoke), on pointerleave, on window blur, on tab
// hide, and on the first touch event of the session. It is never written in
// JSX and never present in the static stylesheet, so a component that throws
// during render leaves no residue. If one ever does get stranded, the manual
// escape is:  document.documentElement.classList.remove("has-ascii-cursor")

// ── the click word ─────────────────────────────────────────────────
// Pressing a link spells CLICK through the core cell one letter at a time —
// C, L, I, C, K — so the reticle stays exactly one glyph wide the whole way
// and the hotspot never grows into a block of text sitting on the thing you
// just clicked.
//
// The word outlives the button press on purpose. A real click is ~80ms, one
// letter's worth, so it runs on its own clock from pointerdown and nothing
// interrupts it: not the button release, not the pointer leaving the link,
// not moving onto the wall or a paragraph. A half-spelled CLIC reads as a
// glitch, so the reticle finishes the word and only then takes the shape of
// whatever it has moved on to. A click is short enough that the delay this
// costs is never the thing you notice.
const WORD = "CLICK";
const LETTER_MS = 80; // dwell per letter …
const WORD_MS = LETTER_MS * WORD.length + 100; // … plus a beat on the K

// ── shape per state ────────────────────────────────────────────────
// An arm is [glyph, dx, dy] — a unit direction from the hotspot, scaled by
// the state's `spread` (px). Four slots, so a state can point in four
// directions at once; diagonals use ±0.7 on both axes so every arm sits the
// same distance out whatever direction it points.
//
// `spread` carries the meaning: wide = "this is a target", pinched = "you
// are holding it". The direction carries the rest — which is what lets the
// resize forms say which way a handle drags, the thing a single mark can't.
const D = 0.7; // ≈ 1/√2, so diagonal arms keep the same radius
const ARM_SLOTS = 4; // must be ≥ the longest `arms` below
const STATES = {
  default: { core: "+", arms: null, spread: 0 },
  link: { core: "+", arms: [["[", -1, 0], ["]", 1, 0]], spread: 12 },
  // press keeps the brackets and tucks them in; the core is driven letter by
  // letter for the word's lifetime, so `core` here is only the seed.
  press: { core: WORD[0], arms: [["[", -1, 0], ["]", 1, 0]], spread: 8 },
  grab: { core: "+", arms: [[">", -1, 0], ["<", 1, 0]], spread: 9 },
  grabbing: { core: "+", arms: [[">", -1, 0], ["<", 1, 0]], spread: 4 },
  text: { core: "|", arms: null, spread: 0 },
  disabled: { core: "x", arms: null, spread: 0 },

  // ── /create's tool vocabulary ────────────────────────────────────
  // Aiming: the arms pull back off the point so the hotspot stays clear.
  crosshair: { core: "+", arms: [["-", -1, 0], ["-", 1, 0]], spread: 13 },
  // Picking a colour off the stage — the site's densest ramp glyph reads as
  // "sample this pixel" better than a second bracket form would.
  pick: { core: "@", arms: null, spread: 0 },
  // Move is the only four-way form; resize forms name their own axis.
  move: {
    core: "+",
    arms: [["<", -1, 0], [">", 1, 0], ["^", 0, -1], ["v", 0, 1]],
    spread: 11,
  },
  "size-ew": { core: "+", arms: [["<", -1, 0], [">", 1, 0]], spread: 11 },
  "size-ns": { core: "+", arms: [["^", 0, -1], ["v", 0, 1]], spread: 11 },
  "size-nwse": {
    core: "+",
    arms: [["\\", -D, -D], ["\\", D, D]],
    spread: 12,
  },
  "size-nesw": { core: "+", arms: [["/", -D, D], ["/", D, -D]], spread: 12 },

  // The draw pad's own .brush-cursor ring is the pointer in there and shows
  // brush size, which we can't. Step aside — but stay `cursor: none`, or the
  // system arrow would come back alongside the ring.
  hidden: { core: "", arms: null, spread: 0 },
  // data-cursor="none": the reticle steps aside AND CSS hands the native
  // cursor back for that subtree (iframes and anything else we can't style).
  none: { core: "", arms: null, spread: 0 },
};

// ── what counts as what ────────────────────────────────────────────
// Ordered, but the DEEPEST closest() match wins, not the first. Every match
// is an ancestor-or-self of the same target, so containment is a total order
// over them — one check per pair, no tree walking. Deepest-wins is what lets
// `.ascii-plane` (a tile on the wall) read as a link while the bare
// `.ascii-gallery` under it reads as grabbable, with no hand-ordering of the
// table around DOM nesting. Rule order only breaks exact ties.
const RULES = [
  ["disabled", ":disabled, [aria-disabled='true']"],
  // An allowlist, not `input:not(…)`. The exclusion form kept quietly
  // claiming every input type nobody thought to exclude — range sliders on
  // /create were reading as an I-beam.
  [
    "text",
    "input:not([type]), input[type='text'], input[type='search'], input[type='email'], input[type='url'], input[type='tel'], input[type='password'], input[type='number'], textarea, [contenteditable]:not([contenteditable='false'])",
  ],

  // ── /create's tools, innermost first ─────────────────────────────
  // These sit inside each other (handles inside the crop editor inside the
  // stage), which deepest-wins already resolves. Order here only settles
  // ties on ONE element — which is exactly what .brush-active and
  // .is-picking are, so both must precede the bare rule they qualify.
  ["hidden", ".draw-pad.brush-active"],
  ["pick", ".stage-overlay.is-picking"],
  ["size-nwse", ".crop-handle--nw, .crop-handle--se"],
  ["size-nesw", ".crop-handle--ne, .crop-handle--sw"],
  ["size-ns", ".crop-handle--n, .crop-handle--s, .stage-resize"],
  [
    "size-ew",
    ".crop-handle--e, .crop-handle--w, .trimbar__handle, input[type='range']",
  ],
  ["move", ".crop-editor"],
  ["crosshair", ".draw-pad, .stage-overlay"],

  // Above `link` deliberately. .mini-monitor is a div[role="button"], so it
  // ties with the link rule on one element and rule order is the decider —
  // and its own CSS says grab/grabbing, i.e. the thing you do with it is
  // drag it. The wall/tile pair is unaffected either way: .ascii-plane is
  // deeper than .ascii-gallery, so depth settles that one, not order.
  ["grab", ".ascii-gallery, .mini-monitor"],

  // Note what is NOT here: .works-row. The row's clickable part is its
  // toggle button, which is width:100% and so already covered by `button` —
  // listing the whole <li> instead would reach down into the expanded panel
  // and make its empty space claim to be a target.
  // The input types listed here are the clickable ones. They are not
  // buttons and not text, so without naming them they fell through to
  // `default` — a colour swatch and a checkbox read as bare background.
  [
    "link",
    "a[href], button, [role='button'], summary, label[for], select, input[type='color'], input[type='checkbox'], input[type='radio'], input[type='file'], input[type='button'], input[type='submit'], input[type='reset'], .ascii-plane, .gallery-card, .contact-link",
  ],
];

// ── motion ─────────────────────────────────────────────────────────
const STIFF = 260; // arm spring pull …
const DAMP = 26; // … near-critical: arms settle, they never overshoot.
// Overshoot reads as charm on a pet and as sloppiness on a cursor.
const SETTLE_PX = 0.15;
const SETTLE_VEL = 0.5;
const MAX_DT_MS = 64; // a throttled tab must not teleport the arms

// Colour is one flat white plus a drop shadow, handled entirely in CSS —
// there is deliberately no per-surface colour logic. An earlier pass sampled
// the painted background so an accent-blue reticle could dodge the ~nine
// blue pills it would have vanished into; white needs no such rescue, and
// the shadow covers the bright-ASCII case the sampler never could (canvas
// pixels have no background-color to read).

export function AsciiCursor({ enabled = true }) {
  // Same gate every hover effect on this site uses, evaluated per-run. No
  // "reticle but no spring" mode: someone who asked for reduced motion should
  // keep the cursor their OS gave them.
  const disabled = !enabled || hoverEffectsDisabled();

  const rootRef = useRef(null);
  const coreRef = useRef(null);
  // Four arm slots, enough for the widest form (move). A state uses as many
  // as it needs and the rest are hidden — they are never remounted, so the
  // spring never restarts mid-travel just because a form grew an arm.
  const armRefs = useRef([]);

  useEffect(() => {
    if (disabled) return undefined;
    const root = rootRef.current;
    const core = coreRef.current;
    const arms = armRefs.current;
    if (!root || !core || arms.length !== ARM_SLOTS) return undefined;
    const html = document.documentElement;

    // All mutable state is local to the effect — nothing at module scope, so
    // StrictMode's mount → cleanup → mount leaves exactly one live set.
    let kind = "default"; // what the DOM says is under the pointer
    let state = "default"; // …plus the press flag, resolved
    let pressed = false;
    let armed = false;
    let quiet = false; // inside the contact section (see below)
    let lastTarget = null; // skip the whole resolve while on one element
    let spread = 0;
    let targetSpread = 0;
    let vel = 0;
    let wordStart = 0; // when the click word began …
    let wordUntil = 0; // … and when it gives the pointer back
    let wordIndex = -1; // which letter of WORD is showing
    let rafId = 0;
    let lastT = 0;
    let refreshId = 0;
    let alive = true;

    // ── resolve ──────────────────────────────────────────────────
    const kindFor = (target) => {
      if (!(target instanceof Element)) return "default";
      // The escape hatch enters the same deepest-wins comparison and wins
      // exact ties, so a data-cursor on an element beats the rule that would
      // otherwise have matched it.
      const override = target.closest("[data-cursor]");
      let bestEl = override || null;
      let bestKind = override ? override.dataset.cursor : "default";
      for (const [name, sel] of RULES) {
        const el = target.closest(sel);
        if (!el) continue;
        if (!bestEl || (bestEl !== el && bestEl.contains(el))) {
          bestEl = el;
          bestKind = name;
        }
      }
      return STATES[bestKind] ? bestKind : "default";
    };

    const resolveFrom = (target) => {
      // Most pointermoves stay on the element they were already on; bailing
      // here is what keeps a 120Hz sweep down to a single transform write.
      if (target === lastTarget) return;
      lastTarget = target;
      const el = target instanceof Element ? target : null;
      kind = kindFor(target);
      const q = !!el && !!el.closest("#contact");
      if (q !== quiet) {
        quiet = q;
        root.classList.toggle("is-quiet", quiet);
      }
      paint();
    };

    // ── paint ────────────────────────────────────────────────────
    // Writes data-state SYNCHRONOUSLY, never from the loop, so the whole
    // state machine is observable (and testable) without rAF running.
    const paint = () => {
      const now = performance.now();
      let next =
        kind === "none"
          ? "none"
          : pressed && kind === "grab"
            ? "grabbing"
            : pressed && kind === "link"
              ? "press"
              : kind;
      // Nothing interrupts the word. It finishes spelling and only then does
      // the reticle take whatever shape the pointer has moved on to.
      if (next !== "press" && now < wordUntil) next = "press";
      if (next === state) return;
      state = next;
      const spec = STATES[state];
      root.dataset.state = state;
      // Glyph and direction are per-state and written once here; only the
      // radius (--spread) is touched per frame.
      for (let i = 0; i < ARM_SLOTS; i++) {
        const arm = arms[i];
        const a = spec.arms?.[i];
        if (!a) {
          arm.removeAttribute("data-on");
          continue;
        }
        arm.textContent = a[0];
        arm.style.setProperty("--ax", a[1]);
        arm.style.setProperty("--ay", a[2]);
        arm.dataset.on = "";
      }
      targetSpread = spec.spread;
      if (state === "press") {
        wordStart = now;
        wordUntil = now + WORD_MS;
        wordIndex = -1;
        drawWord(now); // the C lands before the next repaint, not a frame late
      } else {
        wordUntil = 0;
        core.textContent = spec.core;
      }
      // Contact: no spring — see the section note below. The word is
      // suppressed there too (ContactLiquid answers the click with its own
      // splash; two effects for one click is one too many), so `press`
      // simply never becomes a word there.
      if (quiet) {
        spread = targetSpread;
        vel = 0;
        writeSpread();
        if (state === "press") {
          core.textContent = STATES.link.core;
          wordUntil = 0;
        }
        return;
      }
      kick();
    };

    // One letter at a time. Writes only when the letter actually changes, so
    // holding on the K costs nothing per frame.
    const drawWord = (now) => {
      const i = Math.min(
        WORD.length - 1,
        Math.floor((now - wordStart) / LETTER_MS)
      );
      if (i === wordIndex) return;
      wordIndex = i;
      core.textContent = WORD[i];
    };

    const writeSpread = () => {
      root.style.setProperty("--spread", `${spread.toFixed(2)}px`);
    };

    // ── loop ─────────────────────────────────────────────────────
    const tick = (now) => {
      const dt = Math.min(now - lastT, MAX_DT_MS) / 1000;
      lastT = now;

      vel += ((targetSpread - spread) * STIFF - vel * DAMP) * dt;
      spread += vel * dt;
      writeSpread();

      const wording = now < wordUntil;
      if (wording) {
        drawWord(now);
      } else if (wordUntil) {
        // Time's up: hand the pointer back to whatever it is over now.
        wordUntil = 0;
        paint();
      }

      if (
        !wording &&
        Math.abs(targetSpread - spread) < SETTLE_PX &&
        Math.abs(vel) < SETTLE_VEL
      ) {
        spread = targetSpread;
        vel = 0;
        writeSpread();
        rafId = 0; // settled — the loop stops itself and stays stopped
        return;
      }
      rafId = requestAnimationFrame(tick);
    };

    const kick = () => {
      if (rafId) return;
      lastT = performance.now();
      rafId = requestAnimationFrame(tick);
    };

    // ── arm / disarm ─────────────────────────────────────────────
    const arm = () => {
      if (armed) return;
      armed = true;
      html.classList.add("has-ascii-cursor");
      root.classList.add("is-armed");
    };
    const disarm = () => {
      if (!armed) return;
      armed = false;
      html.classList.remove("has-ascii-cursor");
      root.classList.remove("is-armed");
    };

    // ── events ───────────────────────────────────────────────────
    const onMove = (e) => {
      if (e.pointerType === "touch") return disarm();
      root.style.transform = `translate3d(${e.clientX}px, ${e.clientY}px, 0)`;
      arm();
      resolveFrom(e.target);
    };
    const onOver = (e) => {
      if (e.pointerType === "touch") return;
      resolveFrom(e.target);
    };
    const onDown = (e) => {
      if (e.pointerType === "touch") return disarm();
      pressed = true;
      paint();
    };
    const onUp = () => {
      if (!pressed) return;
      pressed = false;
      paint();
    };
    const onHide = () => {
      if (document.hidden) disarm();
    };

    // Scrolling slides content under a resting pointer without firing a
    // single pointer event — the same blind spot ContactLiquid and
    // CursorArtifact both hit. Re-hit-test from the page-wide record instead.
    // Coalesced behind one frame because Lenis drives the About overlay's
    // scroll at frame rate and every elementFromPoint flushes style.
    const refresh = () => {
      refreshId = 0;
      if (!armed) return;
      const p = lastPointer();
      if (!p) return;
      const el = document.elementFromPoint(p.x, p.y);
      if (el) resolveFrom(el);
    };
    const scheduleRefresh = () => {
      if (!refreshId) refreshId = requestAnimationFrame(refresh);
    };

    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("pointerover", onOver, { passive: true });
    window.addEventListener("pointerdown", onDown, { passive: true });
    window.addEventListener("pointerup", onUp, { passive: true });
    window.addEventListener("pointercancel", onUp, { passive: true });
    window.addEventListener("blur", disarm);
    document.addEventListener("pointerleave", disarm);
    document.addEventListener("visibilitychange", onHide);
    document.addEventListener("scroll", scheduleRefresh, {
      capture: true,
      passive: true,
    });
    window.addEventListener("resize", scheduleRefresh, { passive: true });

    // Optical centring: translate(-50%,-50%) centres the glyph's BOX, and a
    // monospace glyph's ink is not centred in its box — the reticle would sit
    // a pixel or two off the true hotspot. Solve the offset once from the
    // real font metrics (same measureText idiom ContactLiquid uses for its
    // baseline) and hand it to CSS as --core-nudge. Measured on "+", the
    // hotspot mark; the other glyphs ride along. Unsupported metrics fall
    // back to 0, which is the pre-measurement look, not a broken one.
    document.fonts?.ready?.then(() => {
      if (!alive) return;
      const cs = getComputedStyle(core);
      const size = parseFloat(cs.fontSize) || 13;
      const ctx = document.createElement("canvas").getContext("2d");
      if (!ctx) return;
      ctx.font = `${cs.fontSize} ${cs.fontFamily}`;
      ctx.textBaseline = "alphabetic";
      const m = ctx.measureText("+");
      const fa = m.fontBoundingBoxAscent;
      const fd = m.fontBoundingBoxDescent;
      const ia = m.actualBoundingBoxAscent;
      const id = m.actualBoundingBoxDescent;
      if (![fa, fd, ia, id].every(Number.isFinite)) return;
      // line-height is 1, so the box is `size` tall: half-leading puts the
      // baseline here, and the ink centre sits (ia - id)/2 above it.
      const baseline = (size - (fa + fd)) / 2 + fa;
      const inkCentre = baseline - (ia - id) / 2;
      root.style.setProperty("--core-nudge", `${(size / 2 - inkCentre).toFixed(2)}px`);
    });

    return () => {
      alive = false;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerover", onOver);
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      window.removeEventListener("blur", disarm);
      document.removeEventListener("pointerleave", disarm);
      document.removeEventListener("visibilitychange", onHide);
      document.removeEventListener("scroll", scheduleRefresh, {
        capture: true,
      });
      window.removeEventListener("resize", scheduleRefresh);
      if (rafId) cancelAnimationFrame(rafId);
      if (refreshId) cancelAnimationFrame(refreshId);
      rafId = 0;
      refreshId = 0;
      // Last line of defence: whatever happened above, the visitor gets
      // their cursor back.
      disarm();
    };
  }, [disabled]);

  if (disabled) return null;
  return createPortal(
    <div className="ascii-cursor" ref={rootRef} data-state="default" aria-hidden="true">
      <span className="ascii-cursor__core" ref={coreRef}>
        +
      </span>
      {Array.from({ length: ARM_SLOTS }, (_, i) => (
        <span
          key={i}
          className="ascii-cursor__arm"
          ref={(el) => (armRefs.current[i] = el)}
        />
      ))}
    </div>,
    document.body
  );
}
