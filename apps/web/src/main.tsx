import "./index.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { initNavigation } from "./navigation";
import { Shell } from "./shell/Shell";
import { applyTheme, initializeBundledThemes, readThemeHint } from "./themes";
import { initTransport } from "./transport";

initializeBundledThemes();
applyTheme(readThemeHint());
initTransport();
initNavigation();

const root = document.getElementById("root");
if (root) {
	createRoot(root).render(
		<StrictMode>
			<ErrorBoundary label="app">
				<Shell />
			</ErrorBoundary>
		</StrictMode>,
	);
}
