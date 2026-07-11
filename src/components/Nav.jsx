import { useState } from "react";
import { Link } from "react-router-dom";
import { ScrambleText } from "./ScrambleText";

// Fixed top header: the name on the left returns to the hero; the right-side
// shortcuts open the About overlay and scroll to that section. "Create" routes
// to the merged ASCII media converter at /create. On narrow viewports (≤860px)
// the shortcuts collapse behind a "menu" pill and drop down as a column, so
// they never wrap over the hero.
export function Nav({ onHome, onNavigate }) {
  const [menuOpen, setMenuOpen] = useState(false);
  // Every navigation closes the menu so it isn't left hanging open when the
  // About overlay (which covers the nav) closes again.
  const go = (fn) => () => {
    setMenuOpen(false);
    fn();
  };
  return (
    <nav className={`nav${menuOpen ? " nav--open" : ""}`}>
      <button type="button" className="nav__link" onClick={go(onHome)}>
        <ScrambleText text="Christian Bianchi" />
      </button>
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
          <Link className="nav__link" to="/gallery">
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
