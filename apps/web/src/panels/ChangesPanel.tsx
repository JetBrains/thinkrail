import type { GitStatus } from "@thinkrail/contracts";
import { useT } from "@thinkrail/locales/react";
import { LoadingRegion } from "@thinkrail/ui/skeleton";
import { ToggleSegment } from "@thinkrail/ui/toggle-segment";
import { useCallback, useEffect, useMemo, useState } from "react";
import { firstClickOnly } from "../lib";
import {
	type CenterNavigationStamp,
	type ChangesTab,
	type EditorTab,
	isCenterNavigationCurrent,
	isFileComparison,
	matchesWorktreePath,
	selectActiveEditorTab,
	selectDiffBaseRef,
	selectDiffScope,
	selectFilesTreeView,
	selectWorkspaceById,
	selectWorkspaceNavTick,
	type TabIntent,
	toast,
	useAppStore,
} from "../store";
import { errorText, getTransport } from "../transport";
import { BranchPicker } from "./BranchPicker";
import { useBranchList } from "./branches";
import { ChangeRowActions } from "./ChangeRowActions";
import { ChangesScopeMenu } from "./ChangesScopeMenu";
import { ChangesTree } from "./ChangesTree";
import { changesTabId, scopeKey, splitPath, statusNameClass } from "./changesModel";
import { DiffStatBadge } from "./DiffStatBadge";
import { openChangesTab, openDiffInTab } from "./openTabs";
import { RememberedScrollArea } from "./RememberedScrollArea";
import { ViewedMark } from "./ViewedMark";

function selectReviewTab(
	state: { tabsByWorkspace: Record<string, EditorTab[]> },
	workspaceId: string,
	id: string,
): ChangesTab | undefined {
	return (state.tabsByWorkspace[workspaceId] ?? []).find(
		(tab): tab is ChangesTab => tab.id === id && tab.kind === "changes",
	);
}

export function ChangesPanel({
	workspaceId,
	status,
	error,
	reload,
}: {
	workspaceId: string;
	status: GitStatus | null;
	error: string | null;
	reload: () => void;
}) {
	const t = useT();
	const changesRequest = useAppStore((s) => s.changesRequest);
	const changesView = useAppStore((s) => s.changesView);
	const setChangesView = useAppStore((s) => s.setChangesView);
	const setDiffScope = useAppStore((s) => s.setDiffScope);
	const scope = useAppStore((s) => selectDiffScope(s, workspaceId));
	const workspace = useAppStore((s) => selectWorkspaceById(s, workspaceId));
	const baseRef = useAppStore((s) => selectDiffBaseRef(s, workspaceId));
	const viewKey = `${scopeKey(scope)}:${baseRef}`;
	const [highlight, setHighlight] = useState<{ key: string; path: string } | null>(null);
	const highlighted = highlight?.key === viewKey ? highlight.path : null;
	const setHighlighted = useCallback(
		(path: string | null) => setHighlight(path === null ? null : { key: viewKey, path }),
		[viewKey],
	);
	const activeDiffTab = useAppStore((state) => {
		const tab = selectActiveEditorTab(state, workspaceId);
		return tab?.kind === "diff" && !isFileComparison(tab) ? tab : null;
	});
	const reviewTabId = changesTabId(workspaceId, scope);
	const reviewActivePath = useAppStore(
		(state) => selectReviewTab(state, workspaceId, reviewTabId)?.activePath,
	);
	const reviewViewed = useAppStore(
		(state) => selectReviewTab(state, workspaceId, reviewTabId)?.viewed,
	);
	const reviewTabActive = useAppStore(
		(state) => state.activeTabByWorkspace[workspaceId] === reviewTabId,
	);
	const viewed = useMemo(() => new Set(reviewViewed ?? []), [reviewViewed]);
	const collapsedList = useAppStore((s) => selectFilesTreeView(s, workspaceId).changedCollapsed);
	const collapsed = useMemo(() => new Set(collapsedList), [collapsedList]);

	const {
		branches,
		failed: branchesFailed,
		refreshing: branchesRefreshing,
		refresh: refreshBranches,
	} = useBranchList(workspace?.projectId ?? null);

	const pointAt = async (ref: string) => {
		try {
			await getTransport().request("workspace.setDiffBase", { id: workspaceId, ref });
		} catch (error) {
			toast.error(t("changes.panel.setBaseFailed", { error: errorText(error) }));
		}
	};

	const openDiff = useCallback(
		(
			path: string,
			intent: TabIntent,
			navigation?: CenterNavigationStamp | null,
			claimPreview = false,
		) => {
			setHighlighted(path);
			if (intent === "keep") {
				void openDiffInTab(workspaceId, scope, path, intent, navigation, { claimPreview });
				return;
			}
			void openChangesTab(workspaceId, scope, { revealPath: path }, intent, navigation);
		},
		[workspaceId, scope, setHighlighted],
	);

	useEffect(() => {
		if (changesRequest?.workspaceId !== workspaceId) return;
		if (useAppStore.getState().changesRequest !== changesRequest) return;
		const want = changesRequest.path;
		const currentState = useAppStore.getState();
		const overtaken = changesRequest.navigation
			? !isCenterNavigationCurrent(currentState, workspaceId, changesRequest.navigation)
			: selectWorkspaceNavTick(currentState, workspaceId) !== changesRequest.navTick;
		if (want === null) {
			if (!overtaken) {
				void openChangesTab(workspaceId, scope, {}, "preview", changesRequest.navigation);
			}
		} else {
			if (!status) return;
			const match = status.changes.find((c) => matchesWorktreePath(want, c.path));
			if (match && !overtaken) openDiff(match.path, "preview", changesRequest.navigation);
			else setHighlighted(match ? match.path : want);
		}
		useAppStore.getState().clearChangesRequest();
	}, [changesRequest, status, workspaceId, openDiff, scope, setHighlighted]);

	useEffect(() => {
		if (activeDiffTab || reviewTabActive) setHighlighted(null);
	}, [activeDiffTab, reviewTabActive, setHighlighted]);

	const isActive = (path: string) =>
		reviewTabActive && reviewActivePath !== undefined
			? reviewActivePath === path
			: activeDiffTab
				? activeDiffTab.path === path && scopeKey(activeDiffTab.scope) === scopeKey(scope)
				: highlighted === path;
	const isViewed = (path: string) => viewed.has(path);

	return (
		<div className="flex h-full min-h-0 flex-col">
			<div
				data-testid="changes-view-toggle"
				role="toolbar"
				aria-label={t("changes.panel.toolbar")}
				className="flex h-panel-header-row shrink-0 items-center gap-4 overflow-clip border-border-default border-b px-12"
			>
				<div className="mr-auto flex min-w-0 items-center gap-4">
					<ChangesScopeMenu
						key={`${workspaceId}:${baseRef}`}
						workspaceId={workspaceId}
						scope={scope}
						onSelectScope={(next) => setDiffScope(workspaceId, next)}
					/>
					{workspace ? (
						<BranchPicker
							branches={branches}
							failed={branchesFailed}
							selected={baseRef}
							refreshing={branchesRefreshing}
							label={t("changes.panel.versus")}
							testid="changes-target-picker"
							triggerClassName="flex h-24 min-w-0 max-w-[200px] items-center gap-4 rounded-sm px-4 outline-none transition-colors hover:bg-control-bg-hovered focus-visible:ring-2 focus-visible:ring-primary data-[open=true]:bg-control-bg-selected"
							onSelect={(ref) => void pointAt(ref)}
							onRefresh={refreshBranches}
						/>
					) : null}
				</div>
				<ToggleSegment
					testid="changes-toggle-list"
					label={t("changes.panel.list")}
					active={changesView === "list"}
					onClick={() => setChangesView("list")}
				/>
				<ToggleSegment
					testid="changes-toggle-tree"
					label={t("changes.panel.tree")}
					active={changesView === "tree"}
					onClick={() => setChangesView("tree")}
				/>
			</div>
			<RememberedScrollArea
				key={`${changesView}:${viewKey}`}
				workspaceId={workspaceId}
				view={changesView === "tree" ? "changedTree" : "changedList"}
				scope={viewKey}
				className="min-h-0 flex-1"
				viewportClassName="p-panel-inset"
			>
				{status === null && error !== null ? (
					<div data-testid="changes-error" className="flex flex-col items-start gap-4 px-8 py-4">
						<p className="tr-text-metadata text-feedback-error">
							{t("changes.readFailed", { error })}
						</p>
						<button
							type="button"
							data-testid="changes-retry"
							onClick={reload}
							className="rounded-sm px-4 py-2 tr-text-metadata text-text-muted transition-colors hover:bg-control-bg-hovered hover:text-text-default"
						>
							{t("common.retry")}
						</button>
					</div>
				) : status === null ? (
					<LoadingRegion rows={5} className="px-8 py-4" />
				) : status.changes.length === 0 ? (
					<p data-testid="changes-empty" className="px-8 py-4 tr-text-metadata text-text-muted">
						{t("changes.empty")}
					</p>
				) : changesView === "tree" ? (
					<ChangesTree
						changes={status.changes}
						onOpen={(path, intent, claimPreview) => openDiff(path, intent, undefined, claimPreview)}
						isActive={isActive}
						isViewed={isViewed}
						isCollapsed={(path) => collapsed.has(path)}
						onSetCollapsed={(path, next) =>
							useAppStore.getState().setChangedTreeCollapsed(workspaceId, [path], next)
						}
					/>
				) : (
					<ul className="motion-safe:animate-reveal">
						{status.changes.map((change) => {
							const { dir, base } = splitPath(change.path);
							return (
								<li key={change.path}>
									<ChangeRowActions
										path={change.path}
										active={isActive(change.path)}
										onView={() => openDiff(change.path, "preview")}
										onOpenTab={() => openDiff(change.path, "keep")}
									>
										{({ onContextMenu }) => (
											<button
												type="button"
												onContextMenu={onContextMenu}
												data-testid="change-item"
												data-status={change.status}
												data-active={isActive(change.path) ? true : undefined}
												data-viewed={isViewed(change.path) ? true : undefined}
												onClick={firstClickOnly(() => openDiff(change.path, "preview"))}
												onDoubleClick={() => openDiff(change.path, "keep", undefined, true)}
												title={change.path}
												className="flex h-panel-row min-w-0 flex-1 items-center gap-8 px-4 text-left tr-text-ui"
											>
												<span
													className={`flex min-w-0 flex-1 items-baseline ${isViewed(change.path) ? "opacity-60" : ""}`}
												>
													{dir ? (
														<span
															data-testid="change-path-dir"
															className="min-w-0 shrink truncate text-text-muted"
														>
															{dir}
														</span>
													) : null}
													<span
														data-testid="change-path-base"
														className={`max-w-full shrink-0 truncate ${statusNameClass(change.status) || "text-text-muted"}`}
													>
														{base}
													</span>
												</span>
												{isViewed(change.path) ? <ViewedMark /> : null}
												<DiffStatBadge added={change.added ?? 0} removed={change.removed ?? 0} />
											</button>
										)}
									</ChangeRowActions>
								</li>
							);
						})}
					</ul>
				)}
			</RememberedScrollArea>
		</div>
	);
}
