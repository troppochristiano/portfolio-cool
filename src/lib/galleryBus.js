// Tiny cross-component signal: is the user actively orienting the 3D gallery?
//
// AsciiGallery flips this on while a drag is in flight (and for a short settle
// window after release); the 49 AsciiPlayers read it to throttle their per-frame
// innerHTML/textContent rewrites down to a low fps during that window. Easing off
// the ASCII repaint while the CSS3D wall is re-compositing every frame is what
// keeps fast orientation changes smooth on mobile — the two workloads stop
// competing for the main thread without the art freezing outright.
//
// Deliberately not React state: this is read inside rAF loops, so a re-render
// per change would defeat the purpose.

let interacting = false;

export function isInteracting() {
  return interacting;
}

export function setInteracting(value) {
  interacting = !!value;
}
