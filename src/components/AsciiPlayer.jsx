import { useEffect, useMemo, useRef, useState } from 'react';
import { isInteracting } from '../lib/galleryBus.js';
import { resolveStyle, STYLE_DEFAULTS } from '../create/styleOptions.js';

/**
 * Plays a `figure.json` exported by the ascii media converter. The data shape is
 * `{ cols, rows, fps, color, cellPx?, frames }` where each frame is a string —
 * plain text, or HTML `<span style="color:…">` runs when `color` is true.
 *
 * Self-contained: no external CSS or dependencies. The playback (rAF gated to
 * 1000/fps, color→innerHTML / plain→textContent, single static frame under
 * reduced-motion) matches the converter's own "baked" preview exactly.
 *
 * Sizing precedence: `width` / `fit` (compute a font size to hit a pixel width) →
 * else `fontSize` → else the tuned `data.cellPx` → else 12.
 *
 * Props:
 *   data      parsed figure.json
 *   width     render exactly this many px wide (scales the font to fit)
 *   fit       fill the parent element's width; re-fits on resize
 *   fontSize  fixed px size of one cell (used when width/fit are unset)
 *   loop      repeat after the last frame (default true)
 *   className extra class on the <pre>
 *   style     extra inline styles merged over the base (e.g. color, background)
 *   label     accessible name; when given the art is exposed via aria-label,
 *             otherwise it stays aria-hidden (decorative)
 */
export default function AsciiPlayer({
  data,
  width,
  fit = false,
  fontSize,
  loop = true,
  className,
  style,
  label,
}) {
  const ref = useRef(null);
  const [autoPx, setAutoPx] = useState(null);

  // ── playback ──
  useEffect(() => {
    const el = ref.current;
    const frames = data?.frames;
    if (!el || !frames || frames.length === 0) return;

    const isColor = !!data.color;
    const write = (frame) => {
      // Color frames are HTML (tinted spans) and must go through innerHTML;
      // plain frames use textContent so glyphs like < and & render literally.
      if (isColor) el.innerHTML = frame;
      else el.textContent = frame;
    };

    write(frames[0]);
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce || frames.length <= 1) return;

    const interval = 1000 / (data.fps || 12);
    // While the user is actively orienting the 3D wall, throttle playback to a low
    // fps instead of stopping it — the art keeps moving but the (expensive)
    // innerHTML/textContent rewrites stop competing with the CSS3D re-composite.
    // Math.max never speeds a figure up if its own fps is already below this.
    const INTERACTING_FPS = 6;
    const interactingInterval = Math.max(interval, 1000 / INTERACTING_FPS);
    let raf = 0;
    let i = 0;
    let last = performance.now();
    const tick = (now) => {
      const gate = isInteracting() ? interactingInterval : interval;
      if (now - last >= gate) {
        last = now;
        const next = i + 1;
        if (next >= frames.length && !loop) return; // hold on the last frame
        i = next % frames.length;
        write(frames[i]);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [data, loop]);

  // ── pixel sizing (width / fit) ──
  // Declared after playback so frame 0 is already written when we measure. The
  // <pre> never wraps (white-space: pre), so its width is linear in font size:
  // ratio = offsetWidth / appliedFontSize is invariant, which lets us solve for
  // the font size that hits a target width in one step — no resize feedback loop.
  useEffect(() => {
    const el = ref.current;
    if (!el || (width == null && !fit)) {
      setAutoPx(null);
      return;
    }
    const container = el.parentElement;
    const basePx = fontSize ?? data?.cellPx ?? 12;
    const measure = () => {
      const natW = el.offsetWidth;
      if (!natW) return;
      const appliedPx = parseFloat(el.style.fontSize) || basePx;
      const ratio = natW / appliedPx; // px of width per 1px of font
      const target = width != null ? width : container?.clientWidth;
      if (!target) return;
      const next = target / ratio;
      setAutoPx((prev) => (prev == null || Math.abs(prev - next) > 0.1 ? next : prev));
    };
    measure();
    if (fit && container) {
      const ro = new ResizeObserver(measure);
      ro.observe(container);
      return () => ro.disconnect();
    }
  }, [data, width, fit, fontSize]);

  const sized = width != null || fit;
  const px = (sized ? autoPx : null) ?? fontSize ?? data?.cellPx ?? 12;

  // Optional creator styling from figure.json (font key → whitelisted stack,
  // clamped numbers, hex colors — resolveStyle is defensive, so a hand-edited
  // JSON can't inject anything). Defaults stay `undefined` so the player keeps
  // inheriting color/background from its host (wall plane, dialog, card).
  const figStyle = useMemo(() => {
    const s = resolveStyle(data?.style);
    return {
      fontFamily: s.fontFamily,
      lineHeight: s.lineHeight,
      letterSpacing: s.letterSpacing ? `${s.letterSpacing}em` : 0,
      color: s.color !== STYLE_DEFAULTS.color ? s.color : undefined,
      background: s.background !== STYLE_DEFAULTS.background ? s.background : undefined,
    };
  }, [data]);

  return (
    <pre
      ref={ref}
      className={className}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      style={{
        // Mirror the converter's .preview so the grid aligns identically.
        whiteSpace: 'pre',
        margin: 0,
        fontSize: `${px}px`,
        ...figStyle,
        ...style,
      }}
    />
  );
}
