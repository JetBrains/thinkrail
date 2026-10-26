import "./index.css";
import { useT } from "@thinkrail/locales/react";
import { TooltipProvider } from "@thinkrail/ui/tooltip";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { initChatPreferencesPersistence } from "./chat/chatPreferences";
import { initModelVisibilityPersistence } from "./chat/modelVisibility";
import { ErrorBoundary, setErrorBoundaryReporter } from "./components/ErrorBoundary";
import { useLocaleSync } from "./i18n";
import { initNavigation } from "./navigation";
import { initFilesTreePersistence } from "./panels/filesTreeState";
import { initProjectExpansionPersistence } from "./panels/projectExpansion";
import { initProjectOrderPersistence } from "./panels/projectOrder";
import { AppResourceHost } from "./shell/AppResourceHost";
import { Shell } from "./shell/Shell";
import { applyThemePreference, initializeBundledThemes, readThemeHint } from "./themes";
import {
	clientErrorReport,
	initTransport,
	installClientErrorReporting,
	reportClientError,
} from "./transport";

initializeBundledThemes();
applyThemePreference(readThemeHint());
initTransport();
installClientErrorReporting();
setErrorBoundaryReporter((error, reportId) =>
	reportClientError(clientErrorReport("render", error, reportId)),
);
initChatPreferencesPersistence();
initModelVisibilityPersistence();
initProjectExpansionPersistence();
initProjectOrderPersistence();
initFilesTreePersistence();
initNavigation();

function App() {
	useLocaleSync();
	const t = useT();
	return (
		<ErrorBoundary label={t("app.errorBoundary.label")} reportId="app">
			<TooltipProvider delayDuration={250} skipDelayDuration={400}>
				<AppResourceHost>
					<Shell />
				</AppResourceHost>
			</TooltipProvider>
		</ErrorBoundary>
	);
}

const root = document.getElementById("root");
if (root) {
	createRoot(root).render(
		<StrictMode>
			<App />
		</StrictMode>,
	);
}
