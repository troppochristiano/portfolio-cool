// Tiny cross-component signal: is the 3D gallery mid intro-roam?
//
// AsciiGallery flips `roaming` on for the whole intro until the roam has
// settled. The wall's AsciiPlayers read `isRoaming()` to hold their per-frame
// innerHTML/textContent rewrites while the CSS3D tunnel re-composites every
// frame — the two workloads stop competing for the main thread without the art
// freezing outright. (A user drag no longer throttles playback: the wall is
// at-rest and fully visible then, so the clips just keep playing.)
//
// Deliberately not React state: this is read inside rAF loops, so a re-render
// per change would defeat the purpose.

let roaming = false;

export function setRoaming(value) {
  roaming = !!value;
}

export function isRoaming() {
  return roaming;
}
