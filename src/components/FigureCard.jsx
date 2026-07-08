import { useState } from 'react';
import AsciiPlayer from './AsciiPlayer.jsx';
import { getFigureData } from '../lib/api.js';
import '../pages/Gallery.css';

// One gallery card: static text thumb from D1, lazily swapped for the playing
// figure on hover/focus, click opens the info dialog. Used by the public
// /gallery grid and the admin library (which passes `fetchData` with the
// bearer header and a `badges` slot for status/hero markers).

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
  const [full, setFull] = useState(null); // full figure.json once hovered
  const [hovering, setHovering] = useState(false);

  const play = () => {
    setHovering(true);
    if (!full) {
      // getFigureData is promise-cached in api.js — repeat hovers are free.
      const fetcher = fetchData || ((id) => getFigureData(`/api/figures/${id}/data`));
      fetcher(item.id)
        .then(setFull)
        .catch(() => {});
    }
  };

  return (
    <button
      type="button"
      className="gallery-card"
      onPointerEnter={play}
      onPointerLeave={() => setHovering(false)}
      onFocus={play}
      onBlur={() => setHovering(false)}
      onClick={() => onSelect(item)}
    >
      <div
        className="gallery-card__screen"
        style={item.style?.background ? { background: item.style.background } : undefined}
      >
        <AsciiPlayer data={hovering && full ? full : thumbData(item)} fit loop />
      </div>
      {badges && <div className="gallery-card__badges">{badges}</div>}
      <div className="gallery-card__caption">
        <span className="gallery-card__name">{item.name}</span>
        <span className="gallery-card__author">by {item.author}</span>
      </div>
    </button>
  );
}
