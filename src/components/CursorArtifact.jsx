import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  clamp,
  clamp01,
  isCoarsePointer,
  MONO_ADVANCE,
  prefersReducedMotion,
} from "../lib/utils.js";
import { POOL } from "./ScrambleText.jsx";

// A little ascii artifact that tags along behind the cursor across the About
// overlay's chapters — with a different glyph per section, swapped AT the
// section border, not by fading.
//
// `faces` maps section ids to Create-page figure.json exports (bird / fish /
// dog…). The follower renders one face layer per section, stacked on the same
// chase point; per frame each layer is clip-path'd to its own section's
// y-band (in the shared scroll content, so bands are layout-static). While
// the box straddles a border the upper section's creature shows above the
// line and the next one below it — a seamless wipe through the boundary,
// cousin to the overlay's dissolve. Away from borders exactly one face is
// visible and only visible faces animate. The opacity fade exists solely for
// entering/leaving the whole column (and the pointer resting outside any
// section's band simply clips everything away — no fade there either).
//
// Each figure face plays clean at its authored fps while the pointer rests;
// while the blob is chasing hard playback speeds up (it hurries after the
// cursor) and a few cells glitch through POOL noise, some in accent blue —
// the site's excite-then-settle temperament. Settled doesn't mean parked:
// an off-ratio two-sine drift keeps the pet loitering around the pointer
// instead of stopping, and it faces the way it's moving — a hard sweep turns
// it instantly, the idle drift turns it lazily at each reversal. Facing is a
// true text mirror (rows reversed, directional glyphs swapped), never a CSS
// flip, so every frame stays real upright characters. Author bakes facing
// LEFT; movement to the right shows the mirrored frames.
//
// Motion is a soft spring (position + velocity state, slightly underdamped),
// not a lerp — the pet banks into turns and overshoots a little, so it
// floats rather than tracks. While the Works hover preview is on screen the
// pet leaves the pointer and orbits the image instead, entering the circle
// from wherever it currently is and spinning whichever way it was already
// moving; when the preview hides it drifts back to the mouse. The preview is
// found by a loose DOM contract (.works-preview + .is-visible, inline
// translate3d in viewport coords — it's portaled to <body>), so neither
// component imports the other. Bake guidance: crop tight,
// ~16–24 cols, 6–12 fps, a 1–2s loop; Export JSON on the Create page and
// drop it over the matching public/ascii/cursor-*.json. A missing/broken
// file falls back to the procedural diamond blob for that section. Playback
// is driven by this component's own rAF loop (not AsciiPlayer) because
// chase-speed, glitching, and border clipping need frame-level control.
//
// Imperative like the other text-noise effects: React renders the shell once,
// a rAF loop drives textContent/clip/transform, and the loop only runs while
// the artifact is visible (plus a short fade-out tail). Skipped on touch and
// for reduced motion. Like the preview, it's portaled to <body> (fixed,
// z-index one above the preview's) so it flies OVER the image while
// circling — the overlay is its own stacking context, so nothing inside it
// could ever paint above a body-level layer. All math stays in zone-local
// coords; only the final transform write adds the cached column offset. The
// armed-gated opacity stands in for the dissolve clip during open/close.
// pointer-events:none, so it can never steal a hover or block selection.
// Scoping is hit-test based: enter/leave events on the column arm and disarm
// it, and a scroll/resize recheck (elementFromPoint) catches content
// scrolling under a resting pointer.

// ── blob fallback ──────────────────────────────────────────────────
// Cell ranks, center-out. The core is always lit; lighter cells need more
// excitement, so the blob grows and shrinks with the chase.
const WEIGHTS = [
  [0, 1, 2, 1, 0],
  [1, 2, 3, 2, 1],
  [0, 1, 2, 1, 0],
];
// Glyph buckets by rank, sparse→dense slices of the classic ramp
// (createConstants RAMP_PRESETS.classic — ScrambleText's POOL tail).
const RAMP = [".:", ":-=", "=+*", "#%@"];
const BLOB_GLITCH = 0.1; // chance a lit cell flashes a POOL glyph in blue
const THRESH = [0.82, 0.55, 0.28, 0]; // excitement needed to light, by rank

// ── figure faces ───────────────────────────────────────────────────
const TARGET_W = 100; // aim a pet at roughly this many px wide…
const MAX_CELL_PX = 8; // …but never above this cell size (mini, always)
const CHASE_SPEEDUP = 1.2; // playback runs up to (1 + this)× while chasing
const GLITCH_MIN_EXCITE = 0.45; // below this the loop plays clean
const GLITCH_CELLS_MAX = 6; // noise cells at full excitement
const GLITCH_BLUE = 0.4; // chance a glitched cell goes accent blue

// ── linger + orientation ───────────────────────────────────────────
const WANDER_AX = 20; // idle drift amplitude around the anchor (px)
const WANDER_AY = 14;
const WANDER_FX = 0.0009; // drift angular speeds (rad/ms) — off-ratio so the
const WANDER_FY = 0.0014; // loop precesses instead of retracing one oval
const FLIP_SPEED = 12; // horizontal px/s before the pet turns around

// ── works-preview orbit ────────────────────────────────────────────
const ORBIT_PAD = 26; // clearance between the image edge and the orbit path
const ORBIT_SPEED = 1.4; // rad/s — one lap ≈ 4.5s
const ORBIT_CALM = 0.25; // excite damping while circling (cruise, not chase)

// ── shared ─────────────────────────────────────────────────────────
const OFFSET_X = 18; // ride a little below-right of the pointer,
const OFFSET_Y = 16; // out from under the arrow's hotspot
const STIFF = 22; // spring pull toward the target (1/s²) — soft and floaty
const DAMP = 7; // slightly underdamped: it banks and overshoots a touch
const SMOOTH_MS = 120; // excite/facing-velocity smoothing time constant
const SWAP_FAST_MS = 34; // flicker cadence at full excitement (ScrambleText's)
const SWAP_SLOW_MS = 260; // …slowed to a quiet boil once settled
const SWAP_JITTER_MS = 26; // per-cell jitter so cells don't flip in lockstep
const FADE_TAIL_MS = 220; // keep animating while the CSS opacity fade runs
const EDGE_PAD = 8; // minimum clamp inset; grows to half the box on arm
const CLIP_HIDDEN = "inset(100% 0px 0px 0px)";

const esc = (ch) =>
  ch === "&" ? "&amp;" : ch === "<" ? "&lt;" : ch === ">" ? "&gt;" : ch;

// Text mirror for facing: reverse each row and swap the directional glyphs,
// so a flipped frame is still real upright characters.
const MIRROR_MAP = {
  "<": ">",
  ">": "<",
  "(": ")",
  ")": "(",
  "[": "]",
  "]": "[",
  "{": "}",
  "}": "{",
  "/": "\\",
  "\\": "/",
};
const mirrorFrame = (frame) =>
  frame
    .split("\n")
    .map((line) =>
      Array.from(line)
        .reverse()
        .map((ch) => MIRROR_MAP[ch] ?? ch)
        .join("")
    )
    .join("\n");

export function CursorArtifact({ active, boundsRef, scrollRef, faces }) {
  const rootRef = useRef(null);
  const [figures, setFigures] = useState({});

  // Fetch every baked face once. Any failure (file removed, bad JSON) just
  // leaves that section on the procedural blob — the artifact never breaks.
  // NOTE: pass `faces` as a module-level constant; a fresh object identity
  // per render would refetch forever.
  useEffect(() => {
    let dead = false;
    Object.entries(faces ?? {}).forEach(([id, src]) => {
      if (!src) return;
      fetch(src)
        .then((r) => (r.ok ? r.json() : null))
        .then((f) => {
          if (!dead && f?.frames?.length && f.cols) {
            setFigures((prev) => ({ ...prev, [id]: f }));
          }
        })
        .catch(() => {});
    });
    return () => {
      dead = true;
    };
  }, [faces]);

  // Precomputed once per figure: per-frame char arrays plus the indices of
  // the ink (non-space) cells a glitch may strike, so the write path never
  // scans frames.
  const preps = useMemo(() => {
    const build = (frames) => {
      const chars = frames.map((f) => Array.from(f));
      return {
        raw: frames,
        chars,
        inkIdx: chars.map((frame) => {
          const idx = [];
          frame.forEach((ch, i) => {
            if (ch !== " " && ch !== "\n") idx.push(i);
          });
          return idx;
        }),
      };
    };
    const out = {};
    for (const [id, fig] of Object.entries(figures)) {
      out[id] = {
        // Both orientations, ready to swap per tick: [as authored, mirrored].
        o: [build(fig.frames), build(fig.frames.map(mirrorFrame))],
        interval: 1000 / (fig.fps || 12),
        cellPx: clamp(TARGET_W / (fig.cols * MONO_ADVANCE), 4, MAX_CELL_PX),
      };
    }
    return out;
  }, [figures]);

  useEffect(() => {
    // Hidden while the overlay is closed or mid-scrub; hover-only effect, so
    // skip on touch and for reduced motion (evaluate-per-run, like the rest).
    if (!active) return;
    if (prefersReducedMotion() || isCoarsePointer()) return;
    const root = rootRef.current;
    const zone = boundsRef.current;
    const scroller = scrollRef?.current ?? null;
    if (!root || !zone) return;

    // ── face setup ── one runtime state per section layer.
    const faceStates = Array.from(
      root.querySelectorAll(".cursor-artifact__face")
    )
      .map((el) => {
        const section = document.getElementById(el.dataset.face);
        if (!section) return null;
        const prep = preps[el.dataset.face] ?? null;
        const f = {
          el,
          section,
          prep,
          pre: null,
          cells: [],
          ranks: [],
          nextSwap: null,
          frameI: 0,
          nextFrameAt: 0,
          nextGlitchAt: 0,
          bandTop: 0,
          bandBottom: 0,
          halfW: 0,
          halfH: 0,
          lastClip: "",
          visible: false,
        };
        if (prep) {
          // Seed frame 0 at final size now, so bands/boxes measure real
          // geometry and a reveal never shows an empty layer.
          f.pre = el.querySelector(".cursor-artifact__figure");
          f.pre.style.fontSize = `${prep.cellPx}px`;
          f.pre.textContent = prep.o[0].raw[0];
        } else {
          f.cells = Array.from(el.querySelectorAll(".cursor-artifact__cell"));
          f.ranks = WEIGHTS.flat();
          f.nextSwap = new Array(f.cells.length).fill(0);
          // Static depth: heavier cells render brighter, edges stay faint.
          f.cells.forEach((c, i) => {
            c.style.opacity = String(0.35 + f.ranks[i] * 0.2);
          });
        }
        el.style.clipPath = CLIP_HIDDEN;
        f.lastClip = CLIP_HIDDEN;
        return f;
      })
      .filter(Boolean);

    let rafId = 0;
    let inside = false;
    let sawPointer = false; // a real fine pointer has produced an event
    let coolUntil = 0; // wall-clock end of the fade-out tail
    let lastT = 0;
    // Pointer in viewport space + cached geometry, refreshed on arm and
    // scroll/resize so the loop itself never forces layout. Section bands are
    // in zone-local coords: the column scrolls as one unit, so scrolling
    // never moves them — but content changes do (a Works row expanding, the
    // About portrait decode swapping figure sizes), hence the ResizeObserver
    // below.
    let clientX = 0;
    let clientY = 0;
    let rect = zone.getBoundingClientRect();
    let padX = EDGE_PAD;
    let padY = EDGE_PAD;
    let x = 0; // artifact center, zone-local
    let y = 0;
    let vx = 0; // spring velocity (px/s)
    let vy = 0;
    let excite = 0;
    let svx = 0; // smoothed horizontal velocity (px/s) — drives facing
    let dir = 0; // 0 = as authored (left-facing bakes), 1 = mirrored/right
    const phaseX = Math.random() * Math.PI * 2; // fresh wander loop shape
    const phaseY = Math.random() * Math.PI * 2; // every mount
    // Works-preview orbit state; the element is looked up lazily (portaled
    // to <body>, mounts with the overlay).
    let previewEl = null;
    let orbiting = false;
    let theta = 0;
    let spin = 1;
    let orbRx = 0;
    let orbRy = 0;
    let orbOffX = 0; // preview transform origin → visual center offsets
    let orbOffY = 0;

    const measure = () => {
      rect = zone.getBoundingClientRect();
      let maxHalfW = 0;
      let maxHalfH = 0;
      for (const f of faceStates) {
        const sr = f.section.getBoundingClientRect();
        f.bandTop = sr.top - rect.top;
        f.bandBottom = sr.bottom - rect.top;
        f.halfW = f.el.offsetWidth / 2;
        f.halfH = f.el.offsetHeight / 2;
        maxHalfW = Math.max(maxHalfW, f.halfW);
        maxHalfH = Math.max(maxHalfH, f.halfH);
      }
      // Clamp by the biggest face so no creature can poke past the column
      // into the scroll container's margins (a transient x-overflow would
      // flash a scrollbar).
      padX = Math.max(EDGE_PAD, maxHalfW + 4);
      padY = Math.max(EDGE_PAD, maxHalfH + 4);
    };
    measure();

    // Re-measure whenever a section's size changes while armed, so the clip
    // borders track the live layout (delivered pre-paint, off the hot loop).
    const ro =
      typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    if (ro) {
      ro.observe(zone);
      faceStates.forEach((f) => ro.observe(f.section));
    }

    const clampX = (v) => clamp(v, padX, rect.width - padX);
    const clampY = (v) => clamp(v, padY, rect.height - padY);
    const targetX = (w = 0) => clampX(clientX - rect.left + OFFSET_X + w);
    const targetY = (w = 0) => clampY(clientY - rect.top + OFFSET_Y + w);

    // The works preview positions itself by inline translate3d in viewport
    // coords (its own rAF loop) — parse that instead of forcing layout every
    // frame, then shift by its margin/size to the visual center, zone-local.
    const TF_RE = /translate3d\((-?[\d.]+)px, (-?[\d.]+)px/;
    const orbitCenter = () => {
      const m = TF_RE.exec(previewEl.style.transform);
      if (!m) return null;
      return {
        cx: +m[1] + orbOffX - rect.left,
        cy: +m[2] + orbOffY - rect.top,
      };
    };

    // Figure write path: plain text while calm (fast), innerHTML with noise
    // spans while chasing — glyphs escaped, glitches drawn from POOL with the
    // occasional accent-blue cell.
    const writeFigure = (f) => {
      const o = f.prep.o[dir];
      if (excite <= GLITCH_MIN_EXCITE) {
        f.pre.textContent = o.raw[f.frameI];
        return;
      }
      const chars = o.chars[f.frameI];
      const ink = o.inkIdx[f.frameI];
      const k = Math.min(ink.length, 1 + Math.round(excite * GLITCH_CELLS_MAX));
      const hits = new Map(); // idx → blue?
      for (let n = 0; n < k; n++) {
        hits.set(
          ink[(Math.random() * ink.length) | 0],
          Math.random() < GLITCH_BLUE
        );
      }
      let html = "";
      for (let i = 0; i < chars.length; i++) {
        if (hits.has(i)) {
          const g = esc(POOL[(Math.random() * POOL.length) | 0]);
          html += hits.get(i)
            ? `<span class="cursor-artifact__glitch">${g}</span>`
            : g;
        } else {
          html += esc(chars[i]);
        }
      }
      f.pre.innerHTML = html;
    };

    const animateFigure = (f, now) => {
      let write = false;
      if (now >= f.nextFrameAt) {
        // The pet hurries when chasing: frame interval shrinks with excite.
        f.frameI = (f.frameI + 1) % f.prep.o[0].raw.length;
        f.nextFrameAt = now + f.prep.interval / (1 + excite * CHASE_SPEEDUP);
        write = true;
      }
      if (excite > GLITCH_MIN_EXCITE && now >= f.nextGlitchAt) {
        f.nextGlitchAt = now + SWAP_FAST_MS + Math.random() * SWAP_JITTER_MS;
        write = true;
      }
      if (write) writeFigure(f);
    };

    const animateBlob = (f, now) => {
      const interval = SWAP_SLOW_MS + (SWAP_FAST_MS - SWAP_SLOW_MS) * excite;
      for (let i = 0; i < f.cells.length; i++) {
        if (now < f.nextSwap[i]) continue;
        f.nextSwap[i] = now + interval + Math.random() * SWAP_JITTER_MS;
        const c = f.cells[i];
        const w = f.ranks[i];
        const lit =
          w === 3 || excite + (Math.random() - 0.5) * 0.24 > THRESH[w];
        if (!lit) {
          if (c.textContent !== " ") c.textContent = " ";
          c.style.color = "";
          continue;
        }
        if (Math.random() < BLOB_GLITCH) {
          c.textContent = POOL[(Math.random() * POOL.length) | 0];
          c.style.color = "#0000ff";
        } else {
          const bucket = RAMP[w];
          c.textContent = bucket[(Math.random() * bucket.length) | 0];
          c.style.color = "";
        }
      }
    };

    const tick = (now) => {
      const dt = Math.min(now - lastT, 64); // tab-throttle spikes can't teleport it
      lastT = now;
      const dtS = dt / 1000;
      const a = 1 - Math.exp(-dt / SMOOTH_MS);
      // Lingering: once the chase settles the pet doesn't park under the
      // pointer — it drifts a slow, precessing loop around the anchor
      // (off-ratio sine speeds, so the path never retraces). Chasing
      // squeezes the drift out; on the orbit it wobbles the circle.
      const calm = 1 - excite;
      const wx = Math.sin(now * WANDER_FX + phaseX) * WANDER_AX * calm;
      const wy = Math.sin(now * WANDER_FY + phaseY) * WANDER_AY * calm;

      // While the works hover preview is on screen, leave the pointer and
      // circle the image; the moment it hides, drift back to the mouse.
      previewEl ??= document.querySelector(".works-preview");
      let center =
        previewEl?.classList.contains("is-visible") ? orbitCenter() : null;
      let tx;
      let ty;
      if (center) {
        if (!orbiting) {
          orbiting = true;
          // Measure once per engagement (size/margins are static per hover);
          // then enter the circle from where the pet already is, spinning
          // the way it was already moving (cross of radius × velocity).
          const cs = getComputedStyle(previewEl);
          orbRx = previewEl.offsetWidth / 2 + ORBIT_PAD;
          orbRy = previewEl.offsetHeight / 2 + ORBIT_PAD;
          orbOffX =
            (parseFloat(cs.marginLeft) || 0) + previewEl.offsetWidth / 2;
          orbOffY =
            (parseFloat(cs.marginTop) || 0) + previewEl.offsetHeight / 2;
          center = orbitCenter() ?? center; // recompute with real offsets
          theta = Math.atan2(y - center.cy, x - center.cx);
          const crossZ = (x - center.cx) * vy - (y - center.cy) * vx;
          spin = crossZ >= 0 ? 1 : -1;
        }
        theta += ORBIT_SPEED * spin * dtS;
        tx = clampX(center.cx + Math.cos(theta) * orbRx + wx);
        ty = clampY(center.cy + Math.sin(theta) * orbRy + wy);
      } else {
        orbiting = false;
        tx = targetX(wx);
        ty = targetY(wy);
      }

      // Soft spring: accelerate toward the target and carry momentum through
      // it — floaty, banking motion instead of a lerp's straight tracking.
      vx += ((tx - x) * STIFF - vx * DAMP) * dtS;
      vy += ((ty - y) * STIFF - vy * DAMP) * dtS;
      x += vx * dtS;
      y += vy * dtS;
      // Excitement = how hard it's chasing; decays as it catches up.
      // Circling is a cruise, not a chase — damped so the pet stays calm.
      const drive =
        clamp01(Math.hypot(tx - x, ty - y) / 48) * (orbiting ? ORBIT_CALM : 1);
      excite += (drive - excite) * a;
      // Facing follows the smoothed spring velocity: a hard sweep turns the
      // pet instantly; drift and orbit turn it lazily at each reversal
      // (the ±FLIP_SPEED dead zone is the hysteresis).
      svx += (vx - svx) * a;
      const want = svx > FLIP_SPEED ? 1 : svx < -FLIP_SPEED ? 0 : dir;
      if (want !== dir) {
        dir = want;
        // Turn in place: redraw visible creatures mirrored, same frame.
        for (const f of faceStates) {
          if (f.prep && f.visible) writeFigure(f);
        }
      }
      // Fixed on <body>: shift the zone-local position by the column's
      // viewport offset (cached; refreshed on arm/scroll/resize).
      root.style.transform = `translate3d(${x + rect.left}px, ${y + rect.top}px, 0)`;

      // Clip every face to its own section band; crossing a border wipes one
      // creature out and the next in along the boundary line itself.
      for (const f of faceStates) {
        const h = f.halfH * 2;
        const topIn = clamp(f.bandTop - (y - f.halfH), 0, h);
        const botIn = clamp(y + f.halfH - f.bandBottom, 0, h);
        const visible = topIn + botIn < h;
        const clip = visible
          ? `inset(${topIn.toFixed(1)}px 0px ${botIn.toFixed(1)}px 0px)`
          : CLIP_HIDDEN;
        if (clip !== f.lastClip) {
          f.el.style.clipPath = clip;
          f.lastClip = clip;
        }
        f.visible = visible;
        if (!visible) continue; // only creatures on screen burn cycles
        if (f.prep) animateFigure(f, now);
        else animateBlob(f, now);
      }

      if (inside || now < coolUntil) {
        rafId = requestAnimationFrame(tick);
      } else {
        rafId = 0;
      }
    };

    const start = () => {
      inside = true;
      root.style.opacity = "1";
      if (!rafId) {
        lastT = performance.now();
        rafId = requestAnimationFrame(tick);
      }
    };

    const arm = (e) => {
      if (e.pointerType === "touch") return; // hybrid screens: taps must not stick
      sawPointer = true;
      clientX = e.clientX;
      clientY = e.clientY;
      measure();
      if (!inside) {
        // Materialize at the pointer (no glide in from a stale corner) with a
        // small arrival flare that settles if the pointer rests.
        x = targetX();
        y = targetY();
        vx = 0;
        vy = 0;
        excite = 0.7;
      }
      start();
    };
    const move = (e) => {
      if (e.pointerType === "touch") return;
      sawPointer = true;
      clientX = e.clientX;
      clientY = e.clientY;
      if (!inside) arm(e); // e.g. re-entered during the fade-out tail
    };
    const disarm = () => {
      inside = false;
      coolUntil = performance.now() + FADE_TAIL_MS;
      root.style.opacity = "0";
    };

    // Scrolling moves the column under a stationary pointer without firing
    // any boundary event: refresh the cached geometry (keeps the follower
    // glued to the pointer, not riding away with the content) and re-hit-test
    // so it hides the moment the pointer is no longer over the column.
    const recheck = () => {
      measure();
      if (!sawPointer) return;
      const el = document.elementFromPoint(clientX, clientY);
      const over = !!el && zone.contains(el);
      if (inside && !over) disarm();
      else if (!inside && over) start();
    };

    zone.addEventListener("pointerenter", arm);
    zone.addEventListener("pointermove", move);
    zone.addEventListener("pointerleave", disarm);
    scroller?.addEventListener("scroll", recheck, { passive: true });
    window.addEventListener("resize", recheck);
    return () => {
      zone.removeEventListener("pointerenter", arm);
      zone.removeEventListener("pointermove", move);
      zone.removeEventListener("pointerleave", disarm);
      scroller?.removeEventListener("scroll", recheck);
      window.removeEventListener("resize", recheck);
      ro?.disconnect();
      if (rafId) cancelAnimationFrame(rafId);
      root.style.opacity = "0";
    };
  }, [active, boundsRef, scrollRef, preps]);

  return createPortal(
    <div className="cursor-artifact" ref={rootRef} aria-hidden="true">
      {Object.keys(faces ?? {}).map((id) => (
        <div key={id} className="cursor-artifact__face" data-face={id}>
          {figures[id] ? (
            <pre className="cursor-artifact__figure" />
          ) : (
            WEIGHTS.map((row, r) => (
              <div key={r} className="cursor-artifact__row">
                {row.map((w, c) => (
                  <span key={c} className="cursor-artifact__cell">
                    {w === 3 ? "@" : " "}
                  </span>
                ))}
              </div>
            ))
          )}
        </div>
      ))}
    </div>,
    document.body
  );
}
