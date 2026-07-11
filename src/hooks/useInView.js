import { useEffect, useState } from "react";

// Is `ref`'s element visible in the viewport? With hysteresis: it must reach
// `enter` visibility to flip on, and drop to `exit` to flip off. A single
// threshold flapped on phones — a card parked near the boundary re-crossed it
// on every URL-bar show/hide and scroll jitter, restarting the gallery's
// decode animation over and over instead of letting it settle.
//
// One IntersectionObserver per caller — the same pattern as the gallery's
// infinite-scroll sentinel; IO accounts for clipping by scrollable ancestors,
// so it works inside the .gallery-page scroller with the default root.
//
// `enabled: false` disconnects the observer and reports false. Callers must
// gate on it themselves for parked keep-alive pages: those layers are
// visibility:hidden, which does NOT stop intersections from being reported.
export function useInView(ref, { enabled = true, enter = 0.4, exit = 0.08 } = {}) {
  const [inView, setInView] = useState(false);

  useEffect(() => {
    if (!enabled) {
      setInView(false);
      return;
    }
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          const ratio = e.isIntersecting ? e.intersectionRatio : 0;
          setInView((prev) => {
            if (!prev && ratio >= enter) return true;
            if (prev && ratio <= exit) return false;
            return prev;
          });
        }
      },
      // Observe both boundaries; the state machine above supplies the
      // stickiness between them.
      { threshold: [exit, enter] },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [ref, enabled, enter, exit]);

  return inView;
}
