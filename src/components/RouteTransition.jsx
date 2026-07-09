import { useEffect, useRef, useState } from "react";
import { useLocation, useOutlet } from "react-router-dom";
import { getPageTransitions } from "../lib/pageTransitions.js";

// Renders the routed page inside a fixed .page-layer, freezing the currently
// displayed outlet so a leave animation can play on the OLD page before the
// swap (react-router itself re-renders the outlet synchronously on navigation).
// Today the registered transitions are no-ops, so the swap is instant; the
// choreography below only starts to matter once real tweens are registered in
// pageTransitions.js.
//
// Frozen-outlet caveat: during a leave tween the outgoing page briefly renders
// under the NEW location. None of the current pages read useLocation, so this
// is harmless — revisit if a future page does.
//
// onCoverChange(covered) tells HeroLayout when the hero is actually hidden:
// - navigating to "/": uncover immediately, so the hero is live behind the
//   outgoing page's exit animation;
// - navigating away from "/": cover only after enter() resolves, so the hero
//   stays live under the incoming animation.
export function RouteTransition({ onCoverChange }) {
  const location = useLocation();
  const outlet = useOutlet();
  const [shown, setShown] = useState(() => ({
    key: location.pathname,
    node: outlet,
  }));
  const layerRef = useRef(null);
  // Live outlet for the effect to pick up post-swap without re-triggering it.
  const outletRef = useRef(outlet);
  outletRef.current = outlet;
  const onCoverChangeRef = useRef(onCoverChange);
  onCoverChangeRef.current = onCoverChange;
  // Monotonic id: an in-flight transition abandons itself when a newer one starts.
  const runIdRef = useRef(0);

  useEffect(() => {
    const to = location.pathname;
    runIdRef.current += 1;
    const runId = runIdRef.current;
    const el = layerRef.current;
    const { enter, leave } = getPageTransitions();

    let cancelled = false;
    const stale = () => cancelled || runIdRef.current !== runId;

    (async () => {
      // setShown below reads the previous key via the updater, but the leave
      // context needs it now — capture from the layer's dataset (kept in render).
      const from = el?.dataset.path ?? to;
      if (from === to) {
        // Initial mount / same-path re-render: just sync the node.
        setShown({ key: to, node: outletRef.current });
        onCoverChangeRef.current?.(to !== "/");
        return;
      }
      if (to === "/") onCoverChangeRef.current?.(false);
      await leave(el, { from, to });
      if (stale()) return;
      setShown({ key: to, node: outletRef.current });
      await enter(el, { from, to });
      if (stale()) return;
      if (to !== "/") onCoverChangeRef.current?.(true);
    })();

    return () => {
      // Interrupt = jump-cut: the newer effect run takes over the layer.
      cancelled = true;
    };
  }, [location.pathname]);

  return (
    <div className="page-layer" ref={layerRef} data-path={shown.key}>
      {shown.node}
    </div>
  );
}
