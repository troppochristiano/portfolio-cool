import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import gsap from "gsap";
import { useDissolveReveal } from "../hooks/useDissolveReveal";
import { useLenisScroll } from "../hooks/useLenisScroll";
import {
  clearIntroSkipPref,
  getIntroSkipPref,
  setIntroSkipPref,
} from "../lib/introPref.js";
import { lastPointer } from "../lib/lastPointer.js";
import {
  isCoarsePointer,
  prefersReducedMotion,
  queryParam,
} from "../lib/utils.js";
import { AsciiPortraitHover } from "./AsciiPortraitHover.jsx";
import { ContactLiquid } from "./ContactLiquid.jsx";
import { DecryptText } from "./DecryptText.jsx";
import { WorksClientMarquee } from "./WorksClientMarquee.jsx";
import { WorksPanelImage } from "./WorksPanelImage.jsx";
import { WorksTitleScramble } from "./WorksTitleScramble.jsx";

// The intro copy. The old headline sentence ("I'm Christian — a frontend
// developer building for the web since 2018.") is distributed across the
// chapter band: name → wordmark, role → squeezed line, the rest → the mono
// footer row. The wordmark types on through DecryptText (empty while closed,
// scramble fringe once the overlay settles); the body stays plain text.
// Kept close in length to Body2 on purpose: the two columns of the reading
// spread flank the figure, so a paragraph that outruns the other leaves the
// composition lopsided. Every claim the longer draft made is still here, just
// stated once instead of twice.
const BODY_1 =
  "The work I've done professionally has mostly been practical: configurators, dashboards, backoffice tools people sat in front of all day. Unglamorous software, but the kind where a bad decision shows up immediately in someone's afternoon. For a few years I was the only frontend at the company, so the architecture and the small details were both my problem. I also spent a lot of that time helping the junior devs, which turned out to be the fastest way to find out whether I actually understood something. The part I like is when something is broken and then it isn't. I'll pick up whatever the problem asks for";
// A fragment rather than a plain string like BODY_1: the two places this
// paragraph names a part of the site — the gallery, and the converter that
// feeds it — link straight there, so the invitation is clickable where it's
// made instead of sending people back to the nav.
const Body2 = () => (
  <>
    {"This site is the other half — no client, no spec, no requirements to " +
      "satisfy. Everything here exists because I wanted to make something " +
      "cool and nobody was going to ask me for it. I come from a small town " +
      "where it was hard to find anyone with the same interests. The internet " +
      "showed me I wasn't the only one, and that's the part of it I still " +
      "value most — the community side, people finding each other over the " +
      "same strange thing. So the "}
    <Link className="about-link" to="/gallery">
      gallery
    </Link>
    {" is open. Anyone can "}
    <Link className="about-link" to="/create">
      put something in it
    </Link>
    {", and I'd rather it filled up with things I wouldn't have made myself"}
  </>
);

// Full-body cutout (transparent bg), rendered by AsciiPortraitHover as the
// blue canvas-ascii figure in the middle of the reading spread.
const PORTRAIT_SRC = "/outputs/portrait/me-full.webp";

// How long a scroll-driven hover must hold on one row before its title
// scrambles. Long enough that a flick past the list skips every row it crosses
// and only the landing row bursts; short enough to feel like plain hover.
const SCRAMBLE_SETTLE_MS = 120;

// Works entries — expandable list modeled on the henriheymans.com
// "Recognitions & Awards" accordion. `images` cycle in the open panel;
// `thumb` (optional) is the inline image that slides out on row hover,
// falling back to images[0]. Give it its own file whenever you can: the
// thumb is a 160x56 strip and the panel images are 4:5, so a shared file
// gets cover-cropped to a middle band — an 80-column ascii render collapsed
// into an unreadable smudge that way, which is why the thumbs are separate
// ~2.86:1 art sized for 56px tall.
// `stack` renders as the chip row at the panel's bottom; `clients` (cobrains
// only) fills the auto-scroll marquee; `status` (optional) tags a project
// that isn't live yet, as a badge beside the year.
//
// State of the entries: every one carries real copy and imagery built by its
// own script in scripts/ from the project's own output — ascii widgets from
// its ascii renders, RRead from its docs screenshots, cobrains from its
// archived project mockups.
// check-earth is the exception only in that it hasn't shipped, so there are no
// screenshots to composite: generate-works-check-earth.cjs draws the product
// itself instead — a real equirectangular projection with the hazard markers
// at their true coordinates. A single-image entry renders without the cycler
// or the frame counter, which is why it's one image rather than a set.
// Chronological, oldest first, with the unreleased one last — so the list
// reads as a career rather than a feed.
const WORKS = [
  {
    title: "cobrains",
    meta: "2018–2025",
    // The company's own project mockups, recovered from the Internet Archive
    // (co-brains.com is gone) and composited by
    // scripts/generate-works-cobrains.cjs: a backoffice module dashboard, a
    // real-time energy monitor, a production monitor.
    thumb: "/works/cobrains-thumb.webp",
    images: [
      "/works/cobrains-1.webp",
      "/works/cobrains-2.webp",
      "/works/cobrains-3.webp",
    ],
    detail: [
      "I started at Cobrains straight out of high school, knowing essentially nothing. Another developer took me on and taught me the job properly — most of what I know about building for the web starts there. When he left, I became the only dedicated frontend. That was the part that changed how I work: no one above me to check the decisions, so I had to get good at making them. Later the company brought in help, and I ended up doing the teaching instead.",
      "i really value all my time at cobrains, it really helped me grow not only as a developer but also as a person and i got to work on great projects with great people.",
    ],
    clientsLead: "Some of the companies i worked with:",
    stack: ["React", "JavaScript", "CSS", "Kubernetes"],
    clients: [
      { name: "DKC", src: "/works/clients/dkc.webp" },
      { name: "Sisal", src: "/works/clients/sisal.webp" },
      { name: "subito", src: "/works/clients/subito.webp" },
      { name: "McGarlet", src: "/works/clients/mcgarlet.webp" },
      { name: "MOOG", src: "/works/clients/moog.webp" },
      { name: "ta design", src: "/works/clients/ta-design.webp" },
      {
        name: "Not Just Analytics",
        src: "/works/clients/notjustanalytics.webp",
      },
      // LOWILL is in no Wayback capture of co-brains.com, so this one comes
      // from the client's own site (lowillsound.it) instead.
      { name: "LOWILL", src: "/works/clients/lowill.webp" },
    ],
  },
  {
    title: "RRead",
    meta: "2026",
    // Real app screenshots (docs/screenshots in the RRead repo), composed to
    // 4:5 by scripts/generate-works-rread.cjs. Reading view first — it shows
    // the word-sync highlight, which is the product — then the entry screen
    // and the library, then the pair again in the light theme.
    thumb: "/works/rread-thumb.webp",
    images: [
      "/works/rread-1.webp",
      "/works/rread-2.webp",
      "/works/rread-3.webp",
      "/works/rread-4.webp",
      "/works/rread-5.webp",
    ],
    detail:
      "A text-to-speech reader that runs entirely in your browser: paste text or drop in a PDF, EPUB, TXT or MD, pick any voice your OS already has, and listen — current word highlighted, click any word to seek. No account, no API keys, nothing uploaded; documents are parsed locally and your place is kept on the device. Free and unlimited because there's no server to pay for — live at rread.org.",
    stack: ["React 19", "Web Speech API", "Vite"],
  },
  {
    title: "ascii widgets",
    meta: "2026",
    thumb: "/works/ascii-widgets-thumb.svg",
    images: [
      "/works/ascii-widgets-1.svg",
      "/works/ascii-widgets-2.svg",
      "/works/ascii-widgets-3.svg",
      "/works/ascii-widgets-4.svg",
    ],
    detail:
      "Two open-source repos: the ascii effects from this site as ten drop-in React components, and the face viewer behind the hero — pose photos displaced in three.js, drawn as glyphs, following your cursor. There's no package to install; you copy the folder you want, and each ships its own props table and the gotchas worth knowing. Built on wesbos/eye-ballz, which carries no ascii of its own.",
    stack: ["React", "three.js", "Canvas", "GSAP"],
  },
  {
    // Undated on purpose: it isn't out, so the badge carries the whole story
    // and `meta` is omitted (the year span is conditional).
    title: "check-earth",
    status: "coming soon",
    thumb: "/works/check-earth-thumb.svg",
    images: ["/works/check-earth-1.svg"],
    detail:
      "A live map of Earth and the natural phenomena moving across it — earthquakes, wildfires, storms and volcanic activity, drawn on the globe as they happen rather than listed as headlines.",
    stack: ["React", "three.js"],
  },
];

// Placeholder contact links — swap in real handles/URLs later.
const SOCIALS = [
  { label: "Instagram", href: "#" },
  { label: "GitHub", href: "#" },
  { label: "LinkedIn", href: "#" },
];

// ?debug (or the older ?wrapdebug) paints the generated wrap polygons as
// translucent overlays so the mask the copy is avoiding can be eyeballed
// against the drawn figure: filled blue = the shape, dashed outline = the crop
// box it's measured against.
const WRAP_DEBUG =
  queryParam("debug") !== null || queryParam("wrapdebug") !== null;

// Tracks --hip-cut in global.css: the desktop About figure shows the top 46%
// of the grid (cut just under the hands); mobile shows the full body.
const DESKTOP_HIP_CUT = 0.46;

// Phones cut the figure into two crops stacked as separate beats. Both are
// cropped on BOTH axes: taking the full grid width would fill the box with
// empty shoulder and leave the face itself tiny — and every pixel of box width
// is a pixel off the copy beside it. Windows are fractions of the full 40×67
// grid; global.css sizes and offsets the canvas to match, and these same
// numbers rescale the wrap contours onto each crop.
// Each crop is also turned a QUARTER TURN so it lies across the column and
// runs off the edge it's anchored to — he reads as coming out of the screen
// rather than standing flat against it. Both turn anticlockwise; `side` is
// which edge of the box the copy runs down, and is independent of the turn
// (the head floats right so the copy is on its left, the legs float left so
// the copy is on their right).
const PHONE_HEAD = {
  x0: 0.28,
  x1: 0.72,
  y0: 0,
  y1: 0.26,
  turn: "ccw", // crown to the left, body running off the right edge
  side: "left",
};
// Trimmed at the HIPS, not the feet — the shoes are the end of the line and
// cutting them read as an accident. Shortened from the top instead.
// x spans 0.27→0.76 because the feet splay to 0.295→0.74 at the shoe line; the
// old 0.30→0.70 window sliced the outer edge off both shoes.
const PHONE_LEGS = {
  x0: 0.27,
  x1: 0.76,
  y0: 0.66,
  y1: 1,
  turn: "ccw", // hips to the left, feet pointing right into the page
  side: "right",
};

// ── shape-outside is applied from JS, not CSS ───────────────────────────
// These MUST track the tier boundaries in global.css. Normally CSS would own
// them, and it used to: the stylesheet read the generated polygons through
// `shape-outside: var(--wrap-…)`. That is correct per spec and works in Blink,
// but WebKit — i.e. EVERY browser on iOS, since Apple requires them all to use
// it — never recomputes a float's shape when a custom property feeding it
// changes. The contour is generated after the portrait image loads, so on iOS
// the copy kept wrapping the literal first-paint fallback while `clip-path`
// (which does re-resolve) drew the real shape. Writing the polygon straight
// into inline style invalidates layout unambiguously on both engines.
const MQ_PHONE = "(max-width: 767.98px)";
const MQ_TABLET = "(min-width: 768px) and (max-width: 1199.98px)";

// Columns sampled across a crop when building its turned contour. Well above
// the ~23 grid columns a crop actually spans, and deliberately so: the extra
// samples don't add ink detail (neighbours land on the same grid column) but
// they halve the height of each staircase band, and the neighbour-widening
// below smears over three bands. At 24 steps that smear was ~26px against a
// 23px line box — CSS takes the most restrictive contour across a line's full
// height — which left the copy sitting up to 158px clear of the glyphs.
const TURN_STEPS = 56;

// Which AsciiPortraitHover detail patches each figure asks for. Module-level
// constants so the array identity is stable across renders. Each crop takes
// only the patch it can actually show — the head crop never shows the shoes,
// and on the phone the legs crop is the only place they appear at all.
const HEAD_DETAIL = ["face"];
const LEGS_DETAIL = ["shoes"];

// The About text wraps along the figure's real silhouette: AsciiPortraitHover
// reports per-row opaque extents of the drawn glyph grid, and these become
// shape-outside polygons (via CSS custom properties) for the desktop
// half-box floats and the mobile full-box float. Auto-derived — survives
// crop/size changes with no hand-tuned contours.
function contourToPolygons({ bands, runs, rowH = 0 }) {
  if (!bands?.length) return null;
  const pct = (v) => `${(Math.max(0, Math.min(1, v)) * 100).toFixed(1)}%`;
  // Drop near-collinear points (x within 1.5% of the last kept one).
  const simplify = (pts) => {
    const out = [];
    for (const p of pts) {
      const prev = out[out.length - 1];
      if (!prev || Math.abs(p[0] - prev[0]) > 0.015) out.push(p);
    }
    return out;
  };
  // Opaque side is RIGHT of the walked edge: (topX,0) → across the top and
  // far side → (bottomX,100%) → back up the contour bottom→top.
  const build = (pts, farX) => {
    const top = pts[0];
    const bottom = pts[pts.length - 1];
    const walkUp = simplify(pts).reverse();
    const edge = walkUp.map(([x, y]) => `${pct(x)} ${pct(y)}`).join(", ");
    return `polygon(${pct(top[0])} 0%, ${farX} 0%, ${farX} 100%, ${pct(
      bottom[0],
    )} 100%, ${edge})`;
  };
  // Widen each band to its neighbors' extremes: the contour samples every
  // 2nd drawn row, so between bands the figure (arm edges especially) can
  // jut past the straight polygon segment — the sticky text slides across
  // those bands and was clipping the glyphs. Neighbor-min/max covers the
  // between-band excursions exactly where they occur, no global margin cost.
  const eroded = bands.map((b, i) => {
    const prev = bands[i - 1] ?? b;
    const next = bands[i + 1] ?? b;
    return {
      y: b.y,
      left: Math.min(prev.left, b.left, next.left),
      right: Math.max(prev.right, b.right, next.right),
    };
  });
  const visible = eroded.filter((b) => b.y <= DESKTOP_HIP_CUT);

  // ── turned crops ─────────────────────────────────────────────────────
  // A quarter turn swaps the axes, so the edge facing the copy is no longer a
  // per-row extent — it's a per-COLUMN extent of the unrotated crop.
  // shape-outside ignores transforms, so the turn has to be baked into the
  // polygon; CSS only spins the pixels.
  //
  //   anticlockwise: displayed X = v,     displayed Y = 1 − u
  //   clockwise:     displayed X = 1 − v, displayed Y = u
  // (u across the crop, v down it, both 0→1 inside the window.)
  //
  // Turn and side are INDEPENDENT — which way the crop spins says nothing
  // about which of its edges the copy runs down — so the contour is picked
  // from both:
  //
  //   turn  side    displayed contour
  //   ccw   left    column top
  //   ccw   right   column bottom
  //   cw    left    1 − column bottom
  //   cw    right   1 − column top

  // First and last ink per sampled column, as fractions down the window. null
  // where the column is empty — between the legs that's the gap, and the copy
  // is free to run the whole displayed row.
  const columnExtents = (win) => {
    const out = [];
    for (let i = 0; i < TURN_STEPS; i++) {
      const gx = win.x0 + ((i + 0.5) / TURN_STEPS) * (win.x1 - win.x0);
      let top = null;
      let bottom = null;
      for (const r of runs ?? []) {
        if (r.y < win.y0 || r.y > win.y1) continue;
        if (!r.spans.some(([l, s]) => gx >= l && gx < s)) continue;
        const span = win.y1 - win.y0;
        // top edge of the first inked row, bottom edge of the last: both sides
        // have to enclose the cell, or the contour stops a cell short of the
        // glyphs on whichever side the copy is running down.
        if (top === null) top = (r.y - win.y0) / span; // runs arrive top-down
        bottom = (r.y + rowH - win.y0) / span;
      }
      out.push(top === null ? null : { top, bottom });
    }
    return out;
  };

  const turnedPolygon = (win) => {
    const cols = columnExtents(win);
    if (cols.every((c) => c === null)) return null;
    const ccw = win.turn === "ccw";
    const left = win.side === "left";
    // Project a column's extents onto the displayed edge that faces the copy.
    const edgeOf = (c) => {
      if (ccw) return left ? c.top : c.bottom;
      return left ? 1 - c.bottom : 1 - c.top;
    };
    // An empty column blocks nothing: push the edge to the far side so the
    // copy gets the whole displayed row.
    const empty = left ? 1 : 0;
    // Widen each column toward its most intrusive neighbour: the sampling is
    // coarse and the shape must never cut inside the drawn glyphs. "Most
    // intrusive" is the smallest edge when the copy is on the left, the
    // largest when it's on the right.
    const raw = cols.map((c) => (c ? edgeOf(c) : null));
    const eased = raw.map((x, i) => {
      const near = [raw[i - 1], x, raw[i + 1]].filter((v) => v != null);
      if (!near.length) return null;
      return left ? Math.min(...near) : Math.max(...near);
    });
    // Exact staircase — a simplified diagonal would shave the corners off the
    // gap between his legs.
    const path = [];
    eased
      .map((x, i) => {
        const a = i / eased.length;
        const b = (i + 1) / eased.length;
        return {
          x: x == null ? empty : x,
          y0: ccw ? 1 - b : a,
          y1: ccw ? 1 - a : b,
        };
      })
      .sort((p, q) => p.y0 - q.y0)
      .forEach((p) => path.push([p.x, p.y0], [p.x, p.y1]));
    const farX = left ? "100%" : "0%";
    const edge = [...path]
      .reverse()
      .map(([x, y]) => `${pct(x)} ${pct(y)}`)
      .join(", ");
    return `polygon(${pct(path[0][0])} 0%, ${farX} 0%, ${farX} 100%, ${pct(
      path[path.length - 1][0],
    )} 100%, ${edge})`;
  };

  const headPoly = turnedPolygon(PHONE_HEAD);
  const legsPoly = turnedPolygon(PHONE_LEGS);

  return {
    // Desktop left-half box: x doubles (half box), y rescales to the crop.
    "--wrap-l": build(
      visible.map((b) => [b.left * 2, b.y / DESKTOP_HIP_CUT]),
      "100%",
    ),
    // Desktop right-half box, mirrored: x maps from the figure's right edge.
    "--wrap-r": build(
      visible.map((b) => [(b.right - 0.5) * 2, b.y / DESKTOP_HIP_CUT]),
      "0%",
    ),
    // Tablet full-body box, upright (legs pocket included — concave is fine).
    "--wrap-full-l": build(
      eroded.map((b) => [b.left, b.y]),
      "100%",
    ),
    // Phone crops, each already turned a quarter turn. Null until `runs`
    // arrives; CSS falls back to a literal polygon in that window.
    ...(headPoly ? { "--wrap-head-l": headPoly } : null),
    ...(legsPoly ? { "--wrap-legs-r": legsPoly } : null),
  };
}

// Full-screen scrollable overlay reached from the scroll-hint pill under the
// avatar and the Works/Contact header shortcuts. Owns its own scroll (the body
// is overflow:hidden) and reuses the site's neon/blue aesthetic.
//
// Open/close are driven by the KVS "dissolve" effect (useDissolveReveal): the overlay builds
// bottom→top on open and dissolves top→bottom on close, revealing the hero behind. The same
// hook owns the scroll-to-open scrub and the pull-to-close-at-top scrub.
export function AboutOverlay({
  open,
  onOpenChange,
  // Reports "fully settled open" (opaque over the hero) — App freezes the
  // hero's render loops on it.
  onSettledChange,
  ready = true,
  scrollTarget = null,
  onScrolled,
}) {
  // Intro-skip preference, surfaced in the footer. `offered` gates the control
  // on having opted in at some point — it latches true rather than tracking
  // `skipOn`, so turning the skip off doesn't yank the toggle out from under
  // the finger that just used it. Re-read on every open (not once at mount):
  // this overlay mounts with the hero, so a pref set by the post-skip prompt
  // later in the same session would otherwise never unlock the toggle the
  // prompt's own confirmation points at.
  const [skipOn, setSkipOn] = useState(getIntroSkipPref);
  const [offered, setOffered] = useState(getIntroSkipPref);
  useEffect(() => {
    if (!open) return;
    const on = getIntroSkipPref();
    setSkipOn(on);
    if (on) setOffered(true);
  }, [open]);
  const toggleSkip = () => {
    if (skipOn) clearIntroSkipPref();
    else setIntroSkipPref();
    setSkipOn(!skipOn);
  };

  // Set of open accordion indices — rows toggle independently.
  const [openWorks, setOpenWorks] = useState(() => new Set());
  // Index of the works row under the pointer (null = none) — drives the
  // shared [ Open ]/[ Close ] indicator's label and position.
  const [hoveredWork, setHoveredWork] = useState(null);
  // Same, but for the row's toggle button rather than the whole <li> — the two
  // hover surfaces differ on purpose (see enterWork). Drives the thumb/title
  // (.is-hovered, mirroring :hover in CSS) and, via scrambleWork, the title
  // scramble.
  const [hoveredToggle, setHoveredToggle] = useState(null);
  // hoveredToggle delayed through a settle window when the hover arrived by
  // scrolling rather than by moving the mouse — see the effect below.
  const [scrambleWork, setScrambleWork] = useState(null);
  const hoverSourceRef = useRef("pointer");
  const worksListRef = useRef(null);
  const worksIndicatorRef = useRef(null);
  const rowToggleRefs = useRef([]);
  // True only while fully settled open — drives the headline decrypt and the
  // portrait decode, and resets them on close so both replay on every open.
  const [revealed, setRevealed] = useState(false);
  // Auto-contour wrap polygons (CSS custom properties for the silh floats),
  // derived from the drawn figure once its cell grid is built.
  const [wrapVars, setWrapVars] = useState(null);
  const handleContour = useCallback((contour) => {
    setWrapVars(contourToPolygons(contour));
  }, []);
  // The four shape-outside consumers, written to directly — see MQ_PHONE above
  // for why this can't go through CSS.
  const flowRef = useRef(null);
  const headFigRef = useRef(null);
  const legsFigRef = useRef(null);
  const silhLRef = useRef(null);
  const silhRRef = useRef(null);
  useEffect(() => {
    const apply = () => {
      const phone = window.matchMedia?.(MQ_PHONE).matches ?? false;
      const tablet = window.matchMedia?.(MQ_TABLET).matches ?? false;
      // Re-project a border-box polygon into MARGIN-box coordinates, then emit
      // it with no <shape-box> keyword at all.
      //
      // Why: the contours are authored against the drawn box, so they want a
      // `border-box` reference. Blink honours that keyword; WebKit resolves the
      // shape against the margin box regardless. The head crop carries a
      // sizeable margin-top (the offset that drops it down the page), so on iOS
      // its exclusion zone sat a whole margin-top ABOVE the glyphs — copy was
      // kept out of empty space and allowed straight over the figure. The legs
      // crop's margins are single digits, which is why it always looked fine
      // and the head didn't: same bug, proportional to the margin.
      //
      // margin-box is the DEFAULT reference box in every engine, so doing the
      // conversion here and dropping the keyword removes the disagreement
      // instead of betting on it.
      const toMarginBox = (el, poly) => {
        const cs = getComputedStyle(el);
        const w = el.offsetWidth;
        const h = el.offsetHeight;
        const mt = parseFloat(cs.marginTop) || 0;
        const mr = parseFloat(cs.marginRight) || 0;
        const mb = parseFloat(cs.marginBottom) || 0;
        const ml = parseFloat(cs.marginLeft) || 0;
        const mw = ml + w + mr;
        const mh = mt + h + mb;
        if (!(mw > 0 && mh > 0 && w > 0 && h > 0)) return poly;
        return poly.replace(
          /([-\d.]+)%\s+([-\d.]+)%/g,
          (_m, xs, ys) =>
            `${(((ml + (parseFloat(xs) / 100) * w) / mw) * 100).toFixed(2)}% ` +
            `${(((mt + (parseFloat(ys) / 100) * h) / mh) * 100).toFixed(2)}%`,
        );
      };
      // Empty string clears the inline value and lets the stylesheet's literal
      // first-paint fallback take back over, which is what the tiers that
      // don't own a given element want.
      const set = (ref, poly) => {
        const el = ref.current;
        if (!el) return;
        if (!poly) {
          el.style.shapeOutside = "";
          return;
        }
        const cs = getComputedStyle(el);
        // The conversion above only holds where the margin box CONTAINS the
        // border box on the axis being shifted. The desktop silhouettes pull
        // themselves up with a NEGATIVE margin-top, so converting them would
        // clip the crown off the shape instead of moving it — there, keep the
        // keyword: Blink honours it, and that tier has no large-margin float to
        // expose WebKit's disagreement in the first place. (Negative
        // horizontal margins are fine to convert through: the only thing they
        // clip is the deliberate gutter bleed, which is off-screen.)
        const vertical =
          (parseFloat(cs.marginTop) || 0) >= 0 &&
          (parseFloat(cs.marginBottom) || 0) >= 0;
        el.style.shapeOutside = vertical
          ? toMarginBox(el, poly)
          : `${poly} border-box`;
      };
      const v = wrapVars ?? {};
      set(
        headFigRef,
        phone ? v["--wrap-head-l"] : tablet ? v["--wrap-full-l"] : null,
      );
      set(legsFigRef, phone ? v["--wrap-legs-r"] : null);
      set(silhLRef, phone || tablet ? null : v["--wrap-l"]);
      set(silhRRef, phone || tablet ? null : v["--wrap-r"]);
    };
    apply();
    // A ResizeObserver on the flow is the reliable trigger: it fires on the
    // actual box change however the viewport got there. matchMedia `change`
    // and window `resize` both stay silent under a devtools/pane viewport
    // override, and betting on an event firing is what put the stale shape on
    // screen in the first place — so those two are belt-and-braces, not the
    // mechanism.
    const ro = new ResizeObserver(apply);
    if (flowRef.current) ro.observe(flowRef.current);
    window.addEventListener("resize", apply);
    const mqs = [window.matchMedia?.(MQ_PHONE), window.matchMedia?.(MQ_TABLET)];
    for (const mq of mqs) mq?.addEventListener("change", apply);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", apply);
      for (const mq of mqs) mq?.removeEventListener("change", apply);
    };
  }, [wrapVars]);
  // ?debug readout — the device reporting its own state, because the class of
  // bug this exists for (WebKit not re-resolving shape-outside) is invisible in
  // a desktop Chromium pane. Polls rather than reacting to anything: it's a
  // debug tool, and a stale number here would be worse than useless.
  const [probe, setProbe] = useState(null);
  useEffect(() => {
    if (!WRAP_DEBUG) return undefined;
    const count = (s) => (s ? (s.match(/%/g) || []).length / 2 : 0);
    const read = () => {
      const rows = [`${innerWidth}x${innerHeight} dpr${devicePixelRatio}`];
      for (const [name, ref] of [
        ["head", headFigRef],
        ["legs", legsFigRef],
      ]) {
        const el = ref.current;
        if (!el || getComputedStyle(el).display === "none") {
          rows.push(`${name}: hidden`);
          continue;
        }
        const used = getComputedStyle(el).shapeOutside;
        const inline = el.style.shapeOutside;
        rows.push(
          `${name}: used ${count(used)}pts inline ${count(inline)}pts` +
            (count(used) && count(used) === count(inline)
              ? " OK"
              : " MISMATCH"),
        );
        rows.push(`  ${used.slice(0, 42)}`);
      }
      setProbe(rows);
    };
    read();
    const id = setInterval(read, 500);
    return () => clearInterval(id);
  }, [wrapVars]);

  const overlayRef = useRef(null);
  const scrollRef = useRef(null);
  const canvasRef = useRef(null);
  const contentRef = useRef(null);
  // Section id queued by a header shortcut; consumed once the overlay is open + scrollable.
  const pendingScrollRef = useRef(null);

  // Lenis smooth scroll on the overlay scroller (culture-page feel). Lives only
  // while settled open; destroyed the instant a close starts, so playClose's
  // scrollTop reset can't be fought by an in-flight Lenis animation.
  const lenisRef = useLenisScroll({
    wrapperRef: scrollRef,
    contentRef,
    active: open && revealed,
  });

  // Still portrait, scrolling text: on desktop the portrait alone is
  // position:sticky (a centered grid overlay — see global.css), parking in
  // the viewport while the copy scrolls past and re-wraps around it. Pure
  // CSS, no JS on the scroll path; sticky is clamped to its grid area so
  // the figure can never overlap Works.

  // Scroll the queued section into view. Only effective once settleOpen has flipped the
  // scroll container to overflow-y:auto; double rAF lets that layout settle AND the
  // Lenis-creating effect (gated on the `revealed` commit) run first.
  const scrollToSection = useCallback(() => {
    const id = pendingScrollRef.current;
    if (!id) return;
    pendingScrollRef.current = null;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const el = document.getElementById(id);
        if (!el) return;
        const lenis = lenisRef.current;
        if (lenis) {
          // No offset: Lenis reads .about-section's scroll-margin-top itself.
          lenis.scrollTo(el);
        } else {
          el.scrollIntoView({
            behavior: prefersReducedMotion() ? "auto" : "smooth",
            block: "start",
          });
        }
      });
    });
    onScrolled?.();
  }, [onScrolled, lenisRef]);

  const { playOpen, playClose, getState } = useDissolveReveal({
    overlayRef,
    scrollRef,
    canvasRef,
    contentRef,
    color: "#0000ff",
    // Don't let a scroll/swipe scrub the overlay open until the hero has finished loading.
    canOpen: ready,
    // Mobile: a swipe-up opens the overlay only when the gesture STARTS on/below the ABOUT
    // button group (anchored near the bottom). Swipes starting higher pan the ascii gallery.
    openTouchZone: () =>
      document.querySelector(".about-trigger-group")?.getBoundingClientRect()
        .top ?? null,
    // Keep App's aboutOpen in sync when a scrub (not a click) drives the change. Once fully
    // open, run any pending header-shortcut scroll (queued before the ~1.2s build finished).
    onSettle: (state) => {
      onOpenChange(state === "open");
      setRevealed(state === "open");
      onSettledChange?.(state === "open");
      if (state === "open") {
        // A snapped-back close scrub may have stopped Lenis — resume it.
        lenisRef.current?.start();
        scrollToSection();
      }
    },
    // A close scrub owns the wrapper: pause Lenis so the two don't fight.
    onScrub: (dir) => {
      if (dir === "close") lenisRef.current?.stop();
    },
  });

  // Drive the dissolve from the `open` prop (ABOUT button / Escape / close button). Skip when
  // a scrub already settled us into that state, so we don't re-animate on the echoed prop.
  const prevOpen = useRef(open);
  useEffect(() => {
    if (open === prevOpen.current) return;
    prevOpen.current = open;
    if (open) {
      if (getState() !== "open") playOpen();
    } else {
      if (getState() !== "closed") playClose();
    }
  }, [open, playOpen, playClose, getState]);

  // Header shortcut while the overlay is already open: scroll immediately. When still
  // closed, just queue it — the onSettle handler scrolls once the build finishes.
  useEffect(() => {
    if (!scrollTarget) return;
    pendingScrollRef.current = scrollTarget;
    if (getState() === "open") scrollToSection();
  }, [scrollTarget, getState, scrollToSection]);

  const toggleWork = (i) => {
    setOpenWorks((prev) => {
      const next = new Set(prev);
      next.has(i) ? next.delete(i) : next.add(i);
      return next;
    });
  };

  // Bound on the <li>, not the toggle, so an open row's panel counts as
  // "inside" — the indicator keeps reading [ Close ] while the cursor is
  // anywhere in the row. (The thumb is suppressed for open rows in CSS.)
  // Coarse pointers bail: taps fire synthetic mouseenter/mouseleave that would
  // fight the scroll spotlight (and stamp hoverSourceRef "pointer", skipping
  // the scramble's settle gate).
  const enterWork = (i) => {
    if (isCoarsePointer()) return;
    setHoveredWork(i);
  };
  const leaveWork = () => {
    if (isCoarsePointer()) return;
    setHoveredWork(null);
  };

  // The toggle is its own hover surface: the thumb, the blue title and the
  // scramble belong to the title line, not to an open row's panel.
  const enterToggle = (i) => {
    if (isCoarsePointer()) return;
    hoverSourceRef.current = "pointer";
    setHoveredToggle(i);
  };
  const leaveToggle = () => {
    if (isCoarsePointer()) return;
    hoverSourceRef.current = "pointer";
    setHoveredToggle(null);
  };

  // Hover without pointer movement: Lenis scrolling a row under a resting
  // cursor fires no mouseenter and (in wrapper mode, mid-animation) doesn't
  // reliably re-evaluate :hover either, so the row sat there looking untouched.
  // Same recipe as AsciiPortraitHover/AsciiCursor — ask lastPointer() where the
  // cursor is and re-run the hit test ourselves. One elementFromPoint for the
  // whole list rather than a listener per row.
  useEffect(() => {
    if (!open || !revealed || isCoarsePointer()) return;
    let rafId = 0;
    const hitTest = () => {
      rafId = 0;
      const p = lastPointer();
      if (!p || p.type === "touch") return;
      const el = document.elementFromPoint(p.x, p.y);
      const row = el?.closest(".works-row");
      const i = row ? Number(row.dataset.workIndex) : null;
      hoverSourceRef.current = "scroll";
      // Re-setting the same index is a no-op for React, so the list re-renders
      // on row transitions only, not once per scrolled frame.
      setHoveredWork(i);
      setHoveredToggle(el?.closest(".works-row__toggle") ? i : null);
    };
    // Lenis runs off gsap.ticker, so scroll fires every frame — coalesce.
    const schedule = () => {
      if (!rafId) rafId = requestAnimationFrame(hitTest);
    };
    // Capture phase: the overlay's own scroller is an element, and element
    // scroll events don't bubble.
    document.addEventListener("scroll", schedule, {
      capture: true,
      passive: true,
    });
    window.addEventListener("resize", schedule, { passive: true });
    // Opening (or expanding a panel) under a resting cursor counts too.
    schedule();
    return () => {
      if (rafId) cancelAnimationFrame(rafId);
      document.removeEventListener("scroll", schedule, { capture: true });
      window.removeEventListener("resize", schedule);
    };
  }, [open, revealed, openWorks]);

  // Touch spotlight — the coarse-pointer complement of the hit test above.
  // No hover surface exists, so the row crossing a focus line ~42% down the
  // viewport takes the hover look instead (thumb, blue title, scramble).
  // One state slot + one deterministic pick per frame = exactly one row lit;
  // rows are contiguous, so inside the list the pick is simply the row under
  // the line, and the proximity budget only decides how long the edge rows
  // stay lit as the list scrolls in and out of view.
  useEffect(() => {
    if (!open || !revealed || !isCoarsePointer()) return;
    let rafId = 0;
    const pick = () => {
      rafId = 0;
      const focusY = window.innerHeight * 0.42;
      let best = null;
      let bestDist = Infinity;
      rowToggleRefs.current.forEach((el, i) => {
        if (!el) return;
        const r = el.getBoundingClientRect();
        const d =
          focusY >= r.top && focusY <= r.bottom
            ? 0
            : Math.min(Math.abs(focusY - r.top), Math.abs(focusY - r.bottom));
        if (d < bestDist) {
          bestDist = d;
          best = i;
        }
      });
      // "scroll" routes the scramble through its settle gate, so a flick past
      // the whole list bursts only the landing row. hoveredWork stays untouched
      // — the indicator is display:none here and its effect bails on coarse.
      hoverSourceRef.current = "scroll";
      setHoveredToggle(bestDist <= window.innerHeight * 0.08 ? best : null);
    };
    const schedule = () => {
      if (!rafId) rafId = requestAnimationFrame(pick);
    };
    document.addEventListener("scroll", schedule, {
      capture: true,
      passive: true,
    });
    window.addEventListener("resize", schedule, { passive: true });
    // Opening/closing a panel shifts the rows without a scroll event — re-pick
    // when its grid-template-rows transition lands (indicator idiom).
    const list = worksListRef.current;
    const onEnd = (e) => {
      if (e.propertyName === "grid-template-rows") schedule();
    };
    list?.addEventListener("transitionend", onEnd);
    schedule();
    return () => {
      if (rafId) cancelAnimationFrame(rafId);
      document.removeEventListener("scroll", schedule, { capture: true });
      window.removeEventListener("resize", schedule);
      list?.removeEventListener("transitionend", onEnd);
    };
  }, [open, revealed, openWorks]);

  // The scramble is the one hover layer that doesn't want to fire per row
  // crossed: a flick past five rows would machine-gun five bursts down the
  // list. A scroll-driven hover therefore has to hold for SCRAMBLE_SETTLE_MS
  // before it bursts, while a real mouseenter still fires instantly.
  useEffect(() => {
    if (hoveredToggle == null) {
      setScrambleWork(null);
      return;
    }
    if (hoverSourceRef.current === "pointer") {
      setScrambleWork(hoveredToggle);
      return;
    }
    const id = setTimeout(
      () => setScrambleWork(hoveredToggle),
      SCRAMBLE_SETTLE_MS,
    );
    return () => clearTimeout(id);
  }, [hoveredToggle]);

  // Shared [ Open ]/[ Close ] indicator (negative-films services-indicator
  // idiom): one label in the section's right rail, GSAP-tweened to vertically
  // center on the hovered row and faded out at rest. openWorks is a dep so
  // clicking a row mid-hover re-centers after its panel resizes the list.
  useEffect(() => {
    if (isCoarsePointer()) return;
    const ind = worksIndicatorRef.current;
    const list = worksListRef.current;
    if (!ind || !list) return;
    const reduce = prefersReducedMotion();
    const position = () => {
      if (hoveredWork == null) {
        // Fade out where it stands — no travel back to the top.
        gsap.to(ind, {
          autoAlpha: 0,
          duration: reduce ? 0 : 0.4,
          ease: "power2.out",
        });
        return;
      }
      // Center on the toggle button, not the <li> — the li grows when its
      // panel opens, but the label belongs beside the row's title line.
      const row = rowToggleRefs.current[hoveredWork];
      if (!row) return;
      const rowRect = row.getBoundingClientRect();
      const listRect = list.getBoundingClientRect();
      const centerY = rowRect.top - listRect.top + rowRect.height / 2;
      const h = ind.offsetHeight;
      const pad = 20;
      const y = Math.max(
        pad,
        Math.min(centerY - h / 2, listRect.height - h - pad),
      );
      // Invisible → snap to the row and just fade in; sliding in from the
      // last faded-out spot would read as a ghost travelling mid-fade.
      if (gsap.getProperty(ind, "opacity") < 0.05) gsap.set(ind, { y });
      gsap.to(ind, {
        y,
        autoAlpha: 1,
        duration: reduce ? 0 : 0.4,
        ease: "power2.out",
      });
    };
    position();
    // Panels animate grid-template-rows for 0.3s, shifting the rows below;
    // transitionend bubbles from the panels up to the list — re-measure then.
    const onEnd = (e) => {
      if (e.propertyName === "grid-template-rows") position();
    };
    list.addEventListener("transitionend", onEnd);
    return () => {
      list.removeEventListener("transitionend", onEnd);
      gsap.killTweensOf(ind);
    };
  }, [hoveredWork, openWorks]);

  // Dismiss on Escape while the overlay is open.
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === "Escape") onOpenChange(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onOpenChange]);

  return (
    <div className="about-overlay" ref={overlayRef} aria-hidden={!open}>
      {/* No dedicated close button: the ▙▟ brand logo (App, z-25) floats above
          this overlay and closes it; Escape and pull-to-close also work. */}
      <div className="about-overlay__scroll" ref={scrollRef}>
        <div className="about-overlay__content" ref={contentRef}>
          <div className="about-overlay__inner">
            <section id="about" className="about-section">
              <header className="chapter-band">
                {/* No eyebrow row here: the About band is the overlay's
                    masthead, not an indexed chapter — CH numbering starts
                    at the Works/Contact sub-bands. */}
                <div className="chapter-band__lockup">
                  <h2 className="chapter-band__wordmark">
                    <DecryptText
                      text="HI, I'M CHRISTIAN"
                      accent="CHRISTIAN"
                      active={revealed}
                    />
                  </h2>
                  <p className="chapter-band__line">
                    A Frontend Developer from italy
                  </p>
                </div>
                <div className="chapter-band__row">
                  <span>Building for the web</span>
                  <span>Since 2018</span>
                </div>
              </header>
              {/* Reading block: one text flow wrapping the centered ascii
                  figure. Two shape-outside floats (silhouette half-masks)
                  carve his outline out of the text on each side; the figure
                  is absolutely centered on top. `revealed` drives the
                  decode-in. Without shape-outside support it falls back to
                  side columns (see global.css @supports block). */}
              <div className="chapter-reading">
                <div
                  ref={flowRef}
                  className="chapter-reading__flow"
                  style={wrapVars ?? undefined}
                >
                  <figure
                    ref={headFigRef}
                    className="about-portrait about-portrait--head"
                  >
                    <AsciiPortraitHover
                      src={PORTRAIT_SRC}
                      active={revealed}
                      label="ASCII portrait of Christian"
                      detail={HEAD_DETAIL}
                      onContour={handleContour}
                    />
                    {/* Lives INSIDE the figure so inset:0 tracks the crop box
                        exactly — no duplicated geometry to drift. */}
                    {WRAP_DEBUG && (
                      <span className="wrap-mask" aria-hidden="true" />
                    )}
                  </figure>
                  {/* Each column carries its own silhouette float (separate
                      formatting contexts, so they never collide) whose
                      shape-outside hugs the near half of the figure. */}
                  {/* data-cursor: the ascii cursor hides the system pointer,
                      which takes the I-beam with it — these say "still
                      selectable" on the surfaces where that matters. */}
                  <p
                    className="chapter-reading__col chapter-reading__col--left"
                    data-cursor="text"
                  >
                    <span
                      ref={silhLRef}
                      className="about-silh about-silh--l"
                      aria-hidden="true"
                    />
                    {BODY_1}
                  </p>
                  {/* Second beat, phones only (CSS hides it from 768 up, where
                      the single centred figure of the spread takes over): the
                      legs crop, floated the other way so the copy switches
                      sides as it comes down the page. Same source image — the
                      box crops it, exactly as --hip-cut crops the head. */}
                  <figure
                    ref={legsFigRef}
                    className="about-portrait about-portrait--legs"
                    aria-hidden="true"
                  >
                    <AsciiPortraitHover
                      src={PORTRAIT_SRC}
                      active={revealed}
                      detail={LEGS_DETAIL}
                    />
                    {WRAP_DEBUG && (
                      <span className="wrap-mask" aria-hidden="true" />
                    )}
                  </figure>
                  <p
                    className="chapter-reading__col chapter-reading__col--right"
                    data-cursor="text"
                  >
                    <span
                      ref={silhRRef}
                      className="about-silh about-silh--r"
                      aria-hidden="true"
                    />
                    <Body2 />
                  </p>
                  {WRAP_DEBUG && (
                    <>
                      <div
                        className="wrap-debug wrap-debug--l"
                        aria-hidden="true"
                      />
                      <div
                        className="wrap-debug wrap-debug--r"
                        aria-hidden="true"
                      />
                      {probe && (
                        <pre className="wrap-probe" aria-hidden="true">
                          {probe.join("\n")}
                        </pre>
                      )}
                    </>
                  )}
                </div>
              </div>
            </section>

            <section id="works" className="about-section">
              <header className="chapter-band chapter-band--sub">
                <div className="chapter-band__lockup">
                  <h2 className="chapter-band__line">Works</h2>
                </div>
              </header>
              <div className="works-list-wrap">
                <ul className="works-list" ref={worksListRef}>
                  {WORKS.map((work, i) => {
                    const isOpen = openWorks.has(i);
                    return (
                      <li
                        key={work.title}
                        className={`works-row${isOpen ? " is-open" : ""}`}
                        data-work-index={i}
                        onMouseEnter={() => enterWork(i)}
                        onMouseLeave={leaveWork}
                      >
                        <button
                          type="button"
                          className={`works-row__toggle${
                            hoveredToggle === i ? " is-hovered" : ""
                          }`}
                          ref={(el) => (rowToggleRefs.current[i] = el)}
                          aria-expanded={isOpen}
                          onClick={() => toggleWork(i)}
                          onMouseEnter={() => enterToggle(i)}
                          onMouseLeave={leaveToggle}
                        >
                          <span className="works-row__lead">
                            <span
                              className="works-row__thumb"
                              aria-hidden="true"
                            >
                              <img
                                src={work.thumb ?? work.images[0]}
                                alt=""
                                loading="lazy"
                              />
                            </span>
                            <span className="works-row__title">
                              <WorksTitleScramble
                                text={work.title}
                                active={scrambleWork === i}
                              />
                            </span>
                          </span>
                          <span className="works-row__meta">
                            {/* Conditional: an unreleased entry carries only a
                                status badge, and .works-row__meta is a
                                gap'd inline-flex — an empty year span would
                                still push the badge over by one gap. */}
                            {work.meta ? (
                              <span className="works-row__year">
                                {work.meta}
                              </span>
                            ) : null}
                            {work.status ? (
                              <span className="works-row__status">
                                {work.status}
                              </span>
                            ) : null}
                          </span>
                        </button>
                        <div className="works-row__panel">
                          <div className="works-row__panel-inner">
                            {/* Media first in source: mobile's single column
                              auto-flows image → text → marquee → stack;
                              desktop places text/media explicitly. */}
                            <div className="works-panel">
                              <WorksPanelImage
                                images={work.images}
                                label={work.title}
                                active={isOpen && open}
                              />
                              <div
                                className="works-panel__text"
                                data-cursor="text"
                              >
                                {/* `detail` is a string for a one-paragraph
                                    entry, or an array when the copy runs to
                                    several. */}
                                {(Array.isArray(work.detail)
                                  ? work.detail
                                  : [work.detail]
                                ).map((para, pi) => (
                                  <p key={pi}>{para}</p>
                                ))}
                              </div>
                              {work.clients?.length && work.clientsLead ? (
                                <p className="works-panel__clients-lead">
                                  {work.clientsLead}
                                </p>
                              ) : null}
                              {work.clients?.length ? (
                                <WorksClientMarquee clients={work.clients} />
                              ) : null}
                              <div className="works-panel__stack">
                                <span className="works-panel__stack-label">
                                  Stack
                                </span>
                                {work.stack.map((s) => (
                                  <span className="works-panel__chip" key={s}>
                                    {s}
                                  </span>
                                ))}
                              </div>
                            </div>
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
                <span
                  className="works-indicator"
                  ref={worksIndicatorRef}
                  aria-hidden="true"
                >
                  {hoveredWork != null && openWorks.has(hoveredWork)
                    ? "[ Close ]"
                    : "[ Open ]"}
                </span>
              </div>
            </section>

            {/* Footer-anatomy contact (negative-films culture page): heading +
                copy up top, border-top meta row pinned at the viewport base. */}
            <section id="contact" className="about-section contact-footer">
              {/* Ascii liquid under the whole section — the section itself
                  feeds it pointermove, so links on top still stir it. */}
              <ContactLiquid active={revealed} />
              <div className="contact-footer__main">
                <header className="chapter-band chapter-band--sub">
                  <div className="chapter-band__lockup">
                    <h2 className="chapter-band__line">Contact</h2>
                  </div>
                </header>
                <p className="contact-footer__copy">
                  Have a project, a role, or something worth building? My
                  inbox is open.
                </p>
              </div>
              <div className="contact-footer__meta">
                <div className="contact-footer__meta-row">
                  <div className="contact-footer__col">
                    <span className="contact-footer__label">Get in touch</span>
                    <a
                      className="contact-link"
                      href="mailto:christianmail046@gmail.com"
                    >
                      christianmail046@gmail.com
                    </a>
                  </div>
                  <div className="contact-footer__col">
                    <span className="contact-footer__label">Elsewhere</span>
                    {SOCIALS.map((s) => (
                      <a
                        key={s.label}
                        className="contact-link"
                        href={s.href}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {s.label}
                      </a>
                    ))}
                  </div>
                </div>
                <div className="contact-footer__meta-row contact-footer__meta-row--base">
                  <span>© 2026 Christian</span>
                  <div className="contact-footer__actions">
                    {/* End of the overlay = the natural place to go back, so
                        the footer closes it rather than making the reader
                        scroll all the way up to the brand mark. */}
                    <button
                      type="button"
                      className="contact-footer__action"
                      onClick={() => onOpenChange(false)}
                    >
                      [ back to home ]
                    </button>
                    {/* Only for visitors who opted into skipping — everyone
                        else has nothing to undo, and the intro plays anyway. */}
                    {offered && (
                      <button
                        type="button"
                        className="contact-footer__action"
                        onClick={toggleSkip}
                        role="switch"
                        aria-checked={skipOn}
                      >
                        [ intro: {skipOn ? "off" : "on"} ]
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </section>

            {/* Cursor pets parked for now (2026-07-21) — CursorArtifact.jsx,
                its CSS, and the public/ascii bakes are all still in place;
                re-mounting the component here brings them back. */}
          </div>
        </div>
      </div>

      <canvas className="about-overlay__dissolve" ref={canvasRef} />
    </div>
  );
}
