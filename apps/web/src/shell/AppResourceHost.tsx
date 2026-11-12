import { MAX_SEARCH_PREVIEW_BYTES } from "@thinkrail/contracts";
import { t } from "@thinkrail/locales/react";
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
import { CODE_LANGUAGES, codeLanguageId } from "../lib/codeLanguages";
import { openFileComparisonInTab, openFileInTab } from "../panels/openTabs";
import { resourceBytesUrl } from "../panels/resourcePane";
import { SendReviewButton } from "../panels/SendReviewButton";
import { useFileReview } from "../panels/useReviewCommenting";
import {
	selectFileChangeSince,
	selectHostSearchReady,
	selectWorkspaceById,
	useAppStore,
} from "../store";
import { resolveThinkrailEditorTheme, THINKRAIL_PIERRE_THEME } from "../themes";
import { getTransport, wsErrorCode } from "../transport";

registerBundledResourceRenderers();

function FileReview({ workspaceId, path, kind, sessionId, children }: ResourceFileReviewProps) {
	const review = useFileReview(workspaceId, path, kind, undefined, sessionId).worktree;
	const reviewable = useAppStore(
		(state) => selectWorkspaceById(state, workspaceId)?.kind !== "chat",
	);
	return children(reviewable ? review : undefined);
}

function ReviewSend({ workspaceId, paths, sessionId }: ResourceReviewSendProps) {
	return <SendReviewButton workspaceId={workspaceId} path={paths} chatSessionId={sessionId} />;
}

const HOST: ResourceHost = {
	markdown: Markdown,
	code: {
		languages: CODE_LANGUAGES,
		languageId: codeLanguageId,
		editorTheme: (readVariable) =>
			resolveThinkrailEditorTheme({ readVariable, toHex: cssColorToHex }),
		pierreTheme: THINKRAIL_PIERRE_THEME,
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

function cappedBytesUrl(workspaceId: string, path: string, oid?: string | null): string {
	const url = resourceBytesUrl(workspaceId, path, oid);
	return `${url}${url.includes("?") ? "&" : "?"}maxBytes=${MAX_SEARCH_PREVIEW_BYTES}`;
}

export const PALETTE_PREVIEW_HOST: ResourceHost = {
	...HOST,
	bytesUrl: cappedBytesUrl,
	readFile: (workspaceId, path) => {
		if (!selectHostSearchReady(useAppStore.getState())) {
			return Promise.reject(new Error(t("search.palette.previewOffline")));
		}
		return getTransport()
			.request("fs.readFile", { workspaceId, path, maxBytes: MAX_SEARCH_PREVIEW_BYTES })
			.catch((error: unknown) => {
				throw wsErrorCode(error) === "FILE_TOO_LARGE"
					? new Error(t("search.palette.previewTooLarge"))
					: error;
			});
	},
	subscribeFileChanges: (workspaceId, onChange) =>
		useAppStore.subscribe((state, previous) => {
			if (!selectHostSearchReady(state)) return;
			if (
				!selectHostSearchReady(previous) ||
				state.welcomeGeneration !== previous.welcomeGeneration
			) {
				onChange(null);
				return;
			}
			const paths = selectFileChangeSince(state, previous, workspaceId);
			if (paths !== undefined) onChange(paths);
		}),
};

export function AppResourceHost({ children }: { children: ReactNode }) {
	const fileLineWidth = useAppStore((state) => state.fileLineWidth);
	const fileLineWidthBounded = useAppStore((state) => state.fileLineWidthBounded);
	const markdownOutlineVisible = useAppStore((state) => state.markdownOutlineVisible);
	const markdownOutlineSide = useAppStore((state) => state.markdownOutlineSide);
	const setMarkdownOutlineVisible = useAppStore((state) => state.setMarkdownOutlineVisible);
	const mobile = usePhoneViewport();
	const preferences = useMemo<ResourcePreferences>(
		() => ({
			fileLineWidth,
			fileLineWidthBounded,
			markdownOutlineVisible,
			setMarkdownOutlineVisible,
			markdownOutlineSide,
		}),
		[
			fileLineWidth,
			fileLineWidthBounded,
			markdownOutlineVisible,
			setMarkdownOutlineVisible,
			markdownOutlineSide,
		],
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
