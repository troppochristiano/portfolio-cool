import { useEffect, useRef, useState } from 'react';
import AsciiPlayer from './AsciiPlayer.jsx';
import { getFigureData } from '../lib/api.js';
import { isCoarsePointer } from '../lib/utils.js';
import { usePageActive } from '../lib/pageActiveContext.js';
import { useInView } from '../hooks/useInView.js';
import { useAsciiDecode } from '../hooks/useAsciiDecode.js';
import '../pages/Gallery.css';

// One gallery card: static text thumb from D1 that "decodes" into the full
// figure — a scramble reveal (useAsciiDecode) that starts from the visible
// thumb and settles cell by cell into the real thing; clips then autoplay on
// loop. Desktop decodes on hover/focus; touch devices decode when the card
// scrolls into view. Used by the public /gallery grid and the admin library
// (which passes `fetchData` with the bearer header and a `badges` slot for
// status/hero markers).

// Touch device — captured once at module load (same convention as the wall's
// COARSE_OR_SMALL): swaps the hover trigger for the in-view observer.
// No mobile resolution cap: downsampleFigure's integer strides butchered
// mid-size figures (180 cols → stride 2 → 90, barely above the thumb), and
// the info dialog already plays uncapped figures on phones without trouble.
const COARSE = isCoarsePointer();

// The thumb inherits the figure's style block so the grid shows each card
// the way its creator styled it (font, colors) without fetching the full JSON.
const thumbData = (item) => ({
  cols: item.thumbCols,
  rows: item.thumbRows,
  fps: 1,
  color: false,
  ...(item.style ? { style: item.style } : {}),
  frames: [item.thumb],
  // Edge-colored figures ship a matching downsampled edge thumb; the player
  // overlays it (tinted via style.edgeColor) so the card matches the figure.
  ...(item.edgeThumb ? { edgeFrames: [item.edgeThumb] } : {}),
});

export default function FigureCard({ item, onSelect, badges, fetchData }) {
  const [full, setFull] = useState(null); // full figure.json once activated
  const [hovering, setHovering] = useState(false); // fine-pointer trigger
  const rootRef = useRef(null);

  // Parked keep-alive gallery layers are visibility:hidden but still produce
  // intersections and keep state — pageActive is the hard off switch that
  // reverts every card to its (playback-free) thumb while hidden.
  const pageActive = usePageActive();
  const inView = useInView(rootRef, { enabled: COARSE && pageActive });
  const active = pageActive && (COARSE ? inView : hovering);

  // Parking the page never fires pointerleave — drop a stale hover so the
  // card doesn't silently re-decode when the user navigates back.
  useEffect(() => {
    if (!pageActive) setHovering(false);
  }, [pageActive]);

  // Fetch the full figure on first activation. getFigureData is
  // promise-cached in api.js, so repeat hovers/scroll-bys are free.
  useEffect(() => {
    if (!active || full) return;
    let alive = true;
    const fetcher = fetchData || ((id) => getFigureData(`/api/figures/${id}/data`));
    fetcher(item.id)
      .then((d) => {
        if (alive) setFull(d);
      })
      .catch(() => {}); // card keeps the thumb — ambient, not critical
    return () => {
      alive = false;
    };
  }, [active, full, item.id, fetchData]);

  // The scramble reveal runs on every activation (the animation IS the
  // feedback); deactivating snaps back to the thumb, which also bounds how
  // many full-res players exist at once on a phone. Cards settle on the true
  // full figure on every pointer type.
  const decoded = useAsciiDecode({ active, item, display: full });
  const shown = (active && decoded) || thumbData(item);

  return (
    <button
      type="button"
      ref={rootRef}
      className="gallery-card"
      // Touch devices activate via the in-view observer instead — a tap's
      // synthetic pointerenter should go straight to the dialog, not decode.
      onPointerEnter={COARSE ? undefined : () => setHovering(true)}
      onPointerLeave={COARSE ? undefined : () => setHovering(false)}
      onFocus={COARSE ? undefined : () => setHovering(true)}
      onBlur={COARSE ? undefined : () => setHovering(false)}
      onClick={() => onSelect(item)}
    >
      <div
        className="gallery-card__screen"
        style={item.style?.background ? { background: item.style.background } : undefined}
      >
        {/* contain: letterbox inside the 4:3 screen instead of overflowing it
            (portrait figures used to get cropped by the screen's overflow) */}
        <AsciiPlayer data={shown} fit contain loop />
        {/* Same muted note the dialog shows while the full figure is in flight;
            the static thumb stays visible underneath. */}
        {active && !full && <span className="gallery-card__loading">loading…</span>}
      </div>
      {badges && <div className="gallery-card__badges">{badges}</div>}
      <div className="gallery-card__caption">
        <span className="gallery-card__name">{item.name}</span>
        <span className="gallery-card__author">by {item.author}</span>
      </div>
    </button>
  );
}
