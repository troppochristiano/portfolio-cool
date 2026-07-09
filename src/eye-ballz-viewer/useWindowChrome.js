import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { easeInOutCubic } from "../lib/utils.js";

// Smallest the floating window can be resized to (px), in `windowed` mode.
const MIN_WINDOW = 240;

/**
 * Window mode: drag / resize / restore / scroll-anchoring for the windowed
 * viewer. All geometry is driven imperatively on the container's style (never
 * via React state) so dragging/resizing don't trigger re-renders, and React
 * never clobbers the live size on an unrelated re-render. The mount effect's
 * ResizeObserver keeps the renderer/camera/ASCII in sync; eye-tracking reads
 * getBoundingClientRect live.
 */
export function useWindowChrome({ containerRef, windowed, width, height, anchored }) {
  // Windowed scroll-anchoring: true = fixed (stays on screen), false = absolute (scrolls
  // with the page). Mirrored into a ref so the imperative pointer handlers read the live
  // mode without stale closures.
  const [isAnchored, setIsAnchored] = useState(anchored);
  const anchoredRef = useRef(isAnchored);
  anchoredRef.current = isAnchored;

  const winTween = useRef(0);
  const cancelWinTween = () => {
    if (winTween.current) {
      cancelAnimationFrame(winTween.current);
      winTween.current = 0;
    }
  };

  // Place the window centered at its default size on mount (before first paint).
  useLayoutEffect(() => {
    if (!windowed) return;
    const el = containerRef.current;
    if (!el) return;
    el.style.width = `${width}px`;
    el.style.height = `${height}px`;
    writePos(
      Math.max(0, (window.innerWidth - width) / 2),
      Math.max(0, (window.innerHeight - height) / 2),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [windowed, width, height]);

  // Cancel any in-flight restore tween on unmount.
  useEffect(() => () => cancelWinTween(), []);

  // Write a viewport-space position to the element. When the window scrolls with the
  // page (absolute), add the scroll offset since absolute left/top are document-relative;
  // when anchored (fixed), viewport == style coords so no offset.
  const writePos = (vpLeft, vpTop) => {
    const el = containerRef.current;
    const ox = anchoredRef.current ? 0 : window.scrollX;
    const oy = anchoredRef.current ? 0 : window.scrollY;
    el.style.left = `${vpLeft + ox}px`;
    el.style.top = `${vpTop + oy}px`;
  };

  const applyRect = (l, t, w, hgt) => {
    const el = containerRef.current;
    writePos(l, t);
    el.style.width = `${w}px`;
    el.style.height = `${hgt}px`;
  };

  // Drag the window by the title bar (ignoring clicks on the title-bar buttons).
  const onTitlebarPointerDown = (e) => {
    if (
      e.target.closest(
        ".eye-ballz-restore, .eye-ballz-pin, .eye-ballz-debug-toggle",
      )
    )
      return;
    cancelWinTween();
    e.preventDefault();
    const el = containerRef.current;
    const rect = el.getBoundingClientRect();
    const offX = e.clientX - rect.left;
    const offY = e.clientY - rect.top;
    const w = rect.width;
    const bar = e.currentTarget;
    bar.setPointerCapture(e.pointerId);
    const move = (ev) => {
      // Keep at least part of the title bar reachable on-screen.
      const left = Math.min(
        Math.max(ev.clientX - offX, -(w - 80)),
        window.innerWidth - 80,
      );
      const top = Math.min(
        Math.max(ev.clientY - offY, 0),
        window.innerHeight - 32,
      );
      writePos(left, top);
    };
    const up = (ev) => {
      bar.releasePointerCapture(ev.pointerId);
      bar.removeEventListener("pointermove", move);
      bar.removeEventListener("pointerup", up);
    };
    bar.addEventListener("pointermove", move);
    bar.addEventListener("pointerup", up);
  };

  // Resize from an edge/corner handle. `dir` is any of n/s/e/w combined (e.g. "se").
  const onHandlePointerDown = (dir) => (e) => {
    cancelWinTween();
    e.preventDefault();
    e.stopPropagation();
    const el = containerRef.current;
    const start = el.getBoundingClientRect();
    const sx = e.clientX;
    const sy = e.clientY;
    const handle = e.currentTarget;
    handle.setPointerCapture(e.pointerId);
    const move = (ev) => {
      const dx = ev.clientX - sx;
      const dy = ev.clientY - sy;
      let left = start.left;
      let top = start.top;
      let w = start.width;
      let hgt = start.height;
      if (dir.includes("e")) w = start.width + dx;
      if (dir.includes("s")) hgt = start.height + dy;
      if (dir.includes("w")) {
        w = start.width - dx;
        left = start.left + dx;
      }
      if (dir.includes("n")) {
        hgt = start.height - dy;
        top = start.top + dy;
      }
      // Clamp to min size, keeping the anchored (opposite) edge fixed.
      if (w < MIN_WINDOW) {
        if (dir.includes("w")) left = start.right - MIN_WINDOW;
        w = MIN_WINDOW;
      }
      if (hgt < MIN_WINDOW) {
        if (dir.includes("n")) top = start.bottom - MIN_WINDOW;
        hgt = MIN_WINDOW;
      }
      applyRect(left, top, w, hgt);
    };
    const up = (ev) => {
      handle.releasePointerCapture(ev.pointerId);
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", up);
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", up);
  };

  // Smoothly animate the window back to its centered default size (rAF tween). The
  // ResizeObserver scales the 3D view along, frame-by-frame.
  const restoreWindow = () => {
    cancelWinTween();
    const r = containerRef.current.getBoundingClientRect();
    const from = { left: r.left, top: r.top, width: r.width, height: r.height };
    const target = {
      left: Math.max(0, (window.innerWidth - width) / 2),
      top: Math.max(0, (window.innerHeight - height) / 2),
      width,
      height,
    };
    const t0 = performance.now();
    const step = (now) => {
      const p = Math.min(1, (now - t0) / 450);
      const e = easeInOutCubic(p);
      applyRect(
        from.left + (target.left - from.left) * e,
        from.top + (target.top - from.top) * e,
        from.width + (target.width - from.width) * e,
        from.height + (target.height - from.height) * e,
      );
      winTween.current = p < 1 ? requestAnimationFrame(step) : 0;
    };
    winTween.current = requestAnimationFrame(step);
  };

  // Toggle between anchored-to-viewport (fixed) and scroll-with-page (absolute) without
  // a visual jump: snapshot the current viewport rect, flip the mode, then re-place using
  // the new mode's coordinate space.
  const toggleAnchor = () => {
    cancelWinTween();
    const r = containerRef.current.getBoundingClientRect();
    anchoredRef.current = !anchoredRef.current; // so writePos uses the new mode now
    setIsAnchored(anchoredRef.current); // re-render → swap CSS position
    writePos(r.left, r.top); // keep it visually in place
  };

  return {
    isAnchored,
    onTitlebarPointerDown,
    onHandlePointerDown,
    restoreWindow,
    toggleAnchor,
  };
}
