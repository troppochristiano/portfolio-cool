import { createContext, useContext } from "react";

// Is the routed page layer this component lives in the ACTIVE (visible) one?
// RouteTransition parks kept-alive pages in visibility:hidden layers instead
// of unmounting them, and visibility does not stop IntersectionObservers or
// timers — so parked pages read this to switch off their own background work
// (the gallery's in-view playback and infinite-scroll fetches). Defaults to
// true: components rendered outside RouteTransition (admin routes) are always
// live.
const PageActiveContext = createContext(true);

export const PageActiveProvider = PageActiveContext.Provider;

export function usePageActive() {
  return useContext(PageActiveContext);
}
