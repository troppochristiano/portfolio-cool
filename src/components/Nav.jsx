import { Link } from "react-router-dom";

// Fixed top header: the name on the left returns to the hero; the right-side
// shortcuts open the About overlay and scroll to that section. "Create" routes
// to the merged ASCII media converter at /create.
export function Nav({ onHome, onNavigate }) {
  return (
    <nav className="nav">
      <button type="button" className="nav__link" onClick={onHome}>
        Christian Bianchi
      </button>
      <div className="nav__links">
        <button
          type="button"
          className="nav__link"
          onClick={() => onNavigate("works")}
        >
          Works
        </button>
        <button
          type="button"
          className="nav__link"
          onClick={() => onNavigate("contact")}
        >
          Contact
        </button>
        <Link className="nav__link" to="/gallery">
          Gallery
        </Link>
        <Link className="nav__link" to="/create">
          Create
        </Link>
      </div>
    </nav>
  );
}
