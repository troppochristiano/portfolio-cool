// Pluggable route-transition registry. RouteTransition calls leave() on the
// current page layer before swapping the outlet, then enter() on the new one.
// Both default to instant no-ops — the real GSAP tweens get registered here
// (via setPageTransitions) once the visual reference lands. Registered tweens
// own their reduced-motion handling (gsap.matchMedia).
//
// Contract: each receives the .page-layer element and { from, to } pathnames,
// and returns a Promise that resolves when the animation is done. They must be
// interrupt-safe — RouteTransition may abandon an in-flight transition when the
// route changes again (rapid back/forward), so kill your own tweens on re-entry.

let impl = {
  enter: (_el, _ctx) => Promise.resolve(),
  leave: (_el, _ctx) => Promise.resolve(),
};

export function setPageTransitions(next) {
  impl = { ...impl, ...next };
}

export function getPageTransitions() {
  return impl;
}
