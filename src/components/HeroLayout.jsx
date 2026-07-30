import { useState } from "react";
import { useLocation } from "react-router-dom";
import App from "../App";
import { RouteTransition } from "./RouteTransition.jsx";
import { AsciiCursor } from "./AsciiCursor.jsx";

// Layout route that keeps the hero (App: face avatar + ASCII wall + intro)
// permanently mounted as the bottom layer while /create and /gallery render
// above it in RouteTransition's page layer. Navigating back to "/" is instant:
// the WebGL scene, textures, and intro state all survive.
//
// `covered` drives the whole suspension story: visibility hides the layer
// without dropping the WebGL context, inert removes it from focus/hit-testing
// (React 18: pass "" not a boolean), and App's `suspended` prop pauses the
// render loops and unmounts the ui-chrome (whose window-level wheel/touch
// listeners must not react to the page on top).
export default function HeroLayout() {
  const location = useLocation();
  // Seed from the deep-linked route so the hero mounts already suspended on
  // /gallery or /create (preload deferral in App keys off this).
  const [covered, setCovered] = useState(location.pathname !== "/");

  return (
    <>
      <div
        className={`hero-layer${covered ? " is-covered" : ""}`}
        inert={covered ? "" : undefined}
      >
        <App suspended={covered} />
      </div>
      <RouteTransition onCoverChange={setCovered} />
      {/* Sibling of the hero layer, never inside it: .hero-layer.is-covered
          hides by visibility, which would blank the cursor on /gallery.
          Covers /create too — AsciiCursor's selector table carries that
          page's whole tool vocabulary (crosshair, pick, move, the four
          resize axes) and steps aside for the two pointers it cannot
          replace: the draw pad's brush ring and Turnstile's iframe. /admin
          never mounts this at all: it routes outside this layout. */}
      <AsciiCursor />
    </>
  );
}
