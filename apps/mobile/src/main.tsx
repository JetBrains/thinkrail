import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { followSystemTheme } from "./theme";
import "./index.css";

followSystemTheme();

const root = document.getElementById("root");
if (root)
	createRoot(root).render(
		<StrictMode>
			<App />
		</StrictMode>,
	);
