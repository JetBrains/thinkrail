import "./index.css";
import { TooltipProvider } from "@thinkrail/ui/tooltip";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { initChatPreferencesPersistence } from "./chat/chatPreferences";
import { initModelVisibilityPersistence } from "./chat/modelVisibility";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { getLocale, t } from "./i18n";
import { initNavigation } from "./navigation";
import { initFilesTreePersistence } from "./panels/filesTreeState";
import { initProjectExpansionPersistence } from "./panels/projectExpansion";
import { AppResourceHost } from "./shell/AppResourceHost";
import { Shell } from "./shell/Shell";
import { applyThemePreference, initializeBundledThemes, readThemeHint } from "./themes";
import { initTransport } from "./transport";

// Declare the interface language before first paint: `lang` drives CJK font selection, hyphenation and
// screen-reader pronunciation, and the static `lang="en"` in index.html is only the pre-boot default.
document.documentElement.lang = getLocale();

initializeBundledThemes();
applyThemePreference(readThemeHint());
initTransport();
initChatPreferencesPersistence();
initModelVisibilityPersistence();
initProjectExpansionPersistence();
initFilesTreePersistence();
initNavigation();

const root = document.getElementById("root");
if (root) {
	createRoot(root).render(
		<StrictMode>
			<ErrorBoundary label={t("app")}>
				<TooltipProvider delayDuration={250} skipDelayDuration={400}>
					<AppResourceHost>
						<Shell />
					</AppResourceHost>
				</TooltipProvider>
			</ErrorBoundary>
		</StrictMode>,
	);
}
