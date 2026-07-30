import { useState } from "react";
import { Link } from "react-router-dom";
import { ScrambleText } from "./ScrambleText";
import { DecodeSwap } from "./DecodeSwap";

// Fixed top header around the ▙▟ brand mark (rendered by App as .brand-logo so
// it can sit above the About overlay). One set of links serves both layouts:
// on desktop the menu wrappers collapse away (display:contents) and the pills
// sit directly in the bar — Works/Contact left, Gallery/Create pushed to the
// right edge by .nav__push — while the logo floats centered. On narrow
// viewports (≤860px) the logo docks to the left corner and all four links
// collapse into ONE blue block on the right: a header row (label + bar icon)
// with the links stacked under it, the whole thing sharing a single surface
// rather than reading as five loose pills.
//
// Three animations carry the open, all keyed off .nav--open (CSS in
// global.css): the icon's three bars fold into an ✕, the label decodes
// "menu" ⇄ "close" through pool noise (DecodeSwap), and the link stack grows
// out from under the header on a 0fr→1fr row while its items fade up in
// sequence.
export function Nav({ onNavigate }) {
  const [menuOpen, setMenuOpen] = useState(false);
  // Every navigation closes the menu so it isn't left hanging open when the
  // About overlay (which covers the nav) closes again.
  const go = (fn) => () => {
    setMenuOpen(false);
    fn();
  };
  return (
    <nav className={`nav${menuOpen ? " nav--open" : ""}`}>
      <div className="nav__menu">
        <button
          type="button"
          className="nav__link nav__toggle"
          aria-expanded={menuOpen}
          aria-controls="nav-links"
          onClick={() => setMenuOpen((o) => !o)}
        >
          <DecodeSwap text={menuOpen ? "close" : "menu"} />
          {/* Three bars that fold into an ✕ — presentation only, the label
              beside it is the accessible name. */}
          <span className="nav__icon" aria-hidden="true">
            <span className="nav__icon-bar" />
            <span className="nav__icon-bar" />
            <span className="nav__icon-bar" />
          </span>
        </button>
        {/* Two nested wrappers so the stack can animate on mobile while both
            collapse to display:contents on desktop: .nav__links is the 0fr→1fr
            grid row, __stack the clipped column inside it. */}
        <div className="nav__links" id="nav-links">
          <div className="nav__stack">
            <button
              type="button"
              className="nav__link"
              onClick={go(() => onNavigate("works"))}
            >
              <ScrambleText text="Works" />
            </button>
            <button
              type="button"
              className="nav__link"
              onClick={go(() => onNavigate("contact"))}
            >
              <ScrambleText text="Contact" />
            </button>
            <Link className="nav__link nav__push" to="/gallery">
              <ScrambleText text="Gallery" />
            </Link>
            <Link className="nav__link" to="/create">
              <ScrambleText text="Create" />
            </Link>
          </div>
        </div>
      </div>
    </nav>
  );
}
