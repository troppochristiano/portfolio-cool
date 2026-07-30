import { useEffect, useRef, useState } from "react";
import { usePixelDecode } from "../hooks/usePixelDecode.js";

// In-flow project image for an open Works panel. Cycles through the entry's
// images on a timer and on click, replaying the same pixel decode as the
// cursor hover preview on every change.
//
// The accordion keeps panels mounted while collapsed (the 0fr trick), so
// everything gates on `active` (row open AND overlay open), never on mount:
// closing the row/overlay stops the timer and decode, reopening replays the
// decode on the current frame. Per-instance state lets several open rows
// cycle independently.
export function WorksPanelImage({ images, label, active, cycleMs = 4000 }) {
  const [index, setIndex] = useState(0);
  const boxRef = useRef(null);
  const canvasRef = useRef(null);
  const cycling = images.length > 1;

  usePixelDecode({
    canvasRef,
    boxRef,
    src: images[index],
    // Same-src safety: replay is keyed to the frame, not the URL.
    revealKey: index,
    enabled: active,
    watchResize: true,
  });

  // One interval while active; `index` in the deps means a click-advance
  // tears it down and starts a fresh one, so manual advances reset the clock.
  useEffect(() => {
    if (!active || !cycling) return;
    const timer = window.setInterval(
      () => setIndex((i) => (i + 1) % images.length),
      cycleMs,
    );
    return () => window.clearInterval(timer);
  }, [active, cycling, index, images.length, cycleMs]);

  if (!images.length) return null;

  const advance = () => setIndex((i) => (i + 1) % images.length);

  return (
    <button
      type="button"
      ref={boxRef}
      className={`works-panel__media${cycling ? " is-cycling" : ""}`}
      onClick={cycling ? advance : undefined}
      aria-label={cycling ? `Next image — ${label}` : label}
    >
      <canvas ref={canvasRef} className="works-panel__canvas" aria-hidden="true" />
      {cycling && (
        <span className="works-panel__count" aria-hidden="true">
          {String(index + 1).padStart(2, "0")} /{" "}
          {String(images.length).padStart(2, "0")}
        </span>
      )}
    </button>
  );
}
