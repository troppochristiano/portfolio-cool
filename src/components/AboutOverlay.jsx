import { useCallback, useEffect, useRef, useState } from "react";
import { useDissolveReveal } from "../hooks/useDissolveReveal";

// Placeholder Works entries — modeled on the henriheymans.com "Recognitions & Awards"
// expandable list. Real entries (with links/thumbnails) get filled in later.
const WORKS = [
  {
    title: "Project One",
    meta: "2024",
    detail:
      "Placeholder description for the first project. Replace with a real summary, role, and a link once the work is ready to show.",
  },
  {
    title: "Project Two",
    meta: "2024",
    detail:
      "Placeholder description for the second project. Replace with a real summary, role, and a link once the work is ready to show.",
  },
  {
    title: "Project Three",
    meta: "2023",
    detail:
      "Placeholder description for the third project. Replace with a real summary, role, and a link once the work is ready to show.",
  },
  {
    title: "Project Four",
    meta: "2023",
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

// Full-screen scrollable overlay reached from the ABOUT trigger under the avatar. Owns its
// own scroll (the body is overflow:hidden) and reuses the site's neon/blue aesthetic.
//
// Open/close are driven by the KVS "dissolve" effect (useDissolveReveal): the overlay builds
// bottom→top on open and dissolves top→bottom on close, revealing the hero behind. The same
// hook owns the scroll-to-open scrub and the pull-to-close-at-top scrub, so the old one-shot
// wheel-open (in App) and the 690px pull-to-close indicator are no longer needed.
export function AboutOverlay({
  open,
  onOpenChange,
  ready = true,
  scrollTarget = null,
  onScrolled,
}) {
  // Set of open accordion indices — rows toggle independently.
  const [openWorks, setOpenWorks] = useState(() => new Set());
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
      next.has(i) ? next.delete(i) : next.add(i);
      return next;
    });
  };

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
      <button
        type="button"
        className="about-overlay__close"
        onClick={() => onOpenChange(false)}
        aria-label="Close"
      >
        Close ×
      </button>

      <div className="about-overlay__scroll" ref={scrollRef}>
        <div className="about-overlay__content" ref={contentRef}>
          <div className="about-overlay__inner">
            <section id="about" className="about-section">
              <h2 className="about-section__heading">About</h2>
              <div className="about-overlay__about-copy">
                <p>
                  Placeholder about copy. This is the first section — plain text
                  for now, with a reveal animation to be added later.
                </p>
                <p>
                  Replace this with a real introduction: who you are, what you
                  make, and the ideas behind the work. A second paragraph can
                  carry more detail.
                </p>
              </div>
            </section>

            <section id="works" className="about-section">
              <h2 className="about-section__heading">Works</h2>
              <ul className="works-list">
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
            </section>

            <section id="contact" className="about-section">
              <h2 className="about-section__heading">Contact</h2>
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
          </div>
        </div>
      </div>

      <canvas className="about-overlay__dissolve" ref={canvasRef} />
    </div>
  );
}
