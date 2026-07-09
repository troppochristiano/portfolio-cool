// Pure helpers over the viewer's mutable Three.js handle (`h`) — texture
// swaps, expression resolution, disposal. No React, no DOM.

// Swap the material's color + displacement maps to the current display expression's
// grid cell. Falls back to the base expression, then any loaded grid, so a missing or
// still-loading variant never blanks the avatar.
export function applyTexture(h, step) {
  // Resolve the cell *per-cell*, not per-grid: a grid may be partially loaded (e.g. smile
  // only holds its top forehead rows), so if the chosen expression lacks this exact cell we
  // fall back to the base grid's cell, then any grid that has it. This keeps a partial grid
  // from freezing on the last frame when the look-cell leaves its loaded region.
  const fn = step.filename;
  const tex =
    h.expr[h.displayExpression]?.get(fn) ??
    h.expr[h.baseExpression]?.get(fn) ??
    Object.values(h.expr)
      .map((m) => m.get(fn))
      .find(Boolean);
  if (!tex) return;
  const depthTex = h.depth.get(step.filename) ?? null; // shared depth
  h.material.map = tex;
  h.material.displacementMap = depthTex;
  // Mirror the live cell's depth into the shader so the fragment stage can key out the
  // background by depth (removes the gray inpainting smudges the luminance key misses).
  h.uniforms.uDepthMap.value = depthTex;
  h.uniforms.uHasDepth.value = depthTex ? 1 : 0;
  // Swapping between two non-null maps reuses the same shader program — the renderer
  // re-reads the maps each frame, so needsUpdate (a program re-eval) is only required
  // when a map's presence toggles null↔texture and the USE_MAP/USE_DISPLACEMENTMAP
  // defines actually change (e.g. the first reveal).
  const maps = (tex ? 1 : 0) | (depthTex ? 2 : 0);
  if (maps !== h.mapState) {
    h.mapState = maps;
    h.material.needsUpdate = true;
  }
  h.needsRender = true; // demand rendering: a map swap must reach the screen
}

// Pick the base expression to show for a given status, honoring what's loaded. Accepts
// any expression name present in h.expr; falls back to "neutral", then the first loaded
// grid, so an unknown/blink-only status never blanks the avatar.
export function resolveBase(h, status) {
  if (!h.hasExpressions) return Object.keys(h.expr)[0] ?? "default";
  // Blink variants are flashed by the auto-blink loop, not selectable as a base.
  if (status && h.expr[status] && !isBlinkVariant(status)) return status;
  if (h.expr.neutral) return "neutral";
  return Object.keys(h.expr)[0] ?? "default";
}

// Blink variants are named "blink" or "<name>Blink" — never a long-lived base.
export const isBlinkVariant = (name) =>
  name === "blink" || name.endsWith("Blink");

// Dispose every resident color grid plus the shared depth set, and reset the maps.
export function disposeExpr(h) {
  Object.values(h.expr).forEach((colors) => colors.forEach((t) => t.dispose()));
  h.expr = {};
  h.depth.forEach((t) => t.dispose());
  h.depth.clear();
}
