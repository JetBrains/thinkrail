import "./index.css";
import { useT } from "@thinkrail/locales/react";
import { TooltipProvider } from "@thinkrail/ui/tooltip";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { initChatPreferencesPersistence } from "./chat/chatPreferences";
import { initModelVisibilityPersistence } from "./chat/modelVisibility";
import { getStablePreferenceAdapter } from "./clientPreferences";
import { ErrorBoundary, setErrorBoundaryReporter } from "./components/ErrorBoundary";
import {
	followInstalledWebExtensions,
	installExtensionHost,
	registerWebExtensions,
} from "./extensions";
import { initializeFonts } from "./fonts";
import { useLocaleSync } from "./i18n";
import { initNavigation } from "./navigation";
import { initFilesTreePersistence } from "./panels/filesTreeState";
import { initProjectExpansionPersistence } from "./panels/projectExpansion";
import { initSearchPreferences } from "./search";
import { AppResourceHost } from "./shell/AppResourceHost";
import { initArtifactsPersistence } from "./shell/artifactsPreference";
import { installDeepLinks } from "./shell/deepLink";
import { initDiffWrapPersistence } from "./shell/diffWrapPreference";
import { initMarkdownOutlinePersistence } from "./shell/markdownOutlinePreference";
import { preferenceStorage, readPreference, writePreference } from "./shell/preferenceStorage";
import { Shell } from "./shell/Shell";
import { DictationLayer } from "./speech";
import { selectInstalledWebHalves, useAppStore } from "./store";
import { applyThemePreference, initializeThemes, readThemeHint } from "./themes";
import {
	clientErrorReport,
	initTransport,
	installClientErrorReporting,
	reportClientError,
} from "./transport";

initializeThemes();
applyThemePreference(readThemeHint());
initializeFonts();
initTransport();
installClientErrorReporting();
setErrorBoundaryReporter((error, reportId) =>
	reportClientError(clientErrorReport("render", error, reportId)),
);
initChatPreferencesPersistence();
initModelVisibilityPersistence();
initProjectExpansionPersistence();
initFilesTreePersistence();
initSearchPreferences();
initDiffWrapPersistence();
initMarkdownOutlinePersistence();
initArtifactsPersistence();
initNavigation();
installDeepLinks();
installExtensionHost();
registerWebExtensions();
const INSTALLED_WEB_HALVES_KEY = "installed-web-halves";
const preferences = preferenceStorage(getStablePreferenceAdapter());
const installedWebHalvesReady = followInstalledWebExtensions({
	current: () => selectInstalledWebHalves(useAppStore.getState()),
	unreachable: () => {
		const state = useAppStore.getState();
		return state.status === "disconnected" || state.extensionCatalog === "failed";
	},
	subscribe: (listener) =>
		useAppStore.subscribe((state, previous) => {
			if (
				state.extensionCatalog !== previous.extensionCatalog ||
				state.protocolVersion !== previous.protocolVersion ||
				state.status !== previous.status
			) {
				listener();
			}
		}),
	rememberedAny: () => readPreference(preferences, INSTALLED_WEB_HALVES_KEY) === "true",
	remember: (any) => writePreference(preferences, INSTALLED_WEB_HALVES_KEY, String(any)),
});

function App() {
	useLocaleSync();
	const t = useT();
	return (
		<ErrorBoundary label={t("app.errorBoundary.label")} reportId="app">
			<TooltipProvider delayDuration={250} skipDelayDuration={400}>
				<AppResourceHost>
					<Shell />
				</AppResourceHost>
				<DictationLayer />
			</TooltipProvider>
		</ErrorBoundary>
	);
}

void installedWebHalvesReady.finally(() => {
	const root = document.getElementById("root");
	if (!root) return;
	createRoot(root).render(
		<StrictMode>
			<App />
		</StrictMode>,
	);
});
