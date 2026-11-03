import {
	type ResourceEnvironment,
	ResourceEnvironmentProvider,
	type ResourceFileReviewProps,
	type ResourceHost,
	ResourceHostProvider,
	type ResourcePreferences,
	ResourcePreferencesProvider,
	type ResourceReviewSendProps,
	registerBundledResourceRenderers,
} from "@thinkrail/resource-renderers";
import { type ReactNode, useMemo } from "react";
import { Markdown } from "../chat/Markdown";
import { cssColorToHex, usePhoneViewport } from "../lib";
import { SHIKI_FILE_LANGUAGES, shikiLanguageId } from "../lib/highlighter";
import { openFileComparisonInTab, openFileInTab } from "../panels/openTabs";
import { resourceBytesUrl } from "../panels/resourcePane";
import { SendReviewButton } from "../panels/SendReviewButton";
import { useFileReview } from "../panels/useReviewCommenting";
import { selectFileChangeSince, useAppStore } from "../store";
import { resolveThinkrailShikiTheme } from "../themes";
import { getTransport } from "../transport";

registerBundledResourceRenderers();

function FileReview({ workspaceId, path, kind, sessionId, children }: ResourceFileReviewProps) {
	return children(useFileReview(workspaceId, path, kind, undefined, sessionId).worktree);
}

function ReviewSend({ workspaceId, paths, sessionId }: ResourceReviewSendProps) {
	return <SendReviewButton workspaceId={workspaceId} path={paths} chatSessionId={sessionId} />;
}

const HOST: ResourceHost = {
	markdown: Markdown,
	code: {
		languages: SHIKI_FILE_LANGUAGES,
		languageId: shikiLanguageId,
		theme: (options) => resolveThinkrailShikiTheme({ ...options, toHex: cssColorToHex }),
	},
	bytesUrl: resourceBytesUrl,
	openFile: (workspaceId, path, options) => {
		void openFileInTab(workspaceId, path, options?.keep ? "keep" : "preview");
	},
	openComparison: (workspaceId, before, path) => {
		void openFileComparisonInTab(workspaceId, before, path, "keep");
	},
	readFile: (workspaceId, path) => getTransport().request("fs.readFile", { workspaceId, path }),
	subscribeFileChanges: (workspaceId, onChange) =>
		useAppStore.subscribe((state, previous) => {
			const paths = selectFileChangeSince(state, previous, workspaceId);
			if (paths !== undefined) onChange(paths);
		}),
	FileReview,
	ReviewSend,
};

export function AppResourceHost({ children }: { children: ReactNode }) {
	const fileLineWidth = useAppStore((state) => state.fileLineWidth);
	const fileLineWidthBounded = useAppStore((state) => state.fileLineWidthBounded);
	const mobile = usePhoneViewport();
	const preferences = useMemo<ResourcePreferences>(
		() => ({ fileLineWidth, fileLineWidthBounded }),
		[fileLineWidth, fileLineWidthBounded],
	);
	const environment = useMemo<ResourceEnvironment>(() => ({ mobile }), [mobile]);
	return (
		<ResourceHostProvider value={HOST}>
			<ResourcePreferencesProvider value={preferences}>
				<ResourceEnvironmentProvider value={environment}>{children}</ResourceEnvironmentProvider>
			</ResourcePreferencesProvider>
		</ResourceHostProvider>
	);
}
