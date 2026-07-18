import { useCallback, useEffect, useRef, useState } from "react";
import { useDissolveReveal } from "../hooks/useDissolveReveal";
import { useAsciiDecode } from "../hooks/useAsciiDecode.js";
import { useAsciiPortrait } from "../hooks/useAsciiPortrait.js";
import { DecryptText } from "./DecryptText.jsx";
import { CursorArtifact } from "./CursorArtifact.jsx";
import { WorksHoverPreview } from "./WorksHoverPreview.jsx";
import AsciiPlayer from "./AsciiPlayer.jsx";

// The intro copy. The old headline sentence ("I'm Christian — a frontend
// developer building for the web since 2018.") is distributed across the
// chapter band: name → wordmark, role → squeezed line, the rest → the mono
// footer row. The wordmark types on through DecryptText (empty while closed,
// scramble fringe once the overlay settles); the body stays plain text.
const BODY_1 =
  "Most of the projects I've worked on professionally have been practical work: custom configurators, real-time dashboards, and backoffice systems people used to get their jobs done. For a few years I was the only frontend where I worked, so I handled everything from architecture to the small details — and helped the junior developers on the team along the way.";
const BODY_2 =
  "This site is the other half. The part with no client and no spec, built for no reason beyond wanting to see it work.";

// Placeholder portrait: the avatar's center-gaze neutral texture, already
// served (and pre-warmed by the hero preload). Swap for a dedicated portrait
// render later.
const PORTRAIT_SRC =
  "/outputs/meBW/expressions/neutral/meBW_055_5_5_yaw2.2_pitch2.2_px1.7_py-1.7.webp";

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

// Per-section cursor pets, keyed by section id (Create-page Export JSON
// bakes; hand-drawn placeholders for now — overwrite the files to recast).
// Module-level on purpose: CursorArtifact refetches when this object's
// identity changes.
const CURSOR_FACES = {
  about: "/ascii/cursor-bird.json",
  works: "/ascii/cursor-fish.json",
  contact: "/ascii/cursor-dog.json",
};

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
  const overlayRef = useRef(null);
  const scrollRef = useRef(null);
  const canvasRef = useRef(null);
  const contentRef = useRef(null);
  // The whole chapter column — the cursor artifact's hover zone and
  // coordinate space (its faces clip themselves to each section's band).
  const innerRef = useRef(null);
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
      if (state === "open") scrollToSection();
    },
  });

  // ASCII portrait for the About section: sparse thumb while closed/mid-sweep,
  // decodes into the dense figure once the overlay settles open (same reveal
  // as a gallery card, driven by `revealed` instead of hover).
  const portrait = useAsciiPortrait(PORTRAIT_SRC);
  const decoded = useAsciiDecode({
    active: revealed,
    item: portrait?.item,
    display: portrait?.display ?? null,
  });
  const portraitShown = decoded ?? portrait?.thumbFigure;

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
          <div className="about-overlay__inner" ref={innerRef}>
            <section id="about" className="about-section">
              <header className="chapter-band">
                {/* No eyebrow row here: the About band is the overlay's
                    masthead, not an indexed chapter — CH numbering starts
                    at the Works/Contact sub-bands. */}
                <div className="chapter-band__lockup">
                  <h2 className="chapter-band__wordmark">
                    <DecryptText
                      text="HI I'M CHRISTIAN"
                      accent="CHRISTIAN"
                      active={revealed}
                    />
                  </h2>
                  <p className="chapter-band__line">A Frontend Developer</p>
                </div>
                <div className="chapter-band__row">
                  <span>Building for the web</span>
                  <span>Since 2018</span>
                </div>
              </header>
              <div className="chapter-reading">
                <div className="chapter-reading__cols">
                  <div className="chapter-reading__body">
                    <p>{BODY_1}</p>
                    <p>{BODY_2}</p>
                  </div>
                  <div className="chapter-reading__aside">
                    {portraitShown && (
                      <AsciiPlayer
                        data={portraitShown}
                        fit
                        label="ASCII portrait of Christian"
                      />
                    )}
                  </div>
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

            {/* Little ascii pet trailing the cursor across the whole column —
                a different creature per chapter, swapped at the section
                borders by clipping (no fade between sections). Active once
                settled open, same gate as the decrypt + portrait. Each face
                is a Create-page JSON export (hand-drawn placeholders for
                now); a missing file falls back to the procedural blob. */}
            <CursorArtifact
              active={revealed}
              boundsRef={innerRef}
              scrollRef={scrollRef}
              faces={CURSOR_FACES}
            />
          </div>
        </div>
      </div>

      <canvas className="about-overlay__dissolve" ref={canvasRef} />
    </div>
  );
}
