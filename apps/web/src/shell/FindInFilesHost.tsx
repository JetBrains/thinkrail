import { t as globalT, useT } from "@thinkrail/locales/react";
import { ResourcePreview, SOURCE_RENDERER_ID } from "@thinkrail/resource-renderers";
import { useMemo } from "react";
import {
	FindInFilesDialog,
	type FindInFilesHostState,
	type FindInFilesTarget,
	useFindInFiles,
} from "../findInFiles";
import { chatDisplayName } from "../lib";
import {
	isChatWorkspace,
	selectActiveWorkspace,
	selectChatWorkspaceFirstPrompt,
	selectChatWorkspaceTitle,
	selectContextProject,
	selectHasTextSearchScope,
	toast,
	useAppStore,
	workspaceName,
} from "../store";
import { errorText, supportsTextSearch } from "../transport";
import { openFindInFilesMatch } from "./findInFilesOpen";

const keepSourceRenderer = () => {};

function renderPreview(target: FindInFilesTarget) {
	return (
		<ResourcePreview
			key={`${target.workspaceId}\u0000${target.path}`}
			workspaceId={target.workspaceId}
			path={target.path}
			rendererId={SOURCE_RENDERER_ID}
			onRendererId={keepSourceRenderer}
			reveal={{ line: target.line, column: target.column, length: target.length, tick: 1 }}
			leading={
				<span
					data-testid="find-in-files-preview-path"
					className="truncate tr-code-text-small text-text-muted"
				>
					{target.path}:{target.line}
				</span>
			}
			className="h-full min-h-0"
		/>
	);
}

const onOpen = (target: FindInFilesTarget, keep: boolean) => {
	void openFindInFilesMatch(target, keep).catch((error: unknown) =>
		toast.error(errorText(error, globalT("findInFiles.openFailed"))),
	);
};

export function FindInFilesHost() {
	const t = useT();
	const open = useFindInFiles((state) => state.open);
	const contextProject = useAppStore(selectContextProject);
	const activeWorkspace = useAppStore(selectActiveWorkspace);
	const host = useAppStore(
		(state): FindInFilesHostState =>
			state.status !== "connected"
				? "offline"
				: supportsTextSearch(state.protocolVersion)
					? "ready"
					: "unsupported",
	);
	const connection = useAppStore((state) => state.welcomeGeneration);
	const scoped = useAppStore(selectHasTextSearchScope);
	const projectId = contextProject?.id;
	const workspaceId = activeWorkspace?.id;
	const context = useMemo(
		() =>
			scoped
				? { ...(projectId ? { projectId } : {}), ...(workspaceId ? { workspaceId } : {}) }
				: null,
		[scoped, projectId, workspaceId],
	);
	const scopeLabel = useAppStore((state) => {
		if (!scoped) return null;
		if (!activeWorkspace) return contextProject?.name ?? null;
		if (!isChatWorkspace(activeWorkspace)) return workspaceName(t, activeWorkspace);
		return chatDisplayName(
			t,
			selectChatWorkspaceTitle(state, activeWorkspace.id),
			selectChatWorkspaceFirstPrompt(state, activeWorkspace.id),
		);
	});
	if (!open) return null;
	return (
		<FindInFilesDialog
			context={context}
			scopeLabel={scopeLabel}
			host={host}
			connection={connection}
			onOpen={onOpen}
			renderPreview={renderPreview}
		/>
	);
}
