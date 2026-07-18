import { useState } from "react";
import { Link } from "react-router-dom";
import { ScrambleText } from "./ScrambleText";

// Fixed top header around the ▙▟ brand mark (rendered by App as .brand-logo so
// it can sit above the About overlay). One set of links serves both layouts:
// on desktop the menu wrappers collapse away (display:contents) and the pills
// sit directly in the bar — Works/Contact left, Gallery/Create pushed to the
// right edge by .nav__push — while the logo floats centered. On narrow
// viewports (≤860px) the logo docks to the left corner and all four links
// collapse behind the "menu" pill on the right, dropping down as a column.
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
          {menuOpen ? "✕ close" : "☰ menu"}
        </button>
        <div className="nav__links" id="nav-links">
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
    </nav>
  );
}
