import { useEffect } from "react";
import { useLocation } from "react-router-dom";

// Renders nothing — it just keeps <title> in step with the route. The app is a
// single HTML shell, so without this every route inherits index.html's title
// and the tab reads the same everywhere (bookmarks and history too).
//
// The home title stays "CHRISTIAN BIANCHI | FRONTEND DEVELOPER"; every other
// route puts its own name first so the tab is readable when narrow.
const BRAND = "CHRISTIAN BIANCHI";

const TITLES = {
  "/": `${BRAND} | FRONTEND DEVELOPER`,
  "/create": `CREATE | ${BRAND}`,
  "/gallery": `GALLERY | ${BRAND}`,
  "/admin": `ADMIN | ${BRAND}`,
  "/admin/create": `ADMIN CREATE | ${BRAND}`,
};

export default function RouteTitle() {
  const { pathname } = useLocation();

  useEffect(() => {
    // Trailing slashes and casing shouldn't miss the map ("/Create/" === "/create").
    const key = pathname.toLowerCase().replace(/\/+$/, "") || "/";
    document.title = TITLES[key] ?? TITLES["/"];
  }, [pathname]);

  return null;
}
