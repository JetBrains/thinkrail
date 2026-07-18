import "./index.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { Shell } from "./shell/Shell";
import { initTransport } from "./transport";
import { applyFontScale } from "./utils/fontScale";
import { applyTheme, readThemeHint } from "./utils/theme";

applyFontScale();
// Apply the cached theme before React mounts so the first paint matches; `server.welcome` reconciles it
// against the host's source-of-truth config a moment later.
applyTheme(readThemeHint());
initTransport();

const root = document.getElementById("root");
if (root) {
	createRoot(root).render(
		<StrictMode>
			{/* Last-resort boundary: a crash escaping every panel boundary shows a reload screen, not a gray unmounted root. */}
			<ErrorBoundary label="app">
				<Shell />
			</ErrorBoundary>
		</StrictMode>,
	);
}
