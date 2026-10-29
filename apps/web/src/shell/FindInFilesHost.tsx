import { t as globalT, useT } from "@thinkrail/locales/react";
import { ResourcePreview, SOURCE_RENDERER_ID } from "@thinkrail/resource-renderers";
import { useMemo } from "react";
import {
	FindInFilesDialog,
	type FindInFilesHostState,
	type FindInFilesTarget,
	useFindInFiles,
} from "../findInFiles";
import { openFileAtLine } from "../panels/openTabs";
import {
	selectActiveWorkspace,
	selectContextProject,
	toast,
	useAppStore,
	workspaceName,
} from "../store";
import { errorText, getTransport, supportsTextSearch } from "../transport";

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

async function openMatch(target: FindInFilesTarget, keep: boolean): Promise<void> {
	const store = useAppStore.getState();
	if (!store.workspaces[target.projectId]?.length) {
		store.setWorkspaces(
			target.projectId,
			await getTransport().request("workspace.list", { projectId: target.projectId }),
		);
	}
	useAppStore
		.getState()
		.activateWorkspaceFromRoute({ id: target.workspaceId, projectId: target.projectId });
	await openFileAtLine(
		target.workspaceId,
		target.path,
		{ line: target.line, column: target.column, length: target.length },
		keep ? "keep" : "preview",
	);
}

const onOpen = (target: FindInFilesTarget, keep: boolean) => {
	void openMatch(target, keep).catch((error: unknown) =>
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
	const projectId = contextProject?.id;
	const workspaceId = activeWorkspace?.id;
	const context = useMemo(
		() =>
			projectId || workspaceId
				? { ...(projectId ? { projectId } : {}), ...(workspaceId ? { workspaceId } : {}) }
				: null,
		[projectId, workspaceId],
	);
	const scopeLabel = activeWorkspace
		? workspaceName(t, activeWorkspace)
		: (contextProject?.name ?? null);
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
