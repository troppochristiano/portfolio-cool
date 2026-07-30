import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';

// Hovering one gallery card decodes its whole ROW, cascading outward from the
// card under the cursor.
//
// The grid has no row concept to hang this on: `.gallery-grid` is
// `repeat(auto-fill, minmax(220px, 1fr))`, so rows are implicit CSS rows, the
// items array is flat, and the column count exists nowhere in JS. We measure
// it off the live first row instead (see measureColumns).
//
// Why a registry instead of lifting hover state to <Gallery>: the grid is
// infinite-scrolled to 100+ cards, and FigureCard rebuilds its thumb object on
// every render, so a state change in the parent would rewrite every idle
// card's <pre>. The controller lives in a ref that never changes identity —
// consumers never re-render from context — and a hover pokes only the
// setState of the cards in the affected row.

const STEP_MS = 70; // per-card offset of the cascade, measured from the hovered card
const LEAVE_GRACE_MS = 120; // see `leave` — pointerleave fires before the next pointerenter

const RowHoverContext = createContext(null);

// Column count from the live layout: walk the grid's children until offsetTop
// changes. Read fresh on every hover rather than cached off a ResizeObserver —
// `auto-fill` reflows on any width change, on font load, and as infinite
// scroll appends cards, and a stale count silently decodes the wrong span of
// cards. One offsetTop read per hover is cheaper than being wrong.
function measureColumns(grid) {
  const kids = grid?.children;
  if (!kids || kids.length === 0) return 1;
  const top = kids[0].offsetTop;
  let n = 1;
  while (n < kids.length && kids[n].offsetTop === top) n++;
  return n;
}

function createController(getColumns) {
  const slots = new Map(); // index -> that card's setActive
  const timers = new Map(); // index -> pending cascade timeout
  const lit = new Set(); // indices we've switched on and still owe an off to
  const state = { count: 0, enabled: true };
  let rowStart = -1; // first index of the row currently lit, -1 = none
  let leaveTimer = 0;

  const teardown = () => {
    timers.forEach((id) => clearTimeout(id));
    timers.clear();
    lit.forEach((i) => slots.get(i)?.(false));
    lit.clear();
    rowStart = -1;
  };

  const light = (i) => {
    lit.add(i);
    slots.get(i)?.(true);
  };

  return {
    setCount: (n) => {
      state.count = n;
    },
    setEnabled: (on) => {
      state.enabled = on;
    },

    register(index, setActive) {
      slots.set(index, setActive);
      return () => {
        if (slots.get(index) === setActive) slots.delete(index);
      };
    },

    enter(index) {
      if (!state.enabled || index == null) return;
      if (leaveTimer) {
        clearTimeout(leaveTimer);
        leaveTimer = 0;
      }
      const cols = Math.max(1, getColumns());
      const start = Math.floor(index / cols) * cols;
      // Same row (a sweep across it, or re-entering after the grace window):
      // leave the running decodes alone — restarting them would make the art
      // stutter back to the thumb under the cursor.
      if (start === rowStart) return;
      teardown();
      rowStart = start;
      const end = Math.min(start + cols, state.count || start + cols);
      for (let i = start; i < end; i++) {
        const delay = Math.abs(i - index) * STEP_MS;
        if (delay === 0) {
          light(i); // the hovered card itself — no perceptible lag
          continue;
        }
        timers.set(
          i,
          setTimeout(() => {
            timers.delete(i);
            light(i);
          }, delay),
        );
      }
    },

    // Deferred: dragging the cursor across a row fires leave(a) BEFORE
    // enter(b), so tearing down synchronously would kill and restart the whole
    // row on every card boundary. The next enter cancels this.
    leave() {
      if (leaveTimer) clearTimeout(leaveTimer);
      leaveTimer = setTimeout(() => {
        leaveTimer = 0;
        teardown();
      }, LEAVE_GRACE_MS);
    },

    reset() {
      if (leaveTimer) {
        clearTimeout(leaveTimer);
        leaveTimer = 0;
      }
      teardown();
    },
  };
}

export function RowHoverProvider({ gridRef, count = 0, enabled = true, children }) {
  const ref = useRef(null);
  if (!ref.current) ref.current = createController(() => measureColumns(gridRef?.current));
  const ctl = ref.current;

  useEffect(() => {
    ctl.setCount(count);
  }, [ctl, count]);

  useEffect(() => {
    ctl.setEnabled(enabled);
    if (!enabled) ctl.reset();
  }, [ctl, enabled]);

  useEffect(() => () => ctl.reset(), [ctl]);

  return <RowHoverContext.Provider value={ctl}>{children}</RowHoverContext.Provider>;
}

/**
 * One card's slot in the row-hover choreography.
 *
 * Outside a provider (the admin library reuses .gallery-grid without one) it
 * degrades to plain local hover state — one card at a time, exactly as before.
 */
export function useRowHoverSlot(index) {
  const ctl = useContext(RowHoverContext);
  const [active, setActive] = useState(false);

  useEffect(() => {
    if (!ctl || index == null) return undefined;
    return ctl.register(index, setActive);
  }, [ctl, index]);

  const onEnter = useCallback(() => (ctl ? ctl.enter(index) : setActive(true)), [ctl, index]);
  const onLeave = useCallback(() => (ctl ? ctl.leave() : setActive(false)), [ctl]);
  // Hard off switch — no grace window, used when the page is parked.
  const reset = useCallback(() => (ctl ? ctl.reset() : setActive(false)), [ctl]);

  return { active, onEnter, onLeave, reset };
}
