import { useRef } from "react";

/**
 * The one source-intake control — same label, chrome and placement in the
 * video and image sections (they used to be a muted text link and a bordered
 * button saying the same thing).
 *
 * A real <button> driving a hidden input, rather than the <label>-wraps-input
 * trick the two originals used: a label isn't in the tab order, so neither
 * replace-source control could be reached from the keyboard.
 */
export default function SourceButton({ onFile, hasSource = true, className = "" }) {
  const inputRef = useRef(null);
  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept="image/*,video/*"
        onChange={(e) => {
          onFile(e.target.files?.[0]);
          // Re-picking the SAME file must still fire change — without this the
          // value is unchanged and the browser stays silent.
          e.target.value = "";
        }}
        hidden
      />
      <button
        type="button"
        className={`btn source-btn ${className}`.trim()}
        onClick={() => inputRef.current?.click()}
      >
        {hasSource ? "↺ replace source" : "+ add source"}
      </button>
    </>
  );
}
