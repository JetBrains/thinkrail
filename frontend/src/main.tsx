import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { Root } from "./Root.tsx";
import { PRODUCT_NAME } from "./constants/branding.ts";
import "./styles/global.css";

document.title = PRODUCT_NAME;

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <Root />
    </BrowserRouter>
  </StrictMode>,
);
