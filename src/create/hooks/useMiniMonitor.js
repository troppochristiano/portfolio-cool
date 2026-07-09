import { useEffect, useRef, useState } from "react";

/**
 * Mobile floating mini-monitor: appears when the main monitor scrolls out of
 * view, drags anywhere, taps back to the monitor, and can be dismissed (it
 * re-arms when the monitor scrolls back into view).
 */
export function useMiniMonitor({ pageRef, monitorRef, hasSource }) {
  const [miniVisible, setMiniVisible] = useState(false); // shown when the monitor scrolls off
  const [miniDismissed, setMiniDismissed] = useState(false); // user closed it
  const miniElRef = useRef(null); // the floating mini container (for drag)
  const miniPosRef = useRef(null); // dragged position {left, top} or null (default corner)
  const miniDragRef = useRef(null); // in-flight drag state
  const draggedRef = useRef(false); // did the last pointer sequence move (drag vs tap)

  // ── reveal once the main monitor scrolls off ──────────────────
  // A scroll-position check (not IntersectionObserver, which misses fast/edge
  // transitions). The monitor is compared to the VIEWPORT — correct whether the
  // page scrolls inside .create-page or the document body scrolls. Listeners are
  // attached to the scroll container itself, window (capture, for either model),
  // and visualViewport (mobile address-bar show/hide), so it fires on real
  // devices regardless of which element owns the scroll.
  useEffect(() => {
    const page = pageRef.current;
    const mon = monitorRef.current;
    if (!mon || !hasSource) {
      setMiniVisible(false);
      return;
    }
    const check = () => {
      const mr = mon.getBoundingClientRect();
      const vh = window.innerHeight || document.documentElement.clientHeight;
      const off = mr.bottom <= 4 || mr.top >= vh - 4; // monitor fully above / below the screen
      setMiniVisible((prev) => (prev === off ? prev : off)); // no re-render unless it changed
      if (!off) setMiniDismissed((d) => (d ? false : d)); // re-arm when the monitor is back
    };
    check();
    page?.addEventListener("scroll", check, { passive: true });
    window.addEventListener("scroll", check, true);
    window.addEventListener("resize", check);
    const vv = window.visualViewport;
    vv?.addEventListener("scroll", check);
    vv?.addEventListener("resize", check);
    return () => {
      page?.removeEventListener("scroll", check);
      window.removeEventListener("scroll", check, true);
      window.removeEventListener("resize", check);
      vv?.removeEventListener("scroll", check);
      vv?.removeEventListener("resize", check);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasSource]);

  // ── drag (and tap-to-jump) ────────────────────────────────────
  // Position lives in a ref, mutated on the DOM directly during a drag so the
  // per-frame textContent writes and any parent re-render don't fight it; the
  // ref is re-applied to `style` on every render so the position sticks. The
  // jump-to-monitor uses onClick (reliable) guarded by a "did we drag" flag.
  const onMiniDown = (e) => {
    if (e.target.closest(".mini-close")) return; // the close button owns its click
    const el = miniElRef.current;
    const r = el.getBoundingClientRect();
    miniDragRef.current = {
      sx: e.clientX,
      sy: e.clientY,
      baseL: r.left,
      baseT: r.top,
    };
    draggedRef.current = false;
    try {
      el.setPointerCapture(e.pointerId);
    } catch {
      /* fine */
    }
  };
  const onMiniMove = (e) => {
    const d = miniDragRef.current;
    if (!d) return;
    const dx = e.clientX - d.sx,
      dy = e.clientY - d.sy;
    if (!draggedRef.current && Math.hypot(dx, dy) < 5) return; // ignore jitter → keep tap semantics
    draggedRef.current = true;
    const el = miniElRef.current;
    const left = Math.min(
      Math.max(6, d.baseL + dx),
      window.innerWidth - el.offsetWidth - 6,
    );
    const top = Math.min(
      Math.max(6, d.baseT + dy),
      window.innerHeight - el.offsetHeight - 6,
    );
    miniPosRef.current = { left, top };
    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
    el.style.right = "auto";
    el.style.bottom = "auto";
  };
  const onMiniUp = () => {
    miniDragRef.current = null;
  };
  const onMiniClick = () => {
    if (draggedRef.current) {
      draggedRef.current = false;
      return;
    } // it was a drag, not a tap
    monitorRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  const miniPosStyle = miniPosRef.current
    ? {
        left: miniPosRef.current.left,
        top: miniPosRef.current.top,
        right: "auto",
        bottom: "auto",
      }
    : null;

  return {
    miniVisible,
    miniDismissed,
    setMiniDismissed,
    miniElRef,
    miniPosStyle,
    onMiniDown,
    onMiniMove,
    onMiniUp,
    onMiniClick,
  };
}
