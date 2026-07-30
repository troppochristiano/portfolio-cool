// Persisted "skip the intro on future visits" preference: first written by the
// post-skip corner prompt on the hero, and flipped either way afterwards by the
// toggle in the About footer (which only shows itself to visitors who opted in).
// Same one-slot localStorage pattern as adminSecret.js, but wrapped — this runs
// at boot for every visitor and localStorage can throw (private modes, disabled
// storage); failing just means the intro plays.

export const INTRO_SKIP_KEY = "ascii_intro_skip";

export const getIntroSkipPref = () => {
  try {
    return localStorage.getItem(INTRO_SKIP_KEY) === "1";
  } catch {
    return false;
  }
};

export const setIntroSkipPref = () => {
  try {
    localStorage.setItem(INTRO_SKIP_KEY, "1");
  } catch {
    // No-op: the prompt still confirms, the pref just won't stick.
  }
};

export const clearIntroSkipPref = () => {
  try {
    localStorage.removeItem(INTRO_SKIP_KEY);
  } catch {
    // No-op.
  }
};
