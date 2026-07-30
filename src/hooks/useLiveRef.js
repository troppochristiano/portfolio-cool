import { useRef } from "react";

// A ref that always holds the latest render's value — the standard escape
// hatch for reading fresh props/state from long-lived imperative code (rAF
// loops, listeners, three.js callbacks) without re-running their effects.
// Replaces the hand-rolled `const xRef = useRef(x); xRef.current = x;` pairs.
export function useLiveRef(value) {
  const ref = useRef(value);
  ref.current = value;
  return ref;
}
