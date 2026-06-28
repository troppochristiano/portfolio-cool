import { StrictMode, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { EyeBallzViewer } from "../index.js";
import { photos } from "../../photos.ts";

// Map the repo's photos.ts entries into the component's photo-config shape. The
// default urlFor already matches this repo's ./outputs/<prefix>/... layout.
const photoConfigs = Object.entries(photos).map(([key, p]) => ({
  key,
  thumbnail: p.filename,
  prefix: p.PREFIX,
  xSteps: p.X_STEPS,
  ySteps: p.Y_STEPS,
  // Optional expression grids (neutral/blink/smile/smileBlink → output prefix).
  expressions: p.expressions,
}));

// Tall filler above/below the viewer so the page scrolls — lets you see the difference
// between the window staying pinned (📌) and scrolling away with the page (📍).
const spacer = (label) => (
  <div
    style={{
      height: "120vh",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      color: "rgba(255,255,255,0.25)",
      fontFamily: "system-ui, sans-serif",
      fontSize: 14,
      letterSpacing: "0.1em",
      textTransform: "uppercase",
    }}
  >
    {label}
  </div>
);

// Demonstrates driving the avatar imperatively via the ref handle — the same surface
// app/event code (e.g. chat replies) would use to nod or change expression.
function Demo() {
  const viewer = useRef(null);
  const [animMode, setAnimMode] = useState(false);
  const barBtn = {
    padding: "8px 14px",
    fontFamily: "system-ui, sans-serif",
    fontSize: 13,
    cursor: "pointer",
  };
  const toggleAnimMode = () => {
    const next = !animMode;
    setAnimMode(next);
    viewer.current?.setAnimationMode(next);
  };
  return (
    <>
      {spacer("scroll down ↓")}
      <div
        style={{
          display: "flex",
          gap: 8,
          justifyContent: "center",
          marginBottom: 16,
        }}
      >
        <button
          style={barBtn}
          onClick={() => viewer.current?.playGesture("nodYes")}
        >
          Nod yes
        </button>
        <button
          style={barBtn}
          onClick={() => viewer.current?.playGesture("nodNo")}
        >
          Nod no
        </button>
        <button
          style={barBtn}
          onClick={() => viewer.current?.setExpression("smile")}
        >
          Smile
        </button>
        <button
          style={barBtn}
          onClick={() => viewer.current?.setExpression("neutral")}
        >
          Neutral
        </button>
        <button
          style={{ ...barBtn, fontWeight: animMode ? 700 : 400 }}
          onClick={toggleAnimMode}
        >
          Animation mode: {animMode ? "on" : "off"}
        </button>
      </div>
      <EyeBallzViewer
        ref={viewer}
        photos={photoConfigs}
        status="neutral"
        autoBlink
        transparent
        showTitlebarButtons
        debug
        windowed
      />
      {spacer("↑ scroll up")}
    </>
  );
}

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <Demo />
  </StrictMode>,
);
