import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import App from "./App";
import Create from "./pages/Create";
import "./styles/global.css";

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        {/* Home — the hero + ambient gallery + About overlay, unchanged. */}
        <Route path="/" element={<App />} />
        {/* The merged ASCII media converter. */}
        <Route path="/create" element={<Create />} />
      </Routes>
    </BrowserRouter>
  </StrictMode>
);
