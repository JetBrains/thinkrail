import "./index.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { initNavigation } from "./navigation";
import { initProjectExpansionPersistence } from "./panels/projectExpansion";
import { Shell } from "./shell/Shell";
import { applyTheme, initializeBundledThemes, readThemeHint } from "./themes";
import { initTransport } from "./transport";

initializeBundledThemes();
applyTheme(readThemeHint());
initTransport();
initProjectExpansionPersistence();
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
