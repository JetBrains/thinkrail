import {
	type ResourceHost,
	ResourceHostProvider,
	type ResourcePreferences,
	ResourcePreferencesProvider,
	registerBundledResourceRenderers,
} from "@thinkrail/resource-renderers";
import { type ReactNode, useMemo } from "react";
import { Markdown } from "../chat/Markdown";
import { cssColorToHex } from "../lib";
import { SHIKI_FILE_LANGUAGES, shikiLanguageId } from "../lib/highlighter";
import { openFileInTab } from "../panels/openTabs";
import { resourceBytesUrl } from "../panels/resourcePane";
import { useAppStore } from "../store";
import { resolveThinkrailShikiTheme } from "../themes";

registerBundledResourceRenderers();

const HOST: ResourceHost = {
	markdown: Markdown,
	code: {
		languages: SHIKI_FILE_LANGUAGES,
		languageId: shikiLanguageId,
		theme: (options) => resolveThinkrailShikiTheme({ ...options, toHex: cssColorToHex }),
	},
	bytesUrl: resourceBytesUrl,
	openFile: (workspaceId, path) => {
		void openFileInTab(workspaceId, path, "preview");
	},
};

export function AppResourceHost({ children }: { children: ReactNode }) {
	const fileLineWidth = useAppStore((state) => state.fileLineWidth);
	const fileLineWidthBounded = useAppStore((state) => state.fileLineWidthBounded);
	const preferences = useMemo<ResourcePreferences>(
		() => ({ fileLineWidth, fileLineWidthBounded }),
		[fileLineWidth, fileLineWidthBounded],
	);
	return (
		<ResourceHostProvider value={HOST}>
			<ResourcePreferencesProvider value={preferences}>{children}</ResourcePreferencesProvider>
		</ResourceHostProvider>
	);
}
