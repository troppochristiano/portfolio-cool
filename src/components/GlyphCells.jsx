// Shared scaffold for flat noise labels (ScrambleText, WorksTitleScramble,
// DecodeSwap): a stable accessible name plus aria-hidden per-glyph cells that
// the effects drive imperatively (textContent) — React renders this once and
// never re-renders during an effect. DecryptText keeps its own word-wrapped
// variant (nowrap word spans + accent classes).
export function GlyphCells({ text, prefix }) {
  return (
    <>
      {/* Stable accessible name; the flickering glyphs are presentation only. */}
      <span className={`${prefix}__sr`}>{text}</span>
      <span className={`${prefix}__chars`} aria-hidden="true">
        {Array.from(text).map((ch, i) => (
          <span key={i} className={`${prefix}__char`}>
            {ch}
          </span>
        ))}
      </span>
    </>
  );
}
