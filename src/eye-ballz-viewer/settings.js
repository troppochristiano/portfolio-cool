// The single, serializable settings object that fully describes a "look": depth,
// the AsciiEffect options, and the shader distortion amounts. Tweak it in the UI,
// Export it as JSON, then paste it back as `initialSettings` in another project.
//
// NOTE: these are the portable package's neutral defaults, NOT the shipped look —
// EyeBallzViewer's inline `initialSettings` default overrides them via mergeSettings
// (the inline object wins key-by-key).

export const DEFAULT_SETTINGS = {
  displacementScale: 0.5,
  ascii: {
    enabled: false,
    characters: " .:-+*=%@#",
    invert: false,
    color: false,
    resolution: 0.25,
    fgColor: "#ffffff",
    bgColor: "#000000",
    // When non-empty, the lit silhouette is filled with this phrase (flowing through the
    // shape) instead of the brightness ramp. Empty => normal ramp rendering.
    phrase: "",
    // Opacity (0..1) of the underlying solid model shown behind the ASCII glyphs. 0 keeps
    // the model fully see-through (canvas hidden); higher fills just the model silhouette
    // (the keyed background is transparent, so the window background is unaffected).
    backplate: 0,
    // Color the revealed backplate silhouette is painted in (any CSS hex) — the tint
    // canvas recolors the model silhouette to exactly this each rendered frame.
    // Only visible while `backplate` > 0.
    backdropColor: "#0000ff",
    // Gradient text color for the ASCII glyphs. When enabled, overrides the flat fgColor
    // (clipped to the glyphs via CSS). Ignored while per-pixel `color` mode is on.
    gradient: { enabled: false, from: "#00ff88", to: "#ff0088", angle: 90 },
  },
  distortion: {
    waveAmp: 0,
    waveSpeed: 2,
    swirl: 0,
    glitch: 0,
    noise: 0,
    rgbShift: 0,
  },
  tilt: {
    enabled: true,
    // degrees of max rotation at the screen edge — "very slight". Separate per axis:
    // X = pitch (follows vertical cursor), Y = yaw (follows horizontal cursor).
    maxTiltX: 6,
    maxTiltY: 6,
  },
  // CRT look (after njbair's "Pure CSS CRT Effect"). Scanline grille + drifting scan
  // bar composite over the canvas OR the ASCII DOM, so it combines with the ASCII
  // effect; the chromatic glow + curved bezel are applied to the content layers.
  // Off until toggled.
  crt: {
    enabled: false,
    scanlineOpacity: 0.2, // grille line darkness (0..1)
    scanlineSize: 4, // px period of the grille
    scanBar: true, // drifting horizontal scan bar
    curvature: true, // SVG clip-path CRT bezel
    glow: true, // chromatic phosphor text-shadow + color punch (ASCII)
  },
};

// Deep-merge a partial settings object onto the defaults so callers can override
// just the fields they care about via the `initialSettings` prop / imported JSON.
export function mergeSettings(partial) {
  if (!partial) return structuredClone(DEFAULT_SETTINGS);
  return {
    displacementScale:
      partial.displacementScale ?? DEFAULT_SETTINGS.displacementScale,
    ascii: {
      ...DEFAULT_SETTINGS.ascii,
      ...partial.ascii,
      gradient: {
        ...DEFAULT_SETTINGS.ascii.gradient,
        ...partial.ascii?.gradient,
      },
    },
    distortion: { ...DEFAULT_SETTINGS.distortion, ...partial.distortion },
    tilt: { ...DEFAULT_SETTINGS.tilt, ...partial.tilt },
    crt: { ...DEFAULT_SETTINGS.crt, ...partial.crt },
  };
}
