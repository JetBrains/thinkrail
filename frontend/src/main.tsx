import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { Root } from "./Root.tsx";
import { applyTheme, getThemePreference } from "./utils/theme.ts";
import "./styles/global.css";

applyTheme(getThemePreference());

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <Root />
    </BrowserRouter>
  </StrictMode>,
);
