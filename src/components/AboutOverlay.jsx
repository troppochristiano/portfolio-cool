import { useCallback, useEffect, useRef, useState } from "react";
import { useDissolveReveal } from "../hooks/useDissolveReveal";
import { AsciiPortraitHover } from "./AsciiPortraitHover.jsx";
import { DecryptText } from "./DecryptText.jsx";
import { WorksHoverPreview } from "./WorksHoverPreview.jsx";

// The intro copy. The old headline sentence ("I'm Christian — a frontend
// developer building for the web since 2018.") is distributed across the
// chapter band: name → wordmark, role → squeezed line, the rest → the mono
// footer row. The wordmark types on through DecryptText (empty while closed,
// scramble fringe once the overlay settles); the body stays plain text.
const BODY_1 =
  "Most of the projects I've worked on professionally have been practical work: custom configurators, real-time dashboards, and backoffice systems people used to get their jobs done. For a few years I was the only frontend where I worked, so I handled everything from architecture to the small details — and helped the junior developers on the team along the way.";
const BODY_2 =
  "This site is the other half. The part with no client and no spec, built for no reason beyond wanting to see it work.";

// Full-body cutout (transparent bg), rendered by AsciiPortraitHover as the
// blue canvas-ascii figure in the middle of the reading spread.
const PORTRAIT_SRC = "/outputs/portrait/me-full.webp";

// Placeholder Works entries — modeled on the henriheymans.com "Recognitions & Awards"
// expandable list. Real entries (with links/thumbnails) get filled in later.
const WORKS = [
  {
    title: "Project One",
    meta: "2024",
    thumb: "/works/placeholder-1.svg",
    detail:
      "Placeholder description for the first project. Replace with a real summary, role, and a link once the work is ready to show.",
  },
  {
    title: "Project Two",
    meta: "2024",
    thumb: "/works/placeholder-2.svg",
    detail:
      "Placeholder description for the second project. Replace with a real summary, role, and a link once the work is ready to show.",
  },
  {
    title: "Project Three",
    meta: "2023",
    thumb: "/works/placeholder-3.svg",
    detail:
      "Placeholder description for the third project. Replace with a real summary, role, and a link once the work is ready to show.",
  },
  {
    title: "Project Four",
    meta: "2023",
    thumb: "/works/placeholder-4.svg",
    detail:
      "Placeholder description for the fourth project. Replace with a real summary, role, and a link once the work is ready to show.",
  },
];

// Placeholder contact links — swap in real handles/URLs later.
const SOCIALS = [
  { label: "Instagram", href: "#" },
  { label: "GitHub", href: "#" },
  { label: "LinkedIn", href: "#" },
];

// ?wrapdebug renders the generated wrap polygons as translucent overlays so
// the text-wrap contours can be eyeballed against the figure.
const WRAP_DEBUG =
  typeof window !== "undefined" &&
  new URLSearchParams(window.location.search).has("wrapdebug");

// Tracks --hip-cut in global.css: the desktop About figure shows the top 46%
// of the grid (cut just under the hands); mobile shows the full body.
const DESKTOP_HIP_CUT = 0.46;

// The About text wraps along the figure's real silhouette: AsciiPortraitHover
// reports per-row opaque extents of the drawn glyph grid, and these become
// shape-outside polygons (via CSS custom properties) for the desktop
// half-box floats and the mobile full-box float. Auto-derived — survives
// crop/size changes with no hand-tuned contours.
function contourToPolygons({ bands }) {
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
  const visible = bands.filter((b) => b.y <= DESKTOP_HIP_CUT);
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
    // Mobile full-body box (legs pocket included — concave is fine).
    "--wrap-full-l": build(
      bands.map((b) => [b.left, b.y]),
      "100%",
    ),
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
  // Set of open accordion indices — rows toggle independently.
  const [openWorks, setOpenWorks] = useState(() => new Set());
  // Cursor-following pixel-decode preview for the hovered Works row. `key`
  // bumps on every enter so the decode replays; `pointer` is written on
  // mousemove and read by the preview's own rAF loop (no re-render per move).
  const [preview, setPreview] = useState({ src: null, key: 0, visible: false });
  const pointerRef = useRef({ x: 0, y: 0 });
  // True only while fully settled open — drives the headline decrypt and the
  // portrait decode, and resets them on close so both replay on every open.
  const [revealed, setRevealed] = useState(false);
  // Auto-contour wrap polygons (CSS custom properties for the silh floats),
  // derived from the drawn figure once its cell grid is built.
  const [wrapVars, setWrapVars] = useState(null);
  const handleContour = useCallback((contour) => {
    setWrapVars(contourToPolygons(contour));
  }, []);
  const overlayRef = useRef(null);
  const scrollRef = useRef(null);
  const canvasRef = useRef(null);
  const contentRef = useRef(null);
  // Section id queued by a header shortcut; consumed once the overlay is open + scrollable.
  const pendingScrollRef = useRef(null);

  // Scroll the queued section into view. Only effective once settleOpen has flipped the
  // scroll container to overflow-y:auto; rAF lets that layout settle first.
  const scrollToSection = useCallback(() => {
    const id = pendingScrollRef.current;
    if (!id) return;
    pendingScrollRef.current = null;
    requestAnimationFrame(() => {
      document
        .getElementById(id)
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    onScrolled?.();
  }, [onScrolled]);

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
      if (state === "open") scrollToSection();
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
      const willOpen = !next.has(i);
      next.has(i) ? next.delete(i) : next.add(i);
      // Opening the row reveals the image inside it, so drop the cursor peek.
      if (willOpen) setPreview((p) => ({ ...p, visible: false }));
      return next;
    });
  };

  // Track the pointer for the floating preview (fixed/viewport coords).
  const trackPointer = (e) => {
    pointerRef.current = { x: e.clientX, y: e.clientY };
  };

  // Show + (re)decode the preview for the row the cursor entered — but not
  // while the row is open, since its image already lives in the panel.
  const enterWork = (i, e) => {
    if (openWorks.has(i)) return;
    pointerRef.current = { x: e.clientX, y: e.clientY };
    setPreview((p) => ({ src: WORKS[i].thumb, key: p.key + 1, visible: true }));
  };

  const leaveWork = () => setPreview((p) => ({ ...p, visible: false }));

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
                  className="chapter-reading__flow"
                  style={wrapVars ?? undefined}
                >
                  <figure className="about-portrait">
                    <AsciiPortraitHover
                      src={PORTRAIT_SRC}
                      active={revealed}
                      label="ASCII portrait of Christian"
                      onContour={handleContour}
                    />
                  </figure>
                  {/* Each column carries its own silhouette float (separate
                      formatting contexts, so they never collide) whose
                      shape-outside hugs the near half of the figure. */}
                  <p className="chapter-reading__col chapter-reading__col--left">
                    <span
                      className="about-silh about-silh--l"
                      aria-hidden="true"
                    />
                    {BODY_1}
                  </p>
                  <p className="chapter-reading__col chapter-reading__col--right">
                    <span
                      className="about-silh about-silh--r"
                      aria-hidden="true"
                    />
                    {BODY_2}
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
                      <div
                        className="wrap-debug wrap-debug--full"
                        aria-hidden="true"
                      />
                    </>
                  )}
                </div>
              </div>
            </section>

            <section id="works" className="about-section">
              <header className="chapter-band chapter-band--sub">
                <div className="chapter-band__row">
                  <span>CH.01</span>
                  <span>Selected projects</span>
                </div>
                <div className="chapter-band__lockup">
                  <h2 className="chapter-band__line">Works</h2>
                </div>
              </header>
              <ul className="works-list" onMouseMove={trackPointer}>
                {WORKS.map((work, i) => {
                  const isOpen = openWorks.has(i);
                  return (
                    <li
                      key={work.title}
                      className={`works-row${isOpen ? " is-open" : ""}`}
                    >
                      <button
                        type="button"
                        className="works-row__toggle"
                        aria-expanded={isOpen}
                        onClick={() => toggleWork(i)}
                        onMouseEnter={(e) => enterWork(i, e)}
                        onMouseLeave={leaveWork}
                      >
                        <span className="works-row__title">{work.title}</span>
                        <span className="works-row__meta">{work.meta}</span>
                        <span
                          className="works-row__indicator"
                          aria-hidden="true"
                        >
                          {isOpen ? "−" : "+"}
                        </span>
                      </button>
                      <div className="works-row__panel">
                        <div className="works-row__panel-inner">
                          <p>{work.detail}</p>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
              <WorksHoverPreview
                src={preview.src}
                revealKey={preview.key}
                visible={preview.visible}
                pointerRef={pointerRef}
              />
            </section>

            <section id="contact" className="about-section">
              <header className="chapter-band chapter-band--sub">
                <div className="chapter-band__row">
                  <span>CH.02</span>
                  <span>Get in touch</span>
                </div>
                <div className="chapter-band__lockup">
                  <h2 className="chapter-band__line">Contact</h2>
                </div>
              </header>
              <ul className="contact-list">
                <li>
                  <a
                    className="contact-link"
                    href="mailto:christianmail046@gmail.com"
                  >
                    christianmail046@gmail.com
                  </a>
                </li>
                {SOCIALS.map((s) => (
                  <li key={s.label}>
                    <a
                      className="contact-link"
                      href={s.href}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {s.label}
                    </a>
                  </li>
                ))}
              </ul>
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
