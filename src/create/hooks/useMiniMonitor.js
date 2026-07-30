import { useEffect, useRef, useState } from "react";
import { capturePointer, clamp } from "../../lib/utils.js";

/**
 * Mobile floating mini-monitor: appears when the main monitor scrolls out of
 * view, drags anywhere, taps back to the monitor, and can be dismissed (it
 * re-arms when the monitor scrolls back into view).
 */
// The viewport the floating mini belongs to. This is the ONE definition —
// the CSS no longer carries a matching media query, because two copies of a
// breakpoint that must agree is a bug waiting to happen and the loop needs
// the answer in JS anyway (it skips writing to a mini nobody can see).
const MINI_MQ = "(max-width: 860px)";

export function useMiniMonitor({ monitorRef, hasSource, drawFullscreen }) {
  const [miniVisible, setMiniVisible] = useState(false); // shown when the monitor scrolls off
  const [miniDismissed, setMiniDismissed] = useState(false); // user closed it
  const [narrow, setNarrow] = useState(
    () => window.matchMedia?.(MINI_MQ).matches ?? false,
  );
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
    // Coalesced behind one frame. `check` forces layout, and it was bound to
    // enough sources to run several times per scroll event — on mobile
    // visualViewport alone fires continuously through momentum scrolling and
    // the address bar showing/hiding, each read landing on a document the
    // 30fps <pre> write had just invalidated. Nothing here needs to resolve
    // faster than a frame.
    let scheduled = 0;
    const schedule = () => {
      if (!scheduled)
        scheduled = requestAnimationFrame(() => {
          scheduled = 0;
          check();
        });
    };
    check();
    // The window listener captures, so it already sees the page container's
    // (non-bubbling) scroll events — a separate listener on `page` only
    // doubled the work.
    window.addEventListener("scroll", schedule, { capture: true, passive: true });
    window.addEventListener("resize", schedule, { passive: true });
    const vv = window.visualViewport;
    vv?.addEventListener("scroll", schedule, { passive: true });
    vv?.addEventListener("resize", schedule, { passive: true });
    return () => {
      if (scheduled) cancelAnimationFrame(scheduled);
      window.removeEventListener("scroll", schedule, { capture: true });
      window.removeEventListener("resize", schedule);
      vv?.removeEventListener("scroll", schedule);
      vv?.removeEventListener("resize", schedule);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasSource]);

  // Viewport watch: the mini is a phone affordance, so above the breakpoint it
  // must not merely be invisible — it must not be written to at all.
  useEffect(() => {
    const mq = window.matchMedia?.(MINI_MQ);
    if (!mq) return;
    const onChange = (e) => setNarrow(e.matches);
    setNarrow(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

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
    capturePointer(e, el);
  };
  const onMiniMove = (e) => {
    const d = miniDragRef.current;
    if (!d) return;
    const dx = e.clientX - d.sx,
      dy = e.clientY - d.sy;
    if (!draggedRef.current && Math.hypot(dx, dy) < 5) return; // ignore jitter → keep tap semantics
    draggedRef.current = true;
    const el = miniElRef.current;
    const left = clamp(d.baseL + dx, 6, window.innerWidth - el.offsetWidth - 6);
    const top = clamp(d.baseT + dy, 6, window.innerHeight - el.offsetHeight - 6);
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

  // The single answer to "is the mini on screen right now" — CSS reads it as
  // .is-visible, and Create uses it to decide whether the mini's <pre> exists
  // at all. Fullscreen draw shows it on any viewport (it's the only preview
  // you have in there); otherwise it's phones only.
  const miniShown =
    hasSource &&
    !miniDismissed &&
    (drawFullscreen || (narrow && miniVisible));

  return {
    miniShown,
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
