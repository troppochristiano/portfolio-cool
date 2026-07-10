// Pluggable route-transition registry. RouteTransition calls leave() on the
// current page layer before swapping the outlet, then enter() on the new one.
// The registered impl (blockRevealTransition.js) supplies the real tweens and
// owns its reduced-motion handling.
//
// Contract: enter/leave receive the .page-layer element and { from, to }
// pathnames, and return a Promise that resolves when the animation is done.
// They must be interrupt-safe — RouteTransition may abandon an in-flight
// transition when the route changes again (rapid back/forward), so kill your
// own tweens on re-entry. cancel() fires when navigation snaps back to the
// path already shown (from === to, e.g. back-button mid-leave): no leave/enter
// will run, so the impl must kill any in-flight cover and clear itself.

let impl = {
  enter: (_el, _ctx) => Promise.resolve(),
  leave: (_el, _ctx) => Promise.resolve(),
  cancel: () => {},
};

export function setPageTransitions(next) {
  impl = { ...impl, ...next };
}

export function getPageTransitions() {
  return impl;
}
