import { useEffect, useRef } from "react";
import gsap from "gsap";
import Lenis from "lenis";
import { prefersReducedMotion } from "../lib/utils.js";

// Lenis smooth scroll scoped to the About overlay's inner scroller (tuning
// mirrors the negative-films culture page). Created only while the overlay is
// settled open and destroyed the moment a close begins, so useDissolveReveal's
// scrollTop writes are never fought by an in-flight Lenis animation. Lenis in
// wrapper mode drives the wrapper's native scrollTop, so every existing
// scrollTop read keeps working unchanged.
export function useLenisScroll({ wrapperRef, contentRef, active }) {
  const lenisRef = useRef(null);

  useEffect(() => {
    if (!active || prefersReducedMotion()) return;
    const wrapper = wrapperRef.current;
    const content = contentRef.current;
    if (!wrapper || !content) return;

    const isMobile = window.innerWidth <= 1000;
    const lenis = new Lenis({
      wrapper,
      content,
      duration: isMobile ? 0.8 : 1.2,
      lerp: isMobile ? 0.075 : 0.1,
      smoothWheel: true,
      syncTouch: true,
      touchMultiplier: isMobile ? 1.5 : 2,
    });
    const raf = (time) => lenis.raf(time * 1000);
    gsap.ticker.add(raf);
    gsap.ticker.lagSmoothing(0);
    lenisRef.current = lenis;

    return () => {
      gsap.ticker.remove(raf);
      // Restore GSAP's default lag smoothing for the hero's own tweens.
      gsap.ticker.lagSmoothing(500, 33);
      lenis.destroy();
      lenisRef.current = null;
    };
  }, [active, wrapperRef, contentRef]);

  return lenisRef;
}
