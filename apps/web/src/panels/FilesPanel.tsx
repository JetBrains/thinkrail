import { RiCollapseVerticalLine } from "@remixicon/react";
import { useT } from "@thinkrail/locales/react";
import { ToggleSegment } from "@thinkrail/ui/toggle-segment";
import { useEffect, useMemo, useRef, useState } from "react";
import { selectActiveFilePath, selectFilesTreeView, useAppStore } from "../store";
import { ChangesPanel } from "./ChangesPanel";
import {
	buildChangeMarks,
	buildChangesTree,
	type ChangeMarks,
	changeTreeFolderPaths,
} from "./changesModel";
import { FileTree } from "./FileTree";
import { HeaderIconButton } from "./HeaderIconButton";
import { RememberedScrollArea } from "./RememberedScrollArea";
import { useGitStatus } from "./useGitStatus";

export function FilesPanel({ workspaceId }: { workspaceId: string }) {
	const t = useT();
	const mode = useAppStore((s) => s.filesMode);
	const setMode = useAppStore((s) => s.setFilesMode);
	const changesView = useAppStore((s) => s.changesView);
	const { status, error, reload } = useGitStatus(workspaceId);
	const marks = useMemo(() => buildChangeMarks(status?.changes ?? []), [status]);
	const count = status?.changes.length ?? 0;
	const canCollapse = mode === "all" || (changesView === "tree" && count > 0);
	const collapseAll = () => {
		const store = useAppStore.getState();
		if (mode === "all") store.collapseAllFiles(workspaceId);
		else if (status) {
			store.setChangedTreeCollapsed(
				workspaceId,
				changeTreeFolderPaths(buildChangesTree(status.changes)),
				true,
			);
		}
	};

	return (
		<div className="flex h-full min-h-0 flex-col">
			<div
				data-testid="files-mode-toggle"
				role="toolbar"
				aria-label={t("panels.files.toolbar")}
				className="flex h-panel-header-row shrink-0 items-center gap-4 overflow-clip border-border-default border-b px-12"
			>
				<ToggleSegment
					testid="files-mode-all"
					label={t("panels.files.all")}
					active={mode === "all"}
					onClick={() => setMode("all")}
				/>
				<ToggleSegment
					testid="files-mode-changed"
					label={count > 0 ? t("panels.files.changedCount", { count }) : t("panels.files.changed")}
					active={mode === "changed"}
					onClick={() => setMode("changed")}
				/>
				{canCollapse ? (
					<div className="ml-auto flex shrink-0">
						<HeaderIconButton
							testid="files-collapse-all"
							label={t("panels.files.collapseAll")}
							onClick={collapseAll}
						>
							<RiCollapseVerticalLine className="size-14" />
						</HeaderIconButton>
					</div>
				) : null}
			</div>
			{mode === "all" ? (
				<AllFiles workspaceId={workspaceId} marks={marks} />
			) : (
				<div className="min-h-0 flex-1">
					<ChangesPanel workspaceId={workspaceId} status={status} error={error} reload={reload} />
				</div>
			)}
		</div>
	);
}

function AllFiles({ workspaceId, marks }: { workspaceId: string; marks: ChangeMarks }) {
	const activePath = useAppStore((s) => selectActiveFilePath(s, workspaceId));
	const [revealOnMount] = useState(
		() =>
			activePath !== null &&
			activePath !== selectFilesTreeView(useAppStore.getState(), workspaceId).seenActivePath,
	);
	const [revealTarget, setRevealTarget] = useState<string | null>(null);
	const previousActive = useRef<string | null | undefined>(revealOnMount ? undefined : activePath);

	useEffect(() => {
		const before = previousActive.current;
		previousActive.current = activePath;
		if (activePath === null || activePath === before) return;
		useAppStore.getState().revealInFiles(workspaceId, activePath);
		setRevealTarget(activePath);
	}, [activePath, workspaceId]);

	return (
		<RememberedScrollArea
			workspaceId={workspaceId}
			view="all"
			restore={!revealOnMount}
			className="min-h-0 flex-1"
			viewportClassName="p-panel-inset"
		>
			<FileTree
				workspaceId={workspaceId}
				marks={marks}
				activePath={activePath}
				revealTarget={revealTarget}
				onRevealed={() => setRevealTarget(null)}
			/>
		</RememberedScrollArea>
	);
}
