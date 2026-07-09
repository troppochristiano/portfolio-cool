// Shared constants for the converter UI.

// The charset ramps offered by the converter. The server whitelists these in
// functions/api/_lib/validate.js — keep the two in sync.
export const RAMP_PRESETS = {
  classic: " .:-=+*#%@",
  // 70-level ramp (Paul Bourke), empty→dense — far finer tonal gradation
  detailed:
    " .'`^\",:;Il!i><~+_-?][}{1)(|\\/tfjrxnuvczXYUJCLQ0OZmwqpdbkhao*#MW&8%B@$",
  blocks: " ░▒▓█",
  minimal: " .oO@",
  dots: " ·•●",
};

// Quality presets → column counts. Columns are the real control, but the
// preset names + the pixel readout keep the units human.
export const QUALITY_PRESETS = { low: 60, medium: 110, high: 180, ultra: 280 };

// Backing resolution of the blank "paper" before a photo is loaded, and the
// cap applied to uploaded photos (largest dimension) so sampling stays cheap.
export const PAPER_W = 1024;
export const PAPER_H = 768;
export const MAX_PHOTO = 1280;

// Brush shades, white → black. ASCII maps brightness — with "invert" ON
// (dark ink on light bg) the swatch you pick is literally the glyph density
// you'll get; with invert off (the default) the mapping flips.
export const BRUSH_SHADES = [
  "#ffffff",
  "#d9d9d9",
  "#ababab",
  "#7f7f7f",
  "#555555",
  "#2b2b2b",
  "#000000",
];
