import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import FigureCard from "../components/FigureCard.jsx";
import FigureDialog from "../components/FigureDialog.jsx";
import { getGalleryPage } from "../lib/api.js";
import "./Gallery.css";

// Community gallery: an infinite-scroll grid of approved figures. Cards render
// the tiny text thumbnail stored in D1 (a few KB each — no R2 reads for the
// grid); hovering/focusing a card lazily fetches the full JSON once and plays
// it in place; clicking opens the shared info dialog.

const descriptorFor = (item) => ({
  key: item.id,
  name: item.name,
  author: item.author,
  url: `/api/figures/${item.id}/data`,
  createdAt: item.createdAt,
  framesCount: item.framesCount,
});

export default function Gallery() {
  const [items, setItems] = useState([]);
  const [cursor, setCursor] = useState(null);
  const [exhausted, setExhausted] = useState(false);
  const [failed, setFailed] = useState(false);
  const [selected, setSelected] = useState(null);
  const loadingRef = useRef(false);
  const sentinelRef = useRef(null);

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
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || exhausted) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting) && cursor) loadMore(cursor);
      },
      { rootMargin: "600px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [cursor, exhausted, loadMore]);

  return (
    <div className="gallery-page">
      <header className="gallery-head">
        <Link className="home-pill" to="/">
          ← Christian Bianchi
        </Link>
        <h1 className="gallery-title">community gallery</h1>
        <p className="gallery-tagline">
          figures baked with the <Link to="/create">converter</Link> and shared
          by visitors
        </p>
      </header>

      <main className="gallery-grid">
        {items.map((item) => (
          <FigureCard
            key={item.id}
            item={item}
            onSelect={(it) => setSelected(descriptorFor(it))}
          />
        ))}
      </main>

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
