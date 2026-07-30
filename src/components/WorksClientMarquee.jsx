// Auto-scrolling client strip for the cobrains panel. Pure CSS marquee: the
// track holds the list twice and a keyframe slides it -50%, so the second copy
// lands exactly where the first began (spacing lives on the items as
// margin-right — a flex gap would break the -50% loop math at the seam).
//
// `clients` entries are either a plain string (wordmark, the fallback when a
// logo file doesn't exist) or `{ name, src }` for a real logo. Logos are
// height-locked by .works-marquee__item img and flattened to the strip's ink
// colour in CSS, so a dozen brand palettes can't fight the dark panel.
//
// The line that introduces the strip is NOT rendered here — it sits above
// this block as a panel-level grid item, so it reads as a label over the
// section's rule rather than as the first thing inside it.
export function WorksClientMarquee({ clients, label = "Clients" }) {
  return (
    <div className="works-marquee" aria-label={label}>
      <div className="works-marquee__track">
        {[...clients, ...clients].map((client, i) => {
          // The second copy exists only to make the loop seamless — it is
          // hidden from assistive tech, so its logo takes an empty alt.
          const duplicate = i >= clients.length;
          const name = typeof client === "string" ? client : client.name;
          const src = typeof client === "string" ? null : client.src;
          return (
            <span
              key={`${name}-${i}`}
              className="works-marquee__item"
              aria-hidden={duplicate || undefined}
            >
              {src ? (
                // Lazy: the strip lives inside the collapsed panel, so the
                // logos only cost a request once the row is actually opened.
                <img src={src} alt={duplicate ? "" : name} loading="lazy" />
              ) : (
                name
              )}
            </span>
          );
        })}
      </div>
    </div>
  );
}
