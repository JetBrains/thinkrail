import type {
	LayoutCenterTab,
	LayoutTab,
	LayoutToolId,
	WorkspaceLayoutDocument,
} from "@thinkrail/contracts";
import { GitBranch, MessageSquarePlus, SquareTerminal } from "lucide-react";
import { lazy, type ReactNode, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { ErrorBoundary } from "../components/ErrorBoundary";
import { type LayoutAttention, layoutResourceIdentity } from "../lib";
import { ChangesPanel } from "../panels/ChangesPanel";
import { DiffPane } from "../panels/DiffPane";
import { FilePane } from "../panels/FilePane";
import { FileTree } from "../panels/FileTree";
import { ProjectTree } from "../panels/ProjectTree";
import { ReviewPanel, selectActiveReviewedPath } from "../panels/ReviewPanel";
import { reviewFlags } from "../panels/reviewModel";
import { SpecsPanel } from "../panels/SpecsPanel";
import { TerminalWorkbenchBody, useTerminalClose } from "../panels/TerminalWorkbench";
import { useWorkspaceReview } from "../panels/useWorkspaceReview";
import { useWorkspaceSpecs } from "../panels/useWorkspaceSpecs";
import {
	type EditorTab,
	isConnectedGeneration,
	isDefaultWorkspace,
	isExternalWorkspace,
	layoutOpenOptionsForNavigation,
	selectContextProject,
	selectDiffTabTargetRef,
	selectReviewDraftCount,
	selectWorkspaceById,
	selectWorkspaceTick,
	toast,
	useAppStore,
} from "../store";
import { createSessionWithSkillBaseline, errorText, getTransport } from "../transport";
import {
	currentChatDestination,
	hydrateChatResource,
	useChatLocationReconciliation,
	useDeletedChatPlacementReconciliation,
	useWorkspaceChatCatalogReconciliation,
} from "./chatReconciliation";
import {
	collectAllGroups,
	findPlacedResource,
	findTabLocation,
	type LayoutTabFocusRequest,
	Workbench,
} from "./layout";
import { toLayoutTab, useLayoutIntentProcessing } from "./layoutIntents";
import {
	commitWorkspaceLayout,
	persistLayoutAttention,
	useWorkspaceLayoutSynchronization,
} from "./layoutSync";
import { syncLegacySelectionFromAttention, useLegacySelectionAdapter } from "./legacySelection";
import { useTerminalPlacementReconciliation } from "./terminalReconciliation";
import { WorkspaceChatHistory } from "./WorkspaceChatHistory";

const ChatView = lazy(() => import("../chat/ChatView"));
const PlanPane = lazy(() => import("../panels/PlanPane"));

const NO_EDITOR_TABS: EditorTab[] = [];

function MissingResource({ label }: { label: string }) {
	return (
		<div className="flex h-full items-center justify-center px-lg text-center tr-text-ui text-text-muted">
			Restoring {label}…
		</div>
	);
}

export function WorkspaceWorkbench({ workspaceId }: { workspaceId: string }) {
	const status = useAppStore((state) => state.status);
	const connectionGeneration = useAppStore((state) => state.connectionGeneration);
	const document = useAppStore((state) => state.layoutDocumentsByWorkspace[workspaceId]);
	const attention = useAppStore((state) => state.layoutAttentionByWorkspace[workspaceId]);
	const remoteEpoch = useAppStore((state) => state.layoutRemoteEpochByWorkspace[workspaceId] ?? 0);
	const pendingLayoutWrites = useAppStore(
		(state) => state.layoutPendingByWorkspace[workspaceId]?.length ?? 0,
	);
	const layoutSettings = useAppStore((state) => state.layoutSettings);
	const workspace = useAppStore((state) => selectWorkspaceById(state, workspaceId));
	const contextProject = useAppStore(selectContextProject);
	const editorTabs = useAppStore((state) => state.tabsByWorkspace[workspaceId] ?? NO_EDITOR_TABS);
	const sessions = useAppStore((state) => state.sessions);
	const deletedSessions = useAppStore((state) => state.deletedSessionsByWorkspace[workspaceId]);
	const terminalClose = useTerminalClose();
	const specs = useWorkspaceSpecs(workspaceId);
	const review = useWorkspaceReview(workspaceId);
	const reviewComments = useAppStore((state) => state.reviewsByWorkspace[workspaceId]?.comments);
	const reviewDraftCount = useAppStore((state) => selectReviewDraftCount(state, workspaceId));
	const reviewFlagByPath = useMemo(() => reviewFlags(reviewComments), [reviewComments]);
	const [focusRequest, setFocusRequest] = useState<LayoutTabFocusRequest | null>(null);
	const activeReviewedPath = useAppStore((state) => selectActiveReviewedPath(state, workspaceId));
	const readActiveReviewedPath = useCallback(
		() => selectActiveReviewedPath(useAppStore.getState(), workspaceId),
		[workspaceId],
	);

	useWorkspaceLayoutSynchronization(workspaceId);

	useEffect(() => {
		if (!document || pendingLayoutWrites > 0) return;
		const state = useAppStore.getState();
		if (
			state.layoutDocumentsByWorkspace[workspaceId] !== document ||
			(state.layoutPendingByWorkspace[workspaceId]?.length ?? 0) > 0
		) {
			return;
		}
		const placed = new Set(
			collectAllGroups(document)
				.flatMap((group) => group.tabs)
				.map(layoutResourceIdentity),
		);
		const opening = new Set(
			state.layoutIntents.flatMap((intent) => {
				if (intent.workspaceId !== workspaceId || intent.kind !== "open") return [];
				const resource = toLayoutTab(intent.tab);
				return resource ? [layoutResourceIdentity(resource)] : [];
			}),
		);
		for (const tab of editorTabs) {
			const resource = toLayoutTab(tab);
			const identity = resource ? layoutResourceIdentity(resource) : null;
			if (identity && (placed.has(identity) || opening.has(identity))) continue;
			const latest = useAppStore.getState();
			if (
				latest.layoutDocumentsByWorkspace[workspaceId] !== document ||
				(latest.layoutPendingByWorkspace[workspaceId]?.length ?? 0) > 0
			) {
				return;
			}
			const current = (latest.tabsByWorkspace[workspaceId] ?? []).find(
				(candidate) => candidate.id === tab.id,
			);
			const currentResource = current ? toLayoutTab(current) : null;
			if (
				!current ||
				!identity ||
				!currentResource ||
				layoutResourceIdentity(currentResource) !== identity
			) {
				continue;
			}
			if (current.kind === "chat") {
				latest.closeChatToHistory(current.sessionId, false, workspaceId, false);
			} else {
				latest.closeTab(current.id, false, false, workspaceId);
			}
		}
	}, [document, editorTabs, pendingLayoutWrites, workspaceId]);

	const changeAttention = useCallback(
		(next: LayoutAttention) => {
			const state = useAppStore.getState();
			if (state.removedWorkspaceIds[workspaceId]) return;
			state.setLayoutAttention(workspaceId, next);
			persistLayoutAttention(workspaceId, next);
			syncLegacySelectionFromAttention(workspaceId);
		},
		[workspaceId],
	);

	const commit = useCallback(
		(next: WorkspaceLayoutDocument) => {
			void commitWorkspaceLayout(workspaceId, next).catch(() => {});
		},
		[workspaceId],
	);

	useLegacySelectionAdapter(workspaceId, activeReviewedPath, readActiveReviewedPath);
	useDeletedChatPlacementReconciliation(workspaceId);
	useLayoutIntentProcessing(workspaceId, commit, changeAttention, setFocusRequest);
	useWorkspaceChatCatalogReconciliation(workspaceId, commit);
	const terminals = useTerminalPlacementReconciliation(workspaceId, commit);
	useChatLocationReconciliation(workspaceId, changeAttention);

	useEffect(() => {
		if (!document || status !== "connected") return;
		if (useAppStore.getState().layoutDocumentsByWorkspace[workspaceId] !== document) return;
		let current = true;
		const cache = useAppStore.getState().tabsByWorkspace[workspaceId] ?? [];
		const cachedResources = new Set(
			cache.flatMap((item) => {
				const resource = toLayoutTab(item);
				return resource && (resource.kind === "file" || resource.kind === "diff")
					? [layoutResourceIdentity(resource)]
					: [];
			}),
		);
		for (const tab of collectAllGroups(document).flatMap((group) => group.tabs)) {
			if (tab.kind !== "file" && tab.kind !== "diff") continue;
			const identity = layoutResourceIdentity(tab);
			if (cachedResources.has(identity)) continue;
			const cacheArrived = () =>
				(useAppStore.getState().tabsByWorkspace[workspaceId] ?? []).some((item) => {
					const resource = toLayoutTab(item);
					return resource !== null && layoutResourceIdentity(resource) === identity;
				});
			const currentPlacement = () => {
				const latest = useAppStore.getState().layoutDocumentsByWorkspace[workspaceId];
				return latest ? findPlacedResource(latest, tab) : null;
			};
			const loadedTick = selectWorkspaceTick(useAppStore.getState(), workspaceId);
			if (tab.kind === "file") {
				void getTransport()
					.request("fs.readFile", { workspaceId, path: tab.path })
					.then(({ content }) => {
						const latest = useAppStore.getState();
						if (!current || !isConnectedGeneration(latest, connectionGeneration)) return;
						const placed = currentPlacement();
						if (placed?.kind !== "file" || cacheArrived()) return;
						useAppStore.getState().openTab(
							{
								kind: "file",
								id: placed.id,
								workspaceId,
								path: placed.path,
								name: placed.name,
								content,
								loadedTick,
							},
							"keep",
							false,
							{ activate: false },
						);
					})
					.catch(() => {});
			} else {
				const loadedTarget = selectDiffTabTargetRef(useAppStore.getState(), {
					workspaceId,
					scope: tab.scope,
				});
				void getTransport()
					.request("git.diffFile", { workspaceId, path: tab.path, scope: tab.scope })
					.then(({ original, modified }) => {
						const latest = useAppStore.getState();
						if (!current || !isConnectedGeneration(latest, connectionGeneration)) return;
						const placed = currentPlacement();
						if (placed?.kind !== "diff" || cacheArrived()) return;
						useAppStore.getState().openTab(
							{
								kind: "diff",
								id: placed.id,
								workspaceId,
								path: placed.path,
								scope: placed.scope,
								name: placed.name,
								original,
								modified,
								loadedTick,
								loadedTarget,
							},
							"keep",
							false,
							{ activate: false },
						);
					})
					.catch(() => {});
			}
		}
		return () => {
			current = false;
		};
	}, [connectionGeneration, document, status, workspaceId]);

	const editorById = useMemo(() => new Map(editorTabs.map((tab) => [tab.id, tab])), [editorTabs]);
	const editorByResource = useMemo(() => {
		const resources = new Map<
			string,
			Extract<EditorTab, { kind: "file" }> | Extract<EditorTab, { kind: "diff" }>
		>();
		for (const tab of editorTabs) {
			if (tab.kind !== "file" && tab.kind !== "diff") continue;
			const identity = layoutResourceIdentity(tab);
			if (!resources.has(identity)) resources.set(identity, tab);
		}
		return resources;
	}, [editorTabs]);
	const terminalByKey = useMemo(
		() => new Map(terminals.map((tab) => [tab.tabKey, tab])),
		[terminals],
	);

	const renderTabBody = useCallback(
		(tab: LayoutCenterTab | Extract<LayoutTab, { kind: "terminal" }>) => {
			if (tab.kind === "chat") {
				return sessions[tab.sessionId] ? (
					<ErrorBoundary label="chat" resetKeys={[workspaceId, tab.id]}>
						<Suspense fallback={<MissingResource label="chat" />}>
							<ChatView sessionId={tab.sessionId} workspaceId={workspaceId} />
						</Suspense>
					</ErrorBoundary>
				) : (
					<div className="flex h-full flex-col items-center justify-center gap-sm text-text-muted">
						<MissingResource label="chat" />
						<button
							type="button"
							onClick={() => {
								void hydrateChatResource(workspaceId, tab.sessionId)
									.then((installed) => {
										if (installed) return;
										const { state, current } = currentChatDestination(workspaceId, tab, undefined);
										if (
											current &&
											!state.removedWorkspaceIds[workspaceId] &&
											!state.deletedSessionsByWorkspace[workspaceId]?.[tab.sessionId]
										) {
											toast.error("The chat could not be restored.", "Couldn't restore the chat");
										}
									})
									.catch((error) => {
										const { state, current } = currentChatDestination(workspaceId, tab, undefined);
										if (
											current &&
											!state.removedWorkspaceIds[workspaceId] &&
											!state.deletedSessionsByWorkspace[workspaceId]?.[tab.sessionId]
										) {
											toast.error(errorText(error), "Couldn't restore the chat");
										}
									});
							}}
							className="rounded-[var(--radius-sm)] border border-border-default px-sm py-xs tr-text-ui hover:bg-control-bg-hovered"
						>
							Retry
						</button>
					</div>
				);
			}
			if (tab.kind === "document") {
				if (deletedSessions?.[tab.sourceId]) return <MissingResource label="plan" />;
				return (
					<ErrorBoundary label="plan" resetKeys={[workspaceId, tab.id]}>
						<Suspense fallback={<MissingResource label="plan" />}>
							<PlanPane workspaceId={workspaceId} sessionId={tab.sourceId} />
						</Suspense>
					</ErrorBoundary>
				);
			}
			if (tab.kind === "terminal") {
				const terminal = terminalByKey.get(tab.tabKey);
				const location = document ? findTabLocation(document, tab.id) : null;
				return (
					<ErrorBoundary label="terminal" resetKeys={[workspaceId, tab.id]}>
						{terminal ? (
							<TerminalWorkbenchBody
								tab={terminal}
								onAdd={() =>
									useAppStore
										.getState()
										.addTerminal(
											workspaceId,
											undefined,
											location?.area === "center" ? location.groupId : undefined,
										)
								}
							/>
						) : (
							<MissingResource label="terminal" />
						)}
					</ErrorBoundary>
				);
			}
			const identity = layoutResourceIdentity(tab);
			const exact = editorById.get(tab.id);
			const editor =
				exact &&
				(exact.kind === "file" || exact.kind === "diff") &&
				layoutResourceIdentity(exact) === identity
					? exact
					: editorByResource.get(identity);
			if (!editor) return <MissingResource label={tab.kind === "file" ? "file" : "diff"} />;
			return (
				<ErrorBoundary label="editor" resetKeys={[workspaceId, tab.id]}>
					<Suspense fallback={<MissingResource label="editor" />}>
						{editor.kind === "file" ? (
							<FilePane tab={editor} />
						) : editor.kind === "diff" ? (
							<DiffPane tab={editor} />
						) : null}
					</Suspense>
				</ErrorBoundary>
			);
		},
		[deletedSessions, document, editorById, editorByResource, sessions, terminalByKey, workspaceId],
	);

	const renderToolBody = useCallback(
		(tool: LayoutToolId) => {
			let body: ReactNode;
			switch (tool) {
				case "projects":
					body = (
						<div data-testid="left-nav" className="h-full overflow-auto p-md">
							<ProjectTree />
						</div>
					);
					break;
				case "specs":
					body = (
						<div className="p-xs">
							<SpecsPanel
								workspaceId={workspaceId}
								failed={specs.failed}
								onRefresh={specs.reload}
							/>
						</div>
					);
					break;
				case "files":
					body = (
						<div className="p-xs">
							<FileTree key={workspaceId} workspaceId={workspaceId} />
						</div>
					);
					break;
				case "changes":
					body = <ChangesPanel workspaceId={workspaceId} />;
					break;
				case "review":
					body = <ReviewPanel workspaceId={workspaceId} failed={review.failed} />;
					break;
			}
			return (
				<ErrorBoundary label={`${tool} tool`} resetKeys={[workspaceId, tool]}>
					{body}
				</ErrorBoundary>
			);
		},
		[review.failed, specs.failed, specs.reload, workspaceId],
	);

	const isDefault = workspace != null && isDefaultWorkspace(workspace);
	const isExternal = workspace != null && isExternalWorkspace(workspace);

	const startChat = useCallback(
		(groupId: string) => {
			const currentAttention = useAppStore.getState().layoutAttentionByWorkspace[workspaceId];
			if (!currentAttention) return;
			changeAttention({ ...currentAttention, lastFocusedCenterGroupId: groupId });
			const navigation = useAppStore.getState().beginCenterNavigation(workspaceId, groupId);
			void createSessionWithSkillBaseline({ workspaceId })
				.then(({ result: { sessionId, model, thinkingLevel }, syncedTick }) => {
					const store = useAppStore.getState();
					store.openChatSession(
						workspaceId,
						sessionId,
						model,
						thinkingLevel,
						syncedTick,
						layoutOpenOptionsForNavigation(store, workspaceId, navigation),
					);
				})
				.catch(() => {
					const state = useAppStore.getState();
					if (
						layoutOpenOptionsForNavigation(state, workspaceId, navigation).activate !== false &&
						!state.removedWorkspaceIds[workspaceId]
					) {
						toast.error("The agent session could not be created.", "Couldn't start the chat");
					}
				});
		},
		[changeAttention, workspaceId],
	);

	if (!document || !attention) {
		return (
			<div className="flex h-full items-center justify-center bg-container-content-bg tr-text-ui text-text-muted">
				Restoring workspace layout…
			</div>
		);
	}

	return (
		<div
			data-testid="workspace-workbench"
			data-layout-status={pendingLayoutWrites > 0 ? "saving" : "settled"}
			className="contents"
		>
			<Workbench
				document={document}
				attention={attention}
				maxSideGroups={layoutSettings.maxSideGroups}
				remoteEpoch={remoteEpoch}
				{...(focusRequest ? { focusRequest } : {})}
				renderTabBody={renderTabBody}
				renderTabAdornment={(tab) => {
					if (tab.kind === "tool" && tab.tool === "review" && reviewDraftCount > 0) {
						return (
							<span
								data-testid="review-pending-badge"
								className="inline-flex min-w-4 items-center justify-center rounded-full bg-primary px-0.5 tr-text-label-pill text-text-on-primary"
							>
								{reviewDraftCount}
							</span>
						);
					}
					if (tab.kind !== "file" && tab.kind !== "diff") return null;
					const flag = reviewFlagByPath.get(tab.path);
					return flag ? (
						<span
							data-testid="review-tab-flag"
							data-flag={flag}
							className={
								flag === "draft"
									? "shrink-0 tr-text-eyebrow text-primary"
									: "shrink-0 tr-text-eyebrow text-text-subtle"
							}
						>
							Review
						</span>
					) : null;
				}}
				renderToolBody={renderToolBody}
				renderEmptyCenter={(groupId) => (
					<div
						data-testid="workspace-ready"
						className="flex h-full flex-col items-center justify-center gap-xs px-lg text-center"
					>
						<span className="tr-text-eyebrow text-text-muted">
							{isDefault
								? "Default workspace"
								: isExternal
									? "Existing worktree"
									: "Workspace ready"}
						</span>
						{workspace ? (
							<>
								<h2 className="max-w-full truncate tr-title-entity text-text-default">
									{isDefault ? (contextProject?.name ?? workspace.name) : workspace.name}
								</h2>
								<p className="flex max-w-full items-center gap-xs tr-text-metadata text-text-muted">
									<GitBranch className="size-3.5 shrink-0" />
									{isDefault || isExternal ? (
										<span className="truncate">on {workspace.branch}</span>
									) : (
										<>
											<span className="truncate">{workspace.branch}</span>
											<span className="shrink-0 text-text-muted">
												· from {workspace.baseBranch}
											</span>
										</>
									)}
								</p>
							</>
						) : null}
						<p className="mt-xs tr-text-ui text-text-muted">
							{isDefault
								? "Chats, changes, and terminals run directly in your project folder."
								: "Files, chats, changes, and terminals are scoped to this workspace."}
						</p>
						<button
							type="button"
							data-testid="start-chat"
							onClick={() => startChat(groupId)}
							className="mt-xs flex items-center gap-xs rounded-[var(--radius-sm)] border border-border-default bg-container-elevated-bg px-md py-xs tr-text-ui text-text-default hover:bg-control-bg-hovered"
						>
							<MessageSquarePlus className="size-4" /> New chat
						</button>
					</div>
				)}
				renderCenterActions={(groupId) => (
					<>
						<WorkspaceChatHistory workspaceId={workspaceId} targetGroupId={groupId} />
						<button
							type="button"
							data-testid="new-terminal"
							aria-label="New terminal in this group"
							title="New terminal in this group"
							onClick={() => useAppStore.getState().addTerminal(workspaceId, undefined, groupId)}
							className="flex w-7 shrink-0 items-center justify-center border-border-default border-l text-text-muted hover:bg-control-bg-hovered hover:text-text-default"
						>
							<SquareTerminal className="size-4" />
						</button>
					</>
				)}
				onCommit={commit}
				onAttentionChange={changeAttention}
				onUserNavigation={() => useAppStore.getState().noteNavigation(workspaceId)}
				onRequestClose={(tab, prepare) => {
					if (tab.kind === "terminal") {
						const close = () => {
							const state = useAppStore.getState();
							if (state.removedWorkspaceIds[workspaceId]) return;
							const latest = state.layoutDocumentsByWorkspace[workspaceId];
							const prepared = prepare(latest);
							if (!latest || prepared.document !== latest) commit(prepared.document);
							// The host terminal close is already authoritative; layout reconciliation may retry its
							// structural removal, but this accepted user close owns attention exactly once now.
							prepared.onAccepted(useAppStore.getState().layoutDocumentsByWorkspace[workspaceId]);
						};
						const terminal = terminalByKey.get(tab.tabKey);
						if (terminal) terminalClose.requestClose(terminal, close);
						else close();
						return;
					}
					const prepared = prepare();
					const closedIdentity = layoutResourceIdentity(tab);
					void commitWorkspaceLayout(workspaceId, prepared.document)
						.then(() => {
							const state = useAppStore.getState();
							const current = state.layoutDocumentsByWorkspace[workspaceId];
							if (
								current &&
								collectAllGroups(current)
									.flatMap((group) => group.tabs)
									.some((candidate) => layoutResourceIdentity(candidate) === closedIdentity)
							) {
								return;
							}
							prepared.onAccepted(current);
							if (tab.kind === "chat") {
								state.closeChatToHistory(tab.sessionId, false, workspaceId, false);
							} else if (tab.kind === "file" || tab.kind === "diff" || tab.kind === "document") {
								for (const cache of state.tabsByWorkspace[workspaceId] ?? []) {
									const resource = toLayoutTab(cache);
									if (resource && layoutResourceIdentity(resource) === closedIdentity) {
										state.closeTab(cache.id, false, false, workspaceId);
									}
								}
							}
						})
						.catch(() => {});
				}}
				onNewChat={startChat}
				onRemoteGestureCanceled={() =>
					toast.info("The shared layout changed. Your drag was canceled.")
				}
			/>
			{terminalClose.confirmation}
		</div>
	);
}
