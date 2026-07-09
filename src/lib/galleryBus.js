// Tiny cross-component signal: is the 3D gallery busy re-compositing every frame?
//
// Two flags feed it. AsciiGallery flips `interacting` on while a drag is in
// flight (and for a short settle window after release), and `roaming` on for the
// whole intro until the roam has settled. The 25–49 AsciiPlayers read the
// combined `isBusy()` to throttle their per-frame innerHTML/textContent rewrites
// down to a low fps during those windows. Easing off the ASCII repaint while the
// CSS3D wall is re-compositing every frame is what keeps orientation changes and
// the intro roam smooth on mobile — the two workloads stop competing for the
// main thread without the art freezing outright.
//
// `roaming` is a separate flag (not a reuse of `interacting`) so a stray touch
// mid-intro can't clear the roam throttle via the pointer-up settle timer.
//
// Deliberately not React state: this is read inside rAF loops, so a re-render
// per change would defeat the purpose.

let interacting = false;
let roaming = false;

export function setInteracting(value) {
  interacting = !!value;
}

export function setRoaming(value) {
  roaming = !!value;
}

export function isRoaming() {
  return roaming;
}

export function isBusy() {
  return interacting || roaming;
}
