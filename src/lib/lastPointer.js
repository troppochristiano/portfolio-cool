// Last known pointer position in viewport coords, recorded page-wide.
// Hover-armed effects only hear pointermove, so a section scrolled under a
// resting cursor never triggers — scroll/reveal handlers use this to ask
// "where is the pointer right now" and fire anyway. Null until the pointer
// has moved at least once this page load.
let last = null;

if (typeof window !== "undefined") {
  const record = (e) => {
    // type lets consumers tell a resting mouse (still hovering after the
    // event) from a touch (gone the moment the finger lifts).
    last = { x: e.clientX, y: e.clientY, type: e.pointerType };
  };
  window.addEventListener("pointermove", record, { passive: true });
  window.addEventListener("pointerdown", record, { passive: true });
}

export const lastPointer = () => last;
