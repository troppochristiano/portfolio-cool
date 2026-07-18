import { useCallback, useEffect, useRef } from "react";
import gsap from "gsap";
import { prefersReducedMotion } from "../lib/utils.js";

/**
 * useDissolveReveal — CodeGrid KVS "dissolve band" effect, driving a FULL-PAGE
 * OVERLAY:
 *   - open  : band sweeps bottom -> top; overlay content builds in its wake while
 *             the un-built area stays transparent (the page behind shows through).
 *   - close : band sweeps top -> bottom; content recedes, revealing the page behind.
 *
 * Triggers (share one GSAP tween):
 *   - playOpen() / playClose() — instant sweep (button / ✕).
 *   - wheel scrub — band tracks the wheel; past `threshold` it auto-completes from
 *     where the scrub left off, otherwise snaps back. Once open, the overlay scrolls
 *     normally and a pull-up at the very top scrubs the close (portfolio-style).
 *
 * Rendered on a single <canvas> sized to the FIXED full-viewport overlay (so an
 * inner scrollbar never shrinks it and leaves an uncovered strip). Only the few
 * hundred visible cells are painted per frame. Per-cell math is identical to the
 * original effect.
 *
 * @param {object} opts
 * @param {React.RefObject<HTMLElement>} opts.overlayRef  Fixed full-viewport overlay.
 * @param {React.RefObject<HTMLElement>} opts.scrollRef   Inner scroll container.
 * @param {React.RefObject<HTMLCanvasElement>} opts.canvasRef  Band canvas.
 * @param {React.RefObject<HTMLElement>} opts.contentRef  Wrapper whose clip-path is swept.
 * @param {number} [opts.duration=1.2]
 * @param {number} [opts.threshold=0.4]
 * @param {number} [opts.openDistance=600]  Wheel px for a full 0->1 scrub.
 * @param {string} [opts.color="#ff6426"]
 * @param {(state:"open"|"closed")=>void} [opts.onSettle]
 */
export function useDissolveReveal({
  overlayRef,
  scrollRef,
  canvasRef,
  contentRef,
  duration = 1.2,
  threshold = 0.4,
  openDistance = 600,
  color = "#ff6426",
  onSettle,
  enableWheel = true, // false => no scrub/scroll gestures (e.g. one-shot load reveal)
  initialState = "closed", // "open" => start with the cover shown (load reveal)
  openOnTouch = true, // false => touch never open-scrubs (protect a touch-panning page behind)
  openTouchZone, // () => number|null : min touchstart clientY to allow a touch open-scrub
  //               (gesture must START on/below this Y). Overrides openOnTouch when provided.
  canOpen = true, // false => ignore open-scrub gestures (e.g. while the page behind is loading)
}) {
  // --- tunables (verbatim from the original effect) ---
  const CELL_SIZE = 16;
  const SPREAD_ABOVE = 0.25;
  const SPREAD_BELOW = 0.25;
  const SCATTER_INTENSITY = 0.15;
  const SOLID_CORE_RADIUS = 0.025;
  const MIN_SCATTER_AT_CENTER = 0.3;
  const VISIBILITY_THRESHOLD = 0.65;
  const CHARACTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789#@$%&*+=?!<>{}[]";
  const TRAVEL = 1 + SPREAD_ABOVE + SPREAD_BELOW; // 1.5 (-0.25 .. 1.25)
  const GESTURE_GAP = 200; // ms idle => a fresh wheel gesture
  const CLOSE_DEADZONE = 140; // px of pull absorbed when a gesture ARRIVES at the top mid-flight

  // grid data (kept off React render)
  const gridRef = useRef({
    cols: 0,
    rows: 0,
    cssW: 0,
    cssH: 0,
    dpr: 1,
    normalizedY: null,
    visRandom: null,
    scatterOffset: null,
    chars: null,
    fontSize: 11,
  });

  const colorRef = useRef(color);
  const openTouchZoneRef = useRef(openTouchZone); // kept current; read in listeners (stable deps)
  const canOpenRef = useRef(canOpen); // kept current; gate open-scrub while loading
  const tweenRef = useRef(null);

  // interaction state
  const stateRef = useRef("closed"); // "closed" | "open"
  const progressRef = useRef(0); // 0..1 of the current gesture/anim
  const dirRef = useRef("open"); // "open" | "close" — which transition progress describes
  const animatingRef = useRef(false); // true while an auto-complete/snap tween runs
  const wheelAccumRef = useRef(0);
  const wheelTimerRef = useRef(null);
  const lastWheelRef = useRef(0);
  const armedRef = useRef(false); // close-pull armed (gesture began — or arrived — at the top)
  const closeSlackRef = useRef(0); // px of CLOSE_DEADZONE left to absorb before a late-armed pull scrubs
  const scrubbingRef = useRef(false); // a scrub is actively driving this gesture
  const lastTouchYRef = useRef(0);
  const touchOpenAllowedRef = useRef(true); // this touch gesture began inside the open-zone

  const hashFromPosition = (row, col, seed) => {
    const raw = Math.sin(row * seed + col * (seed * 2.45)) * 43758.5453;
    return raw - Math.floor(raw);
  };

  // ---- grid build / canvas sizing (from the FIXED overlay = full viewport) ----
  const buildGrid = useCallback(() => {
    const canvas = canvasRef.current;
    const overlay = overlayRef.current;
    if (!canvas || !overlay) return;

    const w = overlay.clientWidth;
    const h = overlay.clientHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;

    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const cols = Math.ceil(w / CELL_SIZE);
    const rows = Math.ceil(h / CELL_SIZE);
    const count = cols * rows;
    const fontSize = Math.round(CELL_SIZE * 0.7);

    const normalizedY = new Float32Array(count);
    const visRandom = new Float32Array(count);
    const scatterOffset = new Float32Array(count);
    const chars = new Array(count);

    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const i = row * cols + col;
        normalizedY[i] = (row + 0.5) / rows;
        visRandom[i] = hashFromPosition(row, col, 127.1);
        scatterOffset[i] =
          (hashFromPosition(row, col, 269.3) - 0.5) * SCATTER_INTENSITY;
        chars[i] = CHARACTERS[Math.floor(Math.random() * CHARACTERS.length)];
      }
    }

    gridRef.current = {
      cols,
      rows,
      cssW: w,
      cssH: h,
      dpr,
      normalizedY,
      visRandom,
      scatterOffset,
      chars,
      fontSize,
    };
  }, [canvasRef, overlayRef]);

  const clearCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }, [canvasRef]);

  // ---- per-frame draw ----
  const drawBand = useCallback(
    (bandCenterY) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const g = gridRef.current;
      if (!g.normalizedY) return;

      const { cols, rows, cssW, cssH, dpr, normalizedY, visRandom, scatterOffset, chars, fontSize } =
        g;
      const ctx = canvas.getContext("2d");
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, cssW, cssH);
      ctx.font = `${fontSize}px "DM Mono", monospace`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";

      const fill = colorRef.current;
      const count = cols * rows;

      for (let i = 0; i < count; i++) {
        const ny = normalizedY[i];
        const rawDistance = Math.abs(ny - bandCenterY);

        const scatterStrength = gsap.utils.clamp(
          MIN_SCATTER_AT_CENTER,
          1,
          rawDistance / SOLID_CORE_RADIUS
        );

        const scattered = ny - bandCenterY + scatterOffset[i] * scatterStrength;

        const normalizedDistance =
          scattered >= 0
            ? scattered / SPREAD_BELOW
            : Math.abs(scattered) / SPREAD_ABOVE;

        if (normalizedDistance >= 1) continue;

        const density = (1 - normalizedDistance) * (1 - normalizedDistance);
        if (density <= visRandom[i] * VISIBILITY_THRESHOLD) continue;

        const col = i % cols;
        const row = (i - col) / cols;
        const x = col * CELL_SIZE;
        const y = row * CELL_SIZE;

        ctx.fillStyle = fill;
        ctx.fillRect(x, y, CELL_SIZE, CELL_SIZE);
        ctx.fillStyle = "#fff";
        ctx.fillText(chars[i], x + CELL_SIZE / 2, y + CELL_SIZE / 2 + 0.5);
      }
    },
    [canvasRef]
  );

  // ---- content clip from band position ----
  // Expressed in viewport px (not %) so it stays correct even when the content
  // is taller than the viewport (scrollable). During a transition scrollTop is 0,
  // so the element top aligns with the viewport top. Visible region = band line
  // down to the content's bottom.
  const applyClip = useCallback(
    (bandCenterY) => {
      const content = contentRef.current;
      if (!content) return;
      const vh = gridRef.current.cssH || window.innerHeight;
      const top = gsap.utils.clamp(0, vh, bandCenterY * vh);
      content.style.clipPath = `polygon(0 ${top}px, 100% ${top}px, 100% 100%, 0 100%)`;
    },
    [contentRef]
  );

  // open  : p 0->1 => bandY 1.25 -> -0.25 (builds from bottom)
  // close : p 0->1 => bandY -0.25 -> 1.25 (recedes from top)
  const renderProgress = useCallback(
    (p, dir) => {
      const bandY =
        dir === "open"
          ? 1 + SPREAD_BELOW - p * TRAVEL
          : -SPREAD_ABOVE + p * TRAVEL;
      applyClip(bandY);
      if (p <= 0.0001 || p >= 0.9999) clearCanvas();
      else drawBand(bandY);
    },
    [applyClip, drawBand, clearCanvas]
  );

  const showOverlay = useCallback(
    (interactive) => {
      const overlay = overlayRef.current;
      if (!overlay) return;
      overlay.style.visibility = "visible";
      overlay.style.pointerEvents = interactive ? "auto" : "none";
      // "is-revealed" is present only when fully settled-open (interactive), so chrome
      // like the close button can hide during the animation + scrubbing.
      overlay.classList.toggle("is-revealed", !!interactive);
    },
    [overlayRef]
  );

  const settleOpen = useCallback(() => {
    stateRef.current = "open";
    progressRef.current = 0;
    dirRef.current = "open";
    animatingRef.current = false;
    scrubbingRef.current = false;
    wheelAccumRef.current = 0;
    closeSlackRef.current = 0;
    const content = contentRef.current;
    if (content) content.style.clipPath = "none";
    const scroll = scrollRef?.current;
    if (scroll) {
      scroll.style.overflowY = "auto"; // only scroll once fully built
      scroll.style.background = "#000"; // opaque when open => overscroll bounce shows black, not the hero
    }
    clearCanvas();
    showOverlay(true);
    onSettle?.("open");
  }, [contentRef, scrollRef, clearCanvas, showOverlay, onSettle]);

  const settleClosed = useCallback(() => {
    stateRef.current = "closed";
    progressRef.current = 0;
    dirRef.current = "open";
    animatingRef.current = false;
    scrubbingRef.current = false;
    wheelAccumRef.current = 0;
    closeSlackRef.current = 0;
    const overlay = overlayRef.current;
    if (overlay) {
      overlay.style.visibility = "hidden";
      overlay.style.pointerEvents = "none";
      overlay.classList.remove("is-revealed");
    }
    const scroll = scrollRef?.current;
    if (scroll) {
      scroll.style.overflowY = "hidden"; // no scrollbar while closed / mid-transition
      scroll.style.background = "transparent";
      scroll.scrollTop = 0;
    }
    clearCanvas();
    onSettle?.("closed");
  }, [overlayRef, scrollRef, clearCanvas, onSettle]);

  // ---- tween a gesture's progress to a target ----
  const animateTo = useCallback(
    (dir, fromP, toP, onDone) => {
      if (tweenRef.current) tweenRef.current.kill();
      animatingRef.current = true;
      const state = { p: fromP };
      const dist = Math.abs(toP - fromP);
      tweenRef.current = gsap.to(state, {
        p: toP,
        duration: Math.max(0.12, duration * dist),
        ease: "none",
        onUpdate: () => {
          progressRef.current = state.p;
          renderProgress(state.p, dir);
        },
        onComplete: () => {
          animatingRef.current = false;
          onDone?.();
        },
      });
    },
    [duration, renderProgress]
  );

  const reduceMotion = prefersReducedMotion;

  // ---- button path: full instant sweeps ----
  const playOpen = useCallback(() => {
    if (tweenRef.current) tweenRef.current.kill();
    buildGrid();
    showOverlay(false);
    dirRef.current = "open";
    if (reduceMotion()) return settleOpen();
    animateTo("open", 0, 1, settleOpen);
  }, [animateTo, buildGrid, settleOpen, showOverlay]);

  const playClose = useCallback(() => {
    if (tweenRef.current) tweenRef.current.kill();
    const scroll = scrollRef?.current;
    if (scroll) {
      scroll.scrollTop = 0;
      scroll.style.background = "transparent"; // dissolve reveals the hero behind
    }
    showOverlay(false);
    dirRef.current = "close";
    if (reduceMotion()) return settleClosed();
    animateTo("close", 0, 1, settleClosed);
  }, [animateTo, scrollRef, settleClosed, showOverlay]);

  // ---- scrub: drive progress directly from the wheel ----
  const setProgress = useCallback(
    (p, dir) => {
      if (tweenRef.current) tweenRef.current.kill();
      animatingRef.current = false;
      const clamped = gsap.utils.clamp(0, 1, p);
      progressRef.current = clamped;
      // false for BOTH directions: drops `is-revealed` so the close button hides during a
      // close scrub too (not just open); also makes the overlay visible for an open scrub.
      showOverlay(false);
      const scroll = scrollRef?.current;
      if (scroll) {
        scroll.style.overflowY = "hidden"; // no scrollbar mid-scrub
        scroll.style.background = "transparent"; // let the dissolve reveal the hero
      }
      renderProgress(clamped, dir);
    },
    [renderProgress, showOverlay, scrollRef]
  );

  // resolve on wheel-release: complete past threshold, else snap back
  const resolveGesture = useCallback(() => {
    const dir = dirRef.current;
    const p = progressRef.current;
    wheelAccumRef.current = 0;
    if (p <= 0.0001) return dir === "open" ? settleClosed() : settleOpen();
    if (p >= 0.9999) return dir === "open" ? settleOpen() : settleClosed();
    if (p >= threshold) {
      animateTo(dir, p, 1, dir === "open" ? settleOpen : settleClosed);
    } else {
      animateTo(dir, p, 0, dir === "open" ? settleClosed : settleOpen);
    }
  }, [animateTo, settleOpen, settleClosed, threshold]);

  const scheduleRelease = useCallback(() => {
    clearTimeout(wheelTimerRef.current);
    wheelTimerRef.current = setTimeout(resolveGesture, 140);
  }, [resolveGesture]);

  // ---- shared gesture core: maps a signed delta (wheel or touch) to the scrub ----
  // deltaY > 0 == "scroll down" intent (wheel down / finger up).
  const handleDelta = useCallback(
    (deltaY, e, isTouch = false) => {
      if (animatingRef.current) return; // let auto-complete/snap finish
      const now = e.timeStamp;
      const freshGesture = now - lastWheelRef.current > GESTURE_GAP;
      lastWheelRef.current = now;

      if (stateRef.current === "closed") {
        // open scrub: only downward intent grows it
        if (!canOpenRef.current) return; // open locked (e.g. while the page behind is loading)
        if (isTouch) {
          // openTouchZone (if given) gates by where the gesture STARTED; else openOnTouch.
          if (openTouchZoneRef.current) {
            if (!touchOpenAllowedRef.current) return; // started above the zone => let page pan
          } else if (!openOnTouch) {
            return;
          }
        }
        if (deltaY <= 0 && wheelAccumRef.current <= 0) return;
        if (freshGesture && wheelAccumRef.current <= 0) buildGrid();
        dirRef.current = "open";
        scrubbingRef.current = true;
        if (e.cancelable) e.preventDefault();
        wheelAccumRef.current = gsap.utils.clamp(
          0,
          openDistance,
          wheelAccumRef.current + deltaY
        );
        const p = wheelAccumRef.current / openDistance;
        setProgress(p, "open");
        if (p >= threshold) {
          clearTimeout(wheelTimerRef.current);
          wheelAccumRef.current = 0;
          animateTo("open", p, 1, settleOpen);
          return;
        }
        scheduleRelease();
        return;
      }

      // ---- open: native scroll + pull-to-close ----
      const el = scrollRef?.current;
      // < 1 (not <= 0): on scaled displays (Windows 125% etc.) a scrolled-back
      // container can rest at a fractional ~0.5px and never report exactly 0.
      const atTop = el ? el.scrollTop < 1 : true;
      if (freshGesture) {
        armedRef.current = atTop; // a gesture born at the top closes with no dead-zone
        closeSlackRef.current = 0;
        if (dirRef.current === "close" && wheelAccumRef.current > 0) {
          wheelAccumRef.current = 0;
        }
      } else if (!armedRef.current && atTop && deltaY < 0) {
        // The gesture ARRIVED at the top mid-flight (e.g. a header shortcut
        // deep-scrolled the overlay and the user is wheeling back up). Arm
        // late, behind a dead-zone that soaks up momentum spill — so speed-
        // scrolling through content can't rip straight into the close, but
        // the same continuous pull does close once the intent is clear.
        armedRef.current = true;
        closeSlackRef.current = CLOSE_DEADZONE;
      }

      if (armedRef.current && atTop && deltaY < 0) {
        let pull = deltaY;
        if (closeSlackRef.current > 0) {
          closeSlackRef.current += pull; // pull < 0 eats into the slack
          if (closeSlackRef.current >= 0) return; // still absorbing — no scrub yet
          pull = closeSlackRef.current; // negative overshoot feeds the scrub
          closeSlackRef.current = 0;
        }
        // pull-to-close scrub (wheel up / finger down at the top)
        dirRef.current = "close";
        scrubbingRef.current = true;
        if (e.cancelable) e.preventDefault();
        wheelAccumRef.current = gsap.utils.clamp(
          0,
          openDistance,
          wheelAccumRef.current + -pull
        );
        const p = wheelAccumRef.current / openDistance;
        setProgress(p, "close");
        if (p >= threshold) {
          clearTimeout(wheelTimerRef.current);
          wheelAccumRef.current = 0;
          animateTo("close", p, 1, settleClosed);
          return;
        }
        scheduleRelease();
      } else if (deltaY > 0 || !atTop) {
        // downward intent or scrolled away from top cancels a pending close pull
        if (dirRef.current === "close" && progressRef.current > 0) {
          clearTimeout(wheelTimerRef.current);
          wheelAccumRef.current = 0;
          animateTo("close", progressRef.current, 0, settleOpen);
        }
        // otherwise let the container scroll natively (no preventDefault)
      }
    },
    [
      animateTo,
      buildGrid,
      openDistance,
      scheduleRelease,
      scrollRef,
      setProgress,
      settleOpen,
      settleClosed,
      threshold,
      openOnTouch,
    ]
  );

  // ---- wheel + touch listeners ----
  useEffect(() => {
    if (!enableWheel) return;

    const onWheel = (e) => handleDelta(e.deltaY, e);
    const onTouchStart = (e) => {
      const startY = e.touches[0].clientY;
      lastTouchYRef.current = startY;
      lastWheelRef.current = 0; // next touchmove starts a fresh gesture
      // Decide once, at gesture start, whether a touch open-scrub is allowed (zone gate).
      const zoneFn = openTouchZoneRef.current;
      if (stateRef.current === "closed" && zoneFn) {
        const zoneTop = zoneFn();
        touchOpenAllowedRef.current = zoneTop == null ? true : startY >= zoneTop;
      } else {
        touchOpenAllowedRef.current = true;
      }
    };
    const onTouchMove = (e) => {
      if (e.touches.length !== 1) return;
      const y = e.touches[0].clientY;
      const dy = lastTouchYRef.current - y; // finger up => positive (scroll-down intent)
      lastTouchYRef.current = y;
      handleDelta(dy, e, true);
    };
    const onTouchEnd = () => {
      if (scrubbingRef.current && !animatingRef.current) {
        clearTimeout(wheelTimerRef.current);
        resolveGesture(); // commit/snap immediately on lift
      }
    };

    window.addEventListener("wheel", onWheel, { passive: false });
    window.addEventListener("touchstart", onTouchStart, { passive: true });
    window.addEventListener("touchmove", onTouchMove, { passive: false });
    window.addEventListener("touchend", onTouchEnd, { passive: true });
    return () => {
      window.removeEventListener("wheel", onWheel);
      window.removeEventListener("touchstart", onTouchStart);
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("touchend", onTouchEnd);
      clearTimeout(wheelTimerRef.current);
    };
  }, [enableWheel, handleDelta, resolveGesture]);

  // ---- mount: build grid, set initial state; rebuild on resize ----
  useEffect(() => {
    buildGrid();
    if (initialState === "open") {
      // start with the cover fully shown (e.g. load reveal), no animation
      stateRef.current = "open";
      const content = contentRef.current;
      if (content) content.style.clipPath = "none";
      clearCanvas();
      showOverlay(true);
    } else {
      settleClosed();
    }

    let resizeTimer;
    const onResize = () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        buildGrid();
        if (stateRef.current === "open") {
          const content = contentRef.current;
          if (content) content.style.clipPath = "none";
        }
      }, 150);
    };
    window.addEventListener("resize", onResize);

    return () => {
      if (tweenRef.current) tweenRef.current.kill();
      window.removeEventListener("resize", onResize);
      clearTimeout(resizeTimer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    colorRef.current = color;
  }, [color]);

  useEffect(() => {
    openTouchZoneRef.current = openTouchZone;
  }, [openTouchZone]);

  useEffect(() => {
    canOpenRef.current = canOpen;
  }, [canOpen]);

  return { playOpen, playClose, getState: () => stateRef.current };
}
