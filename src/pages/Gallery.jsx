import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import FigureCard from "../components/FigureCard.jsx";
import FigureDialog from "../components/FigureDialog.jsx";
import { descriptorFor, getGalleryPage } from "../lib/api.js";
import { usePageActive } from "../lib/pageActiveContext.js";
import { isCoarsePointer } from "../lib/utils.js";
import { RowHoverProvider } from "../hooks/useRowHover.jsx";
import "./Gallery.css";

// Community gallery: an infinite-scroll grid of approved figures. Cards render
// the tiny text thumbnail stored in D1 (a few KB each — no R2 reads for the
// grid); hovering/focusing a card decodes that card's whole ROW, each one
// lazily fetching the full JSON once and playing it in place; clicking opens
// the shared info dialog.

// Touch devices decode on scroll-into-view instead (FigureCard's own COARSE
// branch), so the row choreography has nothing to drive there.
const COARSE = isCoarsePointer();

export default function Gallery() {
  const [items, setItems] = useState([]);
  const [cursor, setCursor] = useState(null);
  const [exhausted, setExhausted] = useState(false);
  const [failed, setFailed] = useState(false);
  const [selected, setSelected] = useState(null);
  const loadingRef = useRef(false);
  const sentinelRef = useRef(null);
  const gridRef = useRef(null);
  // False while this page sits parked in a hidden keep-alive layer — the
  // layer is visibility:hidden, which does NOT stop IntersectionObservers,
  // so the infinite scroll must switch itself off explicitly.
  const pageActive = usePageActive();

  const loadMore = useCallback(async (cur) => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    try {
      const { items: page, nextCursor } = await getGalleryPage(cur);
      setItems((prev) => (cur ? [...prev, ...page] : page));
      setCursor(nextCursor);
      if (!nextCursor) setExhausted(true);
    } catch {
      setFailed(true);
      setExhausted(true);
    } finally {
      loadingRef.current = false;
    }
  }, []);

  useEffect(() => {
    loadMore(null);
  }, [loadMore]);

  // Infinite scroll: fetch the next page whenever the sentinel enters view.
  // Not observed while parked; re-arms (and fires if the sentinel is still in
  // view) when the page becomes active again.
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || exhausted || !pageActive) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting) && cursor) loadMore(cursor);
      },
      { rootMargin: "600px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [cursor, exhausted, loadMore, pageActive]);

  return (
    <div className="gallery-page">
      <header className="gallery-head">
        {/* Slim single row (pill + squeezed title), matching the Create
            masthead — no chapter eyebrow. */}
        <div className="gallery-head__bar">
          <Link className="home-pill" to="/">
            ← Home
          </Link>
          <h1 className="chapter-band__line gallery-title">community gallery</h1>
        </div>
        <p className="gallery-tagline">
          figures baked with the <Link to="/create">converter</Link> and shared
          by visitors
        </p>
      </header>

      <RowHoverProvider gridRef={gridRef} count={items.length} enabled={!COARSE}>
        <main className="gallery-grid" ref={gridRef}>
          {items.map((item, index) => (
            <FigureCard
              key={item.id}
              item={item}
              index={index}
              onSelect={(it) => setSelected(descriptorFor(it))}
            />
          ))}
        </main>
      </RowHoverProvider>

      {items.length === 0 && exhausted && (
        <p className="gallery-empty">
          {failed
            ? "the gallery couldn't be reached — try again later."
            : "nothing here yet — be the first to share a figure from the converter."}
        </p>
      )}

      {!exhausted && (
        <div
          ref={sentinelRef}
          className="gallery-sentinel"
          aria-hidden="true"
        />
      )}

      {selected && (
        <FigureDialog figure={selected} onClose={() => setSelected(null)} />
      )}
    </div>
  );
}
