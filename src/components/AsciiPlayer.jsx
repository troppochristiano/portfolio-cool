import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { isBusy, isRoaming } from '../lib/galleryBus.js';
import { resolveStyle, STYLE_DEFAULTS } from '../create/styleOptions.js';
import { prefersReducedMotion } from '../lib/utils.js';

/**
 * Plays a `figure.json` exported by the ascii media converter. The data shape is
 * `{ cols, rows, fps, color, cellPx?, frames }` where each frame is a string —
 * plain text, or HTML `<span style="color:…">` runs when `color` is true.
 *
 * Self-contained: no external CSS or dependencies. The playback (rAF gated to
 * 1000/fps, color→innerHTML / plain→textContent, single static frame under
 * reduced-motion) matches the converter's own "baked" preview exactly.
 *
 * Sizing: the <pre> always renders at a safe base font (`fontSize` → `data.cellPx`
 * → 12) and `width`/`fit` are hit with a CSS transform on top of that, inside a
 * wrapper whose layout box is set to the scaled size. Solving for a font size
 * instead (the old approach) breaks on real phones: high-res figures need
 * sub-pixel fonts, and mobile text-inflation/minimum-font clamps blow the <pre>
 * up to the clamped font's width. Transforms are immune to those clamps, so the
 * layout box is exact on every device.
 *
 * Props:
 *   data      parsed figure.json
 *   width     render exactly this many px wide (transform-scales to fit)
 *   maxHeight optional height cap used with `width` — scales down further if the
 *             figure would exceed it (keeps extreme-portrait figures bounded)
 *   fit       fill the parent element's content-box width; re-fits on resize
 *   contain   with `fit`: also fit the parent's content-box height (letterbox
 *             inside the box instead of overflowing it)
 *   fontSize  fixed px size of one cell (base font; also the only sizing when
 *             width/fit are unset)
 *   loop      repeat after the last frame (default true)
 *   paused    render frame 0 and never animate — no rAF loop at all. Used by
 *             the hero wall on phones, where dozens of autoplaying players are
 *             the main scroll/first-visit cost; the info dialog still plays.
 *   className extra class on the <pre> (or the edge-stack wrapper)
 *   style     extra inline styles merged over the base (e.g. color, background)
 *   label     accessible name; when given the art is exposed via aria-label,
 *             otherwise it stays aria-hidden (decorative)
 */
export default function AsciiPlayer({
  data,
  width,
  maxHeight,
  fit = false,
  contain = false,
  fontSize,
  loop = true,
  paused = false,
  className,
  style,
  label,
}) {
  const ref = useRef(null);
  const edgeRef = useRef(null); // overlay <pre> for a tinted edge layer (optional)
  const wrapperRef = useRef(null); // grid stack that holds both <pre>s when edges exist
  const outerRef = useRef(null); // sizing box around the (transform-scaled) content
  // { scale, w, h } — transform scale plus the content's natural layout size.
  const [box, setBox] = useState(null);

  // A figure carries a separate edge layer only when its creator chose a
  // distinct edge color. Each entry pairs 1:1 with `frames`; blanks are spaces,
  // so stacking it over the base reproduces the converter's two-layer look.
  const hasEdges = Array.isArray(data?.edgeFrames) && data.edgeFrames.length > 0;

  // ── playback ──
  // Layout effect so frame 0 is committed to the DOM before paint whenever
  // `data` swaps (the hero wall trades a downsampled copy for the full figure
  // on hover) — paired with the sizing layout effect below, the new glyphs and
  // their new scale land in the same paint instead of flashing mis-scaled.
  useLayoutEffect(() => {
    const el = ref.current;
    const frames = data?.frames;
    if (!el || !frames || frames.length === 0) return;

    const isColor = !!data.color;
    const edgeFrames = hasEdges ? data.edgeFrames : null;
    const write = (i) => {
      const frame = frames[i];
      // Color frames are HTML (tinted spans) and must go through innerHTML;
      // plain frames use textContent so glyphs like < and & render literally.
      if (isColor) el.innerHTML = frame;
      else el.textContent = frame;
      // The edge layer is always plain text → textContent (never innerHTML).
      if (edgeRef.current) edgeRef.current.textContent = edgeFrames?.[i] ?? '';
    };

    write(0);
    if (paused || prefersReducedMotion() || frames.length <= 1) return;

    const interval = 1000 / (data.fps || 12);
    // While the CSS3D wall is re-compositing every frame (a user drag OR the
    // intro roam), throttle playback to a low fps instead of stopping it — the
    // art keeps moving but the (expensive) innerHTML/textContent rewrites stop
    // competing with the re-composite. Math.max never speeds a figure up if its
    // own fps is already below this.
    const BUSY_FPS = 6;
    const busyInterval = Math.max(interval, 1000 / BUSY_FPS);
    let raf = 0;
    let i = 0;
    let last = performance.now();
    const tick = (now) => {
      // The intro roam owns the frame budget outright: hold the current frame
      // (rAF stays alive so playback resumes the moment the wall settles).
      // Drags keep the gentler busy rate below — the wall is at rest-ish and
      // fully visible then, so a frozen wall would read as broken.
      if (isRoaming()) {
        last = now;
        raf = requestAnimationFrame(tick);
        return;
      }
      const gate = isBusy() ? busyInterval : interval;
      if (now - last >= gate) {
        last = now;
        const next = i + 1;
        if (next >= frames.length && !loop) return; // hold on the last frame
        i = next % frames.length;
        write(i);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [data, loop, hasEdges, paused]);

  const sized = width != null || fit;

  // ── transform sizing (width / fit) ──
  // Layout effect declared after playback: layout effects run in order, so
  // frame 0 is already written when we measure, and setBox flushes before the
  // browser paints — a data swap can never paint one frame at the stale scale.
  // The <pre> never wraps and offsetWidth/Height ignore transforms, so the
  // natural size is stable across re-measures — no feedback loop.
  useLayoutEffect(() => {
    if (!sized) {
      setBox(null);
      return;
    }
    const content = wrapperRef.current || ref.current;
    if (!content) return;
    const container = outerRef.current?.parentElement;
    const measure = () => {
      const natW = content.offsetWidth;
      const natH = content.offsetHeight;
      if (!natW || !natH) return;
      let targetW;
      let targetH = null;
      if (width != null) {
        targetW = width;
        targetH = maxHeight ?? null;
      } else {
        if (!container) return;
        // Fit the container's content box (its padding is not ours to fill).
        const cs = getComputedStyle(container);
        targetW =
          container.clientWidth -
          parseFloat(cs.paddingLeft) -
          parseFloat(cs.paddingRight);
        if (contain) {
          targetH =
            container.clientHeight -
            parseFloat(cs.paddingTop) -
            parseFloat(cs.paddingBottom);
        }
      }
      if (!targetW || targetW <= 0) return;
      let next = targetW / natW;
      if (targetH != null && targetH > 0) next = Math.min(next, targetH / natH);
      setBox((prev) =>
        prev && prev.w === natW && prev.h === natH && Math.abs(prev.scale - next) < 0.001
          ? prev
          : { scale: next, w: natW, h: natH },
      );
    };
    measure();
    if (fit && container) {
      const ro = new ResizeObserver(measure);
      ro.observe(container);
      return () => ro.disconnect();
    }
  }, [data, width, maxHeight, fit, contain, fontSize, sized]);

  // Base font is never sub-pixel — the transform does the shrinking.
  const px = fontSize ?? data?.cellPx ?? 12;

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
      // The edge glyphs' own color (falls back to the text color in resolveStyle).
      edgeColor: s.edgeColor,
    };
  }, [data]);

  // The transform lands on the outermost content element: the grid wrapper when
  // an edge layer exists, else the <pre> itself.
  const scaleStyle =
    sized && box
      ? { transform: `scale(${box.scale})`, transformOrigin: 'top left' }
      : sized
        ? { transformOrigin: 'top left' }
        : null;

  const preStyle = {
    // Mirror the converter's .preview so the grid aligns identically.
    whiteSpace: 'pre',
    margin: 0,
    // Shrink-wrap to the art: a block <pre> would otherwise take its parent's
    // width and the sizing measurement below would read the box, not the art.
    width: 'max-content',
    fontSize: `${px}px`,
    // Mobile text inflation (iOS text-size-adjust, Android font boosting) must
    // never touch the art — it would desync the grid from the measured size.
    WebkitTextSizeAdjust: 'none',
    textSizeAdjust: 'none',
    ...figStyle,
    edgeColor: undefined, // not a CSS property — never leak it onto the element
    ...(hasEdges ? null : scaleStyle),
    ...style,
  };

  const basePre = (
    <pre
      ref={ref}
      className={hasEdges ? undefined : className}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      style={hasEdges ? { ...preStyle, transform: undefined, gridArea: '1 / 1' } : preStyle}
    />
  );

  const content = hasEdges ? (
    // Two-layer render: base ramp and the tinted edge glyphs share one grid cell
    // so they overlap pixel-for-pixel while carrying their own colors. Only the
    // base pre is animated; the overlay mirrors its metrics. The wrapper is what
    // gets measured and scaled, so both layers move as one.
    <div
      ref={wrapperRef}
      className={className}
      style={{
        display: 'grid',
        placeItems: 'center',
        width: 'max-content',
        ...(style?.background ? { background: style.background } : null),
        ...scaleStyle,
      }}
    >
      {basePre}
      <pre
        ref={edgeRef}
        aria-hidden="true"
        style={{
          ...preStyle,
          transform: undefined,
          gridArea: '1 / 1',
          color: figStyle.edgeColor,
          background: undefined, // transparent so the base layer shows through
          pointerEvents: 'none',
        }}
      />
    </div>
  ) : (
    basePre
  );

  if (!sized) return content;

  // Sizing box: its layout size is the scaled size, so hosts (wall planes,
  // cards, dialogs) see exactly the target dimensions — independent of any
  // device font quirks. Hidden until the first measure so the natural-size
  // content never flashes.
  return (
    <div
      ref={outerRef}
      style={{
        width: box ? box.w * box.scale : width ?? undefined,
        height: box ? box.h * box.scale : undefined,
        overflow: 'hidden',
        visibility: box ? undefined : 'hidden',
      }}
    >
      {content}
    </div>
  );
}
