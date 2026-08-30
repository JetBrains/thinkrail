import type { GitStatus } from "@thinkrail/contracts";
import { useCallback, useEffect, useRef, useState } from "react";
import { QuietScrollArea } from "@/components/QuietScrollArea";
import {
	type CenterNavigationStamp,
	isCenterNavigationCurrent,
	matchesWorktreePath,
	selectActiveEditorTab,
	selectDiffBaseRef,
	selectDiffScope,
	selectWorkspaceById,
	selectWorkspaceNavTick,
	type TabIntent,
	toast,
	useAppStore,
} from "../store";
import { errorText, getTransport, wsErrorCode } from "../transport";
import { BranchPicker } from "./BranchPicker";
import { useBranchList } from "./branches";
import { ChangeRowActions } from "./ChangeRowActions";
import { ChangesScopeMenu } from "./ChangesScopeMenu";
import { ChangesTree } from "./ChangesTree";
import { scopeKey, splitPath, statusNameClass } from "./changesModel";
import { DiffStatBadge } from "./DiffStatBadge";
import { openDiffInTab } from "./openTabs";
import { ToggleSegment } from "./ToggleSegment";
import { useWorkspaceRead } from "./useWorkspaceRead";

export function ChangesPanel({ workspaceId }: { workspaceId: string }) {
	const [status, setStatus] = useState<GitStatus | null>(null);
	const [error, setError] = useState<string | null>(null);
	const warnedRef = useRef(false);
	const [highlighted, setHighlighted] = useState<string | null>(null);
	const changesRequest = useAppStore((s) => s.changesRequest);
	const changesView = useAppStore((s) => s.changesView);
	const setChangesView = useAppStore((s) => s.setChangesView);
	const setDiffScope = useAppStore((s) => s.setDiffScope);
	const scope = useAppStore((s) => selectDiffScope(s, workspaceId));
	const workspace = useAppStore((s) => selectWorkspaceById(s, workspaceId));
	const baseRef = useAppStore((s) => selectDiffBaseRef(s, workspaceId));
	const activeDiffTab = useAppStore((state) => {
		const tab = selectActiveEditorTab(state, workspaceId);
		return tab?.kind === "diff" ? tab : null;
	});

	const { reload } = useWorkspaceRead(
		workspaceId,
		(id) => getTransport().request("git.status", { workspaceId: id, scope }),
		{
			onResult: (result) => {
				setStatus(result);
				setError(null);
				warnedRef.current = false;
			},
			onFailure: (_id, failure) => {
				if (wsErrorCode(failure) === "UNKNOWN_COMMIT") {
					setDiffScope(workspaceId, { kind: "branch" });
					toast.info("That commit is no longer in this branch — showing all changes.");
					return;
				}
				if (status && !warnedRef.current) {
					warnedRef.current = true;
					toast.error(`Could not refresh the changes: ${errorText(failure)}`);
				}
				setError(errorText(failure));
			},
			onSwitch: () => {
				setStatus(null);
				setError(null);
				setHighlighted(null);
				warnedRef.current = false;
			},
		},
		`${scopeKey(scope)}:${baseRef}`,
	);

	const {
		branches,
		refreshing: branchesRefreshing,
		refresh: refreshBranches,
	} = useBranchList(workspace?.projectId ?? null);

	const pointAt = async (ref: string) => {
		try {
			await getTransport().request("workspace.setDiffBase", { id: workspaceId, ref });
		} catch (error) {
			toast.error(`Could not change the target branch: ${errorText(error)}`);
		}
	};

	const openDiff = useCallback(
		(path: string, intent: TabIntent, navigation?: CenterNavigationStamp | null) => {
			setHighlighted(path);
			void openDiffInTab(workspaceId, scope, path, intent, navigation);
		},
		[workspaceId, scope],
	);

	useEffect(() => {
		if (!status || changesRequest?.workspaceId !== workspaceId) return;
		if (useAppStore.getState().changesRequest !== changesRequest) return;
		const want = changesRequest.path;
		const match = status.changes.find((c) => matchesWorktreePath(want, c.path));
		const currentState = useAppStore.getState();
		const overtaken = changesRequest.navigation
			? !isCenterNavigationCurrent(currentState, workspaceId, changesRequest.navigation)
			: selectWorkspaceNavTick(currentState, workspaceId) !== changesRequest.navTick;
		if (match && !overtaken) openDiff(match.path, "preview", changesRequest.navigation);
		else setHighlighted(match ? match.path : want);
		useAppStore.getState().clearChangesRequest();
	}, [changesRequest, status, workspaceId, openDiff]);

	useEffect(() => {
		if (activeDiffTab) setHighlighted(null);
	}, [activeDiffTab]);

	const isActive = (path: string) =>
		activeDiffTab
			? activeDiffTab.path === path && scopeKey(activeDiffTab.scope) === scopeKey(scope)
			: highlighted === path;

	return (
		<div className="flex h-full min-h-0 flex-col">
			<div
				data-testid="changes-view-toggle"
				role="toolbar"
				aria-label="Changes scope and view"
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
							selected={baseRef}
							refreshing={branchesRefreshing}
							label="vs"
							testid="changes-target-picker"
							triggerClassName="flex h-24 min-w-0 max-w-[200px] items-center gap-4 rounded-[var(--radius-sm)] px-4 outline-none transition-colors hover:bg-control-bg-hovered focus-visible:ring-2 focus-visible:ring-primary data-[open=true]:bg-control-bg-selected"
							onSelect={(ref) => void pointAt(ref)}
							onRefresh={refreshBranches}
						/>
					) : null}
				</div>
				<ToggleSegment
					testid="changes-toggle-list"
					label="List"
					active={changesView === "list"}
					onClick={() => setChangesView("list")}
				/>
				<ToggleSegment
					testid="changes-toggle-tree"
					label="Tree"
					active={changesView === "tree"}
					onClick={() => setChangesView("tree")}
				/>
			</div>
			<QuietScrollArea className="min-h-0 flex-1" viewportClassName="p-12">
				{status === null && error !== null ? (
					<div data-testid="changes-error" className="flex flex-col items-start gap-4 px-8 py-4">
						<p className="tr-text-metadata text-feedback-error">
							Could not read the changes: {error}
						</p>
						<button
							type="button"
							data-testid="changes-retry"
							onClick={reload}
							className="rounded-[var(--radius-sm)] px-4 py-2 tr-text-metadata text-text-muted transition-colors hover:bg-control-bg-hovered hover:text-text-default"
						>
							Retry
						</button>
					</div>
				) : status === null ? (
					<p className="px-8 py-4 tr-text-metadata text-text-muted">Loading…</p>
				) : status.changes.length === 0 ? (
					<p data-testid="changes-empty" className="px-8 py-4 tr-text-metadata text-text-muted">
						No changes in this scope.
					</p>
				) : changesView === "tree" ? (
					<ChangesTree changes={status.changes} onOpen={openDiff} isActive={isActive} />
				) : (
					<ul>
						{status.changes.map((change) => {
							const { dir, base } = splitPath(change.path);
							return (
								<li key={change.path}>
									<ChangeRowActions
										path={change.path}
										active={isActive(change.path)}
										onView={() => openDiff(change.path, "preview")}
									>
										{({ onContextMenu }) => (
											<button
												type="button"
												onContextMenu={onContextMenu}
												data-testid="change-item"
												data-status={change.status}
												data-active={isActive(change.path) ? true : undefined}
												onClick={() => openDiff(change.path, "preview")}
												onDoubleClick={() => openDiff(change.path, "keep")}
												title={change.path}
												className="flex min-w-0 flex-1 items-center gap-8 px-4 py-4 text-left tr-text-ui"
											>
												<span className="flex min-w-0 flex-1 items-baseline">
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
												<DiffStatBadge added={change.added ?? 0} removed={change.removed ?? 0} />
											</button>
										)}
									</ChangeRowActions>
								</li>
							);
						})}
					</ul>
				)}
			</QuietScrollArea>
		</div>
	);
}
