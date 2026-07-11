import { useEffect, useRef, useState } from "react";
import { useLocation, useOutlet } from "react-router-dom";
import { getPageTransitions } from "../lib/pageTransitions.js";
import { PageActiveProvider } from "../lib/pageActiveContext.js";

// Paths whose page stays mounted (parked in a hidden .page-layer) after
// navigating away, so back/forward — browser arrows or a phone swipe — shows
// them instantly with component state AND scroll position intact instead of
// refetching from scratch. /create is deliberately absent: its media buffers
// (uploaded video, baked frames) are heavy, and a stale converter session is
// better reset than kept in memory for the whole visit.
const KEEP_ALIVE = new Set(["/gallery"]);

// Renders the routed page inside a fixed .page-layer, freezing the currently
// displayed outlet so a leave animation can play on the OLD page before the
// swap (react-router itself re-renders the outlet synchronously on navigation).
// Kept-alive pages get their own persistent layer: inactive ones are parked
// with visibility:hidden + inert (the same trick HeroLayout plays on the hero)
// and wrapped in PageActiveProvider so they can pause their background work.
//
// Frozen-outlet caveat: during a leave tween — and for the whole parked life
// of a kept-alive page — the page renders under a location that isn't its own.
// None of the current pages read useLocation, so this is harmless — revisit if
// a future page does.
//
// onCoverChange(covered) tells HeroLayout when the hero is actually hidden:
// - navigating to "/": uncover immediately, so the hero is live behind the
//   outgoing page's exit animation;
// - navigating away from "/": cover only after enter() resolves, so the hero
//   stays live under the incoming animation.
export function RouteTransition({ onCoverChange }) {
  const location = useLocation();
  const outlet = useOutlet();
  // All mounted layers: the active page plus any parked keep-alive pages.
  const [layers, setLayers] = useState(() => [
    { key: location.pathname, node: outlet },
  ]);
  const [activeKey, setActiveKey] = useState(location.pathname);
  // The path currently shown — the `from` of the next transition. A ref (not
  // the state) so the async run below reads it without re-triggering.
  const shownKeyRef = useRef(location.pathname);
  // One DOM node per layer for the enter/leave contract.
  const layerEls = useRef(new Map());
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
    const { enter, leave, cancel } = getPageTransitions();

    let cancelled = false;
    const stale = () => cancelled || runIdRef.current !== runId;
    const elFor = (key) => layerEls.current.get(key) ?? null;

    // Make `to` the active layer: refresh (or create) its node from the live
    // outlet — React reconciles into the already-mounted subtree of a parked
    // layer, so its state survives — and drop every other layer that isn't
    // keep-alive (matching the old unmount-on-swap behavior).
    const swap = () => {
      shownKeyRef.current = to;
      setLayers((prev) => {
        const next = [];
        let found = false;
        for (const layer of prev) {
          if (layer.key === to) {
            next.push({ key: to, node: outletRef.current });
            found = true;
          } else if (KEEP_ALIVE.has(layer.key)) {
            next.push(layer);
          }
        }
        if (!found) next.push({ key: to, node: outletRef.current });
        return next;
      });
      setActiveKey(to);
    };

    (async () => {
      const from = shownKeyRef.current;
      if (from === to) {
        // Initial mount / same-path re-render — also the landing spot when a
        // navigation snaps back to the shown page mid-leave (back button):
        // no leave/enter will run, so tell the transition impl to drop any
        // in-flight cover instead of leaving the screen blacked out.
        cancel();
        swap();
        onCoverChangeRef.current?.(to !== "/");
        return;
      }
      if (to === "/") onCoverChangeRef.current?.(false);
      await leave(elFor(from), { from, to });
      if (stale()) return;
      swap();
      await enter(elFor(to), { from, to });
      if (stale()) return;
      if (to !== "/") onCoverChangeRef.current?.(true);
    })();

    return () => {
      // Interrupt = jump-cut: the newer effect run takes over the layer.
      cancelled = true;
    };
  }, [location.pathname]);

  return (
    <>
      {layers.map(({ key, node }) => {
        const active = key === activeKey;
        return (
          <div
            key={key}
            ref={(el) => {
              if (el) layerEls.current.set(key, el);
              else layerEls.current.delete(key);
            }}
            className={`page-layer${active ? "" : " is-parked"}`}
            // React 18: pass "" not a boolean (same note as HeroLayout).
            inert={active ? undefined : ""}
            data-path={key}
          >
            <PageActiveProvider value={active}>{node}</PageActiveProvider>
          </div>
        );
      })}
    </>
  );
}
