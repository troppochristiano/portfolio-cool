// Sub-panels for the viewer's debug overlay (drei-AsciiRenderer-style controls).
// Pure presentational: settings slices in, onChange patches out.

function Row({ label, children }) {
  return (
    <label className="eye-ballz-row">
      <span>{label}</span>
      {children}
    </label>
  );
}

// Capitalize a camelCase name for a button label: "nodYes" → "Nod Yes".
const labelOf = (name) =>
  name
    .replace(/([A-Z])/g, " $1")
    .replace(/^./, (c) => c.toUpperCase())
    .trim();

// Dev-only: hot-swap the avatar's preview grid size and read back the last load's frame
// count + time, so coarser grids' faster loads can be felt without editing the URL.
const GRID_PRESETS = [3, 5, 7, 10]; // 10 = the full rendered source grid
export function GridPanel({ value, onChange, stats }) {
  // The active preset for a square value (number, or {x,y} with x===y); null otherwise.
  const active =
    typeof value === "number"
      ? value
      : value && value.x === value.y
        ? value.x
        : null;
  return (
    <div className="eye-ballz-panel eye-ballz-panel--grid">
      <span className="eye-ballz-title">grid size</span>
      <div className="eye-ballz-buttons">
        {GRID_PRESETS.map((n) => (
          <button
            key={n}
            className={`eye-ballz-btn${active === n ? " active" : ""}`}
            onClick={() => onChange({ x: n, y: n })}
          >
            {n}×{n}
          </button>
        ))}
      </div>
      <span className="eye-ballz-stat">
        {stats
          ? `${stats.grid} · ${stats.frames} frames · ${stats.ms} ms`
          : "load a size to time it"}
      </span>
    </div>
  );
}

export function ExpressionPanel({
  expressions,
  status,
  onStatus,
  gestures,
  onGesture,
  autoBlink,
  onAutoBlink,
  animMode,
  onAnimMode,
}) {
  return (
    <div className="eye-ballz-panel eye-ballz-panel--expression">
      {expressions.length > 0 && (
        <>
          <span className="eye-ballz-title">expression</span>
          <div className="eye-ballz-buttons">
            {expressions.map((name) => (
              <button
                key={name}
                className={`eye-ballz-btn${status === name ? " active" : ""}`}
                onClick={() => onStatus(name)}
              >
                {labelOf(name)}
              </button>
            ))}
          </div>
          <Row label="auto-blink">
            <input
              type="checkbox"
              checked={autoBlink}
              onChange={(e) => onAutoBlink(e.target.checked)}
            />
          </Row>
        </>
      )}
      {gestures.length > 0 && (
        <>
          <span className="eye-ballz-title">gestures</span>
          <div className="eye-ballz-buttons">
            {gestures.map((name) => (
              <button
                key={name}
                className="eye-ballz-btn"
                onClick={() => onGesture(name)}
              >
                {labelOf(name)}
              </button>
            ))}
          </div>
          <Row label="animation mode">
            <input
              type="checkbox"
              checked={animMode}
              onChange={(e) => onAnimMode(e.target.checked)}
            />
          </Row>
        </>
      )}
    </div>
  );
}

// Character ramps to stress-test the renderer (dark -> light). Fed into the `characters`
// setting; click to swap. The free-text field below stays editable for custom ramps.
const RAMP_PRESETS = [
  ["min", " .:-=+*#%@"],
  ["blocks", " ░▒▓█"],
  ["dots", " .·•●"],
  [
    "dense",
    " .'`^\",:;Il!i~+_-?][}{1)(|/tfjrxnuvczXYUJCLQ0OZmwqpdbkhao*#MW&8%B@$",
  ],
];

export function AsciiPanel({ ascii, onChange }) {
  const g = ascii.gradient;
  return (
    <div className="eye-ballz-panel eye-ballz-panel--ascii">
      <span className="eye-ballz-title">ascii</span>
      <div className="eye-ballz-buttons">
        {RAMP_PRESETS.map(([label, ramp]) => (
          <button
            key={label}
            className={`eye-ballz-btn${ascii.characters === ramp ? " active" : ""}`}
            onClick={() => onChange({ characters: ramp })}
          >
            {label}
          </button>
        ))}
      </div>
      <Row label="characters">
        <input
          type="text"
          value={ascii.characters}
          onChange={(e) => onChange({ characters: e.target.value || " " })}
        />
      </Row>
      <Row label="phrase">
        <input
          type="text"
          value={ascii.phrase}
          placeholder="(ramp mode)"
          onChange={(e) => onChange({ phrase: e.target.value })}
        />
      </Row>
      <Row label="resolution">
        <input
          type="range"
          min={0.05}
          max={0.4}
          step={0.01}
          value={ascii.resolution}
          onChange={(e) => onChange({ resolution: parseFloat(e.target.value) })}
        />
      </Row>
      <Row label="invert">
        <input
          type="checkbox"
          checked={ascii.invert}
          onChange={(e) => onChange({ invert: e.target.checked })}
        />
      </Row>
      <Row label="color (slow)">
        <input
          type="checkbox"
          checked={ascii.color}
          onChange={(e) => onChange({ color: e.target.checked })}
        />
      </Row>
      <Row label="fg">
        <input
          type="color"
          value={ascii.fgColor}
          onChange={(e) => onChange({ fgColor: e.target.value })}
        />
      </Row>
      <Row label="bg">
        <input
          type="color"
          value={ascii.bgColor}
          onChange={(e) => onChange({ bgColor: e.target.value })}
        />
      </Row>
      <Row label="model fill">
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={ascii.backplate}
          onChange={(e) => onChange({ backplate: parseFloat(e.target.value) })}
        />
      </Row>
      <Row label="gradient">
        <input
          type="checkbox"
          checked={g.enabled}
          onChange={(e) =>
            onChange({ gradient: { ...g, enabled: e.target.checked } })
          }
        />
      </Row>
      {g.enabled && (
        <>
          <Row label="from → to">
            <span>
              <input
                type="color"
                value={g.from}
                onChange={(e) =>
                  onChange({ gradient: { ...g, from: e.target.value } })
                }
              />
              <input
                type="color"
                value={g.to}
                onChange={(e) =>
                  onChange({ gradient: { ...g, to: e.target.value } })
                }
              />
            </span>
          </Row>
          <Row label="angle">
            <input
              type="range"
              min={0}
              max={360}
              step={1}
              value={g.angle}
              onChange={(e) =>
                onChange({
                  gradient: { ...g, angle: parseInt(e.target.value, 10) },
                })
              }
            />
          </Row>
        </>
      )}
    </div>
  );
}

export function DistortionPanel({ distortion, onChange }) {
  const sliders = [
    ["waveAmp", "wave", 0, 0.08, 0.001],
    ["waveSpeed", "wave speed", 0, 10, 0.1],
    ["swirl", "swirl", 0, 6, 0.05],
    ["glitch", "glitch", 0, 0.2, 0.001],
    ["noise", "noise", 0, 0.1, 0.001],
    ["rgbShift", "rgb shift", 0, 0.04, 0.001],
  ];
  return (
    <div className="eye-ballz-panel eye-ballz-panel--distortion">
      <span className="eye-ballz-title">distortion</span>
      {sliders.map(([key, label, min, max, step]) => (
        <Row key={key} label={label}>
          <input
            type="range"
            min={min}
            max={max}
            step={step}
            value={distortion[key]}
            onChange={(e) => onChange({ [key]: parseFloat(e.target.value) })}
          />
        </Row>
      ))}
    </div>
  );
}

export function TiltPanel({ tilt, onChange }) {
  return (
    <div className="eye-ballz-panel eye-ballz-panel--tilt">
      <span className="eye-ballz-title">tilt</span>
      <Row label="enable">
        <input
          type="checkbox"
          checked={tilt.enabled}
          onChange={(e) => onChange({ enabled: e.target.checked })}
        />
      </Row>
      <Row label="max tilt x">
        <input
          type="range"
          min={0}
          max={20}
          step={0.5}
          value={tilt.maxTiltX}
          onChange={(e) => onChange({ maxTiltX: parseFloat(e.target.value) })}
        />
      </Row>
      <Row label="max tilt y">
        <input
          type="range"
          min={0}
          max={20}
          step={0.5}
          value={tilt.maxTiltY}
          onChange={(e) => onChange({ maxTiltY: parseFloat(e.target.value) })}
        />
      </Row>
    </div>
  );
}

export function CRTPanel({ crt, onChange }) {
  const sliders = [
    ["scanlineOpacity", "scanlines", 0, 1, 0.01],
    ["scanlineSize", "scanline size", 2, 10, 1],
  ];
  const toggles = [
    ["scanBar", "scan bar"],
    ["curvature", "curvature"],
    ["glow", "glow"],
  ];
  return (
    <div className="eye-ballz-panel eye-ballz-panel--crt">
      <span className="eye-ballz-title">crt</span>
      {sliders.map(([key, label, min, max, step]) => (
        <Row key={key} label={label}>
          <input
            type="range"
            min={min}
            max={max}
            step={step}
            value={crt[key]}
            onChange={(e) => onChange({ [key]: parseFloat(e.target.value) })}
          />
        </Row>
      ))}
      {toggles.map(([key, label]) => (
        <Row key={key} label={label}>
          <input
            type="checkbox"
            checked={crt[key]}
            onChange={(e) => onChange({ [key]: e.target.checked })}
          />
        </Row>
      ))}
    </div>
  );
}
