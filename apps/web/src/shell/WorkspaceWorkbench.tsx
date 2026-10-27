import {
	RiGitBranchLine as GitBranch,
	RiChatNewLine as MessageSquarePlus,
	RiTerminalBoxLine as SquareTerminal,
} from "@remixicon/react";
import type { MessageKey } from "@thinkrail/locales";
import { t, useT } from "@thinkrail/locales/react";
import { Button, IconButton } from "@thinkrail/ui/button";
import { LoadingRegion } from "@thinkrail/ui/skeleton";
import {
	Fragment,
	lazy,
	type ReactNode,
	Suspense,
	useCallback,
	useEffect,
	useMemo,
	useState,
} from "react";
import { useShallow } from "zustand/react/shallow";
import { prepareChatTitle } from "../chat/chatTitle";
import { useAutoPlanSummary } from "../chat/useChatTodos";
import { ErrorBoundary } from "../components/ErrorBoundary";
import { preloadedLazy } from "../components/preloadedLazy";
import { QuietScrollArea } from "../components/QuietScrollArea";
import { type LayoutAttention, layoutResourceIdentity } from "../lib";
import { DiffPane } from "../panels/DiffPane";
import { FilePane } from "../panels/FilePane";
import { FilesPanel } from "../panels/FilesPanel";
import { startChatInTab } from "../panels/openChat";
import { fileComparisonTab, openFileInTab } from "../panels/openTabs";
import { ProjectTree } from "../panels/ProjectTree";
import { ReviewPanel, selectActiveReviewedPath } from "../panels/ReviewPanel";
import { reviewFlagForPaths, reviewFlags, tabReviewPaths } from "../panels/reviewModel";
import { SpecsPanel } from "../panels/SpecsPanel";
import { TerminalWorkbenchBody, useTerminalClose } from "../panels/TerminalWorkbench";
import { useWorkspaceReview } from "../panels/useWorkspaceReview";
import { useWorkspaceSpecs } from "../panels/useWorkspaceSpecs";
import { useLoadWorkspaceTurns } from "../panels/useWorkspaceTurns";
import {
	createChangesTab,
	type EditorTab,
	editorSessionId,
	isConnectedGeneration,
	isDefaultWorkspace,
	isExternalWorkspace,
	isFileComparison,
	type LayoutIntent,
	selectCanRenameChat,
	selectContextProject,
	selectDiffTabTargetRef,
	selectRailPlanSessionId,
	selectReviewDraftCount,
	selectUnnamedChatFirstPrompts,
	selectWorkspaceById,
	selectWorkspaceNavTick,
	selectWorkspaceTick,
	toast,
	useAppStore,
	workspaceName,
} from "../store";
import { errorText, getTransport } from "../transport";
import {
	currentChatDestination,
	hydrateChatResource,
	useChatLocationReconciliation,
	useDeletedChatPlacementReconciliation,
	useWorkspaceChatCatalogReconciliation,
} from "./chatReconciliation";
import { subscribeCloseRequest } from "./closeRequestChannel";
import {
	collectAllGroups,
	findPlacedResource,
	findTabLocation,
	isToolShowing,
	type LayoutCenterTab,
	type LayoutTab,
	type LayoutTabFocusRequest,
	type LayoutToolId,
	showingAuxiliaryKey,
	Workbench,
	type WorkspaceLayoutDocument,
} from "./layout";
import { toLayoutTab, useLayoutIntentProcessing } from "./layoutIntents";
import {
	applyLayoutAttention,
	commitWorkspaceLayout,
	emptyWorkspaceProjection,
	useWorkspaceLayoutState,
	workspaceProjectionReference,
} from "./layoutState";
import { syncLegacySelectionFromAttention, useLegacySelectionAdapter } from "./legacySelection";
import { useTerminalPlacementReconciliation } from "./terminalReconciliation";
import { useIdleEditorPreload } from "./useIdleEditorPreload";
import { WorkspaceChatHistory } from "./WorkspaceChatHistory";

function PlanSummaryAutoDraft({
	workspaceId,
	sessionId,
}: {
	workspaceId: string;
	sessionId: string;
}) {
	useAutoPlanSummary(workspaceId, sessionId);
	return null;
}

const ChatView = preloadedLazy(() => import("../chat/ChatView"));
const PlanPane = lazy(() => import("../panels/PlanPane"));
const ChangesReviewPane = lazy(() =>
	import("../panels/ChangesReviewPane").then((module) => ({ default: module.ChangesReviewPane })),
);
const PlanRailPane = lazy(() => import("../panels/PlanRailPane"));

const NO_EDITOR_TABS: EditorTab[] = [];

const RESTORING_LABEL = {
	file: "shell.workbench.restoring.file",
	changes: "shell.workbench.restoring.changes",
	diff: "shell.workbench.restoring.diff",
	editor: "shell.workbench.restoring.editor",
	chat: "shell.workbench.restoring.chat",
	plan: "shell.workbench.restoring.plan",
	terminal: "shell.workbench.restoring.terminal",
} satisfies Record<string, MessageKey>;

function MissingResource({ kind }: { kind: keyof typeof RESTORING_LABEL }) {
	const t = useT();
	return (
		<LoadingRegion
			rows={12}
			label={t(RESTORING_LABEL[kind])}
			className="h-full overflow-hidden p-16"
		/>
	);
}

type EditorResourceTab = Extract<LayoutCenterTab, { kind: "file" | "diff" | "changes" }>;
type EditorResource = Extract<EditorTab, { kind: "file" | "diff" | "changes" }>;

function isEditorResource(tab: EditorTab): tab is EditorResource {
	return tab.kind === "file" || tab.kind === "diff" || tab.kind === "changes";
}

function findEditorResource(
	tabs: readonly EditorTab[],
	id: string,
	identity: string,
): EditorResource | undefined {
	const exact = tabs.find((candidate) => candidate.id === id);
	if (exact && isEditorResource(exact) && layoutResourceIdentity(exact) === identity) return exact;
	return tabs.find(
		(candidate): candidate is EditorResource =>
			isEditorResource(candidate) && layoutResourceIdentity(candidate) === identity,
	);
}

function EditorResourceBody({ workspaceId, tab }: { workspaceId: string; tab: EditorResourceTab }) {
	const t = useT();
	const identity = layoutResourceIdentity(tab);
	const editor = useAppStore((state) =>
		findEditorResource(state.tabsByWorkspace[workspaceId] ?? NO_EDITOR_TABS, tab.id, identity),
	);
	if (!editor) {
		return <MissingResource kind={tab.kind} />;
	}
	return (
		<ErrorBoundary
			label={t("shell.workbench.panel.editor")}
			reportId="editor"
			resetKeys={[workspaceId, tab.id]}
		>
			<Suspense fallback={<MissingResource kind="editor" />}>
				{editor.kind === "file" ? (
					<FilePane tab={editor} />
				) : editor.kind === "diff" ? (
					<DiffPane tab={editor} />
				) : (
					<ChangesReviewPane tab={editor} />
				)}
			</Suspense>
		</ErrorBoundary>
	);
}

const CHAT_RETRY_DELAY_MS = 4000;

function ChatResourceBody({
	workspaceId,
	tab,
	onOpenFile,
}: {
	workspaceId: string;
	tab: Extract<LayoutCenterTab, { kind: "chat" }>;
	onOpenFile: (path: string) => void;
}) {
	const t = useT();
	const available = useAppStore((state) => state.sessions[tab.sessionId] !== undefined);
	const [stalled, setStalled] = useState(false);
	useEffect(() => {
		if (available) return;
		setStalled(false);
		const timer = setTimeout(() => setStalled(true), CHAT_RETRY_DELAY_MS);
		return () => clearTimeout(timer);
	}, [available, tab.sessionId]);
	if (available) {
		return (
			<ErrorBoundary
				label={t("shell.workbench.panel.chat")}
				reportId="chat"
				resetKeys={[workspaceId, tab.id]}
			>
				<Suspense fallback={<MissingResource kind="chat" />}>
					<ChatView sessionId={tab.sessionId} workspaceId={workspaceId} onOpenFile={onOpenFile} />
				</Suspense>
			</ErrorBoundary>
		);
	}
	const retry = () => {
		void hydrateChatResource(workspaceId, tab.sessionId)
			.then((installed) => {
				if (installed) return;
				const { state, current } = currentChatDestination(workspaceId, tab, undefined);
				if (
					current &&
					!state.removedWorkspaceIds[workspaceId] &&
					!state.deletedSessionsByWorkspace[workspaceId]?.[tab.sessionId]
				) {
					toast.error(
						t("shell.workbench.chatRestoreFailed"),
						t("shell.workbench.chatRestoreFailedTitle"),
					);
				}
			})
			.catch((error) => {
				const { state, current } = currentChatDestination(workspaceId, tab, undefined);
				if (
					current &&
					!state.removedWorkspaceIds[workspaceId] &&
					!state.deletedSessionsByWorkspace[workspaceId]?.[tab.sessionId]
				) {
					toast.error(errorText(error), t("shell.workbench.chatRestoreFailedTitle"));
				}
			});
	};
	if (!stalled) return <MissingResource kind="chat" />;
	return (
		<div className="flex h-full flex-col items-center justify-center gap-8 text-text-muted">
			<span className="tr-text-ui">{t("shell.workbench.chatRestoreSlow")}</span>
			<Button variant="outline" size="m" onClick={retry}>
				{t("common.retry")}
			</Button>
		</div>
	);
}

function useTerminalReservation(workspaceId: string): void {
	const status = useAppStore((state) => state.status);
	const connectionGeneration = useAppStore((state) => state.connectionGeneration);
	const pendingIntent = useAppStore((state) =>
		state.layoutIntents.find(
			(intent): intent is Extract<LayoutIntent, { kind: "place-terminal" }> =>
				intent.kind === "place-terminal" &&
				intent.workspaceId === workspaceId &&
				state.terminalsByWorkspace[workspaceId]?.some(
					(tab) => tab.tabKey === intent.tabKey && tab.reservationPending,
				) === true,
		),
	);

	useEffect(() => {
		if (!pendingIntent || status !== "connected" || connectionGeneration === 0) return;
		let current = true;
		void getTransport()
			.request("terminal.reserve", {
				workspaceId,
				tabKey: pendingIntent.tabKey,
				title: pendingIntent.title,
			})
			.then(() => {
				const state = useAppStore.getState();
				if (
					!current ||
					!isConnectedGeneration(state, connectionGeneration) ||
					state.removedWorkspaceIds[workspaceId]
				) {
					return;
				}
				state.confirmTerminalReservation(workspaceId, pendingIntent.tabKey);
			})
			.catch((error) => {
				const state = useAppStore.getState();
				if (
					!current ||
					!isConnectedGeneration(state, connectionGeneration) ||
					state.removedWorkspaceIds[workspaceId]
				) {
					return;
				}
				const stillPending = state.terminalsByWorkspace[workspaceId]?.some(
					(tab) => tab.tabKey === pendingIntent.tabKey && tab.reservationPending,
				);
				if (!stillPending) return;
				state.rejectTerminalReservation(workspaceId, pendingIntent.tabKey);
				toast.error(errorText(error), t("shell.workbench.terminalCreateFailed"));
			});
		return () => {
			current = false;
		};
	}, [connectionGeneration, pendingIntent, status, workspaceId]);
}

export function WorkspaceWorkbench({ workspaceId }: { workspaceId: string }) {
	const t = useT();
	const status = useAppStore((state) => state.status);
	const connectionGeneration = useAppStore((state) => state.connectionGeneration);
	const canRenameChat = useAppStore(selectCanRenameChat);
	const document = useAppStore((state) => state.layoutDocumentsByWorkspace[workspaceId]);
	const attention = useAppStore((state) => state.layoutAttentionByWorkspace[workspaceId]);
	const frame = useAppStore((state) => state.workbenchFrame);
	const projectionEpoch = useAppStore((state) => state.layoutProjectionEpoch);
	const layoutPreferences = useAppStore((state) => state.localLayoutPreferences);
	const workspace = useAppStore((state) => selectWorkspaceById(state, workspaceId));
	const contextProject = useAppStore(selectContextProject);
	const editorTabs = useAppStore((state) => state.tabsByWorkspace[workspaceId] ?? NO_EDITOR_TABS);
	const planSessionIds = useMemo(() => {
		const seen = new Set<string>();
		for (const tab of editorTabs) {
			const sid = editorSessionId(tab);
			if (sid) seen.add(sid);
		}
		return [...seen];
	}, [editorTabs]);
	const chatStarting = useAppStore((state) => (state.chatStartsByWorkspace[workspaceId] ?? 0) > 0);
	const deletedSessions = useAppStore((state) => state.deletedSessionsByWorkspace[workspaceId]);
	const terminalClose = useTerminalClose();
	const specs = useWorkspaceSpecs(workspaceId);
	const review = useWorkspaceReview(workspaceId);
	useLoadWorkspaceTurns(workspaceId);
	useIdleEditorPreload(workspaceId);
	const reviewComments = useAppStore((state) => state.reviewsByWorkspace[workspaceId]?.comments);
	const railPlanSessionId = useAppStore((state) => selectRailPlanSessionId(state, workspaceId));
	const reviewDraftCount = useAppStore((state) => selectReviewDraftCount(state, workspaceId));
	const reviewFlagByPath = useMemo(() => reviewFlags(reviewComments), [reviewComments]);
	useEffect(() => {
		void ChatView.preload();
	}, []);
	const [focusRequest, setFocusRequest] = useState<LayoutTabFocusRequest | null>(null);
	const requestRenameChat = useCallback(
		(sessionId: string, titleInput: string, currentTitle: string) => {
			const prepared = prepareChatTitle(titleInput);
			if ("reason" in prepared || prepared.title === currentTitle) return;
			void getTransport()
				.request("session.rename", { workspaceId, sessionId, title: prepared.title })
				.catch((error) => toast.error(errorText(error), t("shell.workbench.chatRenameFailed")));
		},
		[t, workspaceId],
	);
	const activeReviewedPath = useAppStore((state) => selectActiveReviewedPath(state, workspaceId));
	const readActiveReviewedPath = useCallback(
		() => selectActiveReviewedPath(useAppStore.getState(), workspaceId),
		[workspaceId],
	);
	const readAuxiliary = useCallback(() => {
		const state = useAppStore.getState();
		const layout = state.layoutDocumentsByWorkspace[workspaceId];
		const layoutAttention = state.layoutAttentionByWorkspace[workspaceId];
		return layout && layoutAttention
			? {
					reviewShowing: isToolShowing(layout, layoutAttention, "review"),
					showingKey: showingAuxiliaryKey(layout, layoutAttention),
				}
			: { reviewShowing: false, showingKey: "" };
	}, [workspaceId]);
	const openToolFile = useCallback(
		(path: string) => {
			void openFileInTab(workspaceId, path, "preview");
		},
		[workspaceId],
	);

	useWorkspaceLayoutState(workspaceId);

	useEffect(() => {
		if (!document) return;
		const state = useAppStore.getState();
		if (state.layoutDocumentsByWorkspace[workspaceId] !== document) return;
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
			if (latest.layoutDocumentsByWorkspace[workspaceId] !== document) return;
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
	}, [document, editorTabs, workspaceId]);

	const changeAttention = useCallback(
		(next: LayoutAttention) => {
			const state = useAppStore.getState();
			if (state.removedWorkspaceIds[workspaceId]) return;
			applyLayoutAttention(workspaceId, next);
			syncLegacySelectionFromAttention(workspaceId);
		},
		[workspaceId],
	);

	const commit = useCallback(
		(next: WorkspaceLayoutDocument, nextAttention?: LayoutAttention) => {
			void commitWorkspaceLayout(workspaceId, next, {
				...(document ? { baseDocument: document } : {}),
				...(nextAttention ? { attention: nextAttention } : {}),
			}).catch(() => {});
		},
		[document, workspaceId],
	);

	useLegacySelectionAdapter(workspaceId, activeReviewedPath, readActiveReviewedPath, readAuxiliary);
	useDeletedChatPlacementReconciliation(workspaceId);
	useTerminalReservation(workspaceId);
	useLayoutIntentProcessing(workspaceId, commit, changeAttention, setFocusRequest);
	useWorkspaceChatCatalogReconciliation(workspaceId, commit);
	const { terminals } = useTerminalPlacementReconciliation(workspaceId, commit);
	useChatLocationReconciliation(workspaceId, changeAttention);

	useEffect(() => {
		if (!document || status !== "connected") return;
		if (useAppStore.getState().layoutDocumentsByWorkspace[workspaceId] !== document) return;
		let current = true;
		const cache = useAppStore.getState().tabsByWorkspace[workspaceId] ?? [];
		const cachedResources = new Set(
			cache.flatMap((item) => {
				const resource = toLayoutTab(item);
				return resource &&
					(resource.kind === "file" || resource.kind === "diff" || resource.kind === "changes")
					? [layoutResourceIdentity(resource)]
					: [];
			}),
		);
		for (const tab of collectAllGroups(document).flatMap((group) => group.tabs)) {
			if (tab.kind !== "file" && tab.kind !== "diff" && tab.kind !== "changes") continue;
			const identity = layoutResourceIdentity(tab);
			if (cachedResources.has(identity)) continue;
			if (tab.kind === "changes") {
				useAppStore
					.getState()
					.openTab(createChangesTab(workspaceId, tab.id, tab.name, tab.scope), "keep", false, {
						activate: false,
					});
				continue;
			}
			if (isFileComparison(tab)) {
				useAppStore
					.getState()
					.openTab(
						{ ...fileComparisonTab(workspaceId, tab.before, tab.path), id: tab.id },
						"keep",
						false,
						{ activate: false },
					);
				continue;
			}
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
					.then(({ content, meta }) => {
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
								meta,
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
					.then(({ original, modified, meta, originalOid }) => {
						const latest = useAppStore.getState();
						if (!current || !isConnectedGeneration(latest, connectionGeneration)) return;
						const placed = currentPlacement();
						if (placed?.kind !== "diff" || isFileComparison(placed) || cacheArrived()) return;
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
								meta,
								originalOid,
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

	const terminalByKey = useMemo(
		() => new Map(terminals.map((tab) => [tab.tabKey, tab])),
		[terminals],
	);
	const pendingProjection = useMemo(
		() =>
			(document && attention) || !frame
				? null
				: emptyWorkspaceProjection(frame, workspaceProjectionReference(workspaceId)),
		[attention, document, frame, workspaceId],
	);
	const chatFirstPrompts = useAppStore(
		useShallow((state) => selectUnnamedChatFirstPrompts(state, workspaceId)),
	);
	const rendered = document && attention ? { document, attention } : pendingProjection;

	const renderResourceBody = useCallback(
		(tab: LayoutCenterTab | Extract<LayoutTab, { kind: "terminal" }>) => {
			if (tab.kind === "chat") {
				return <ChatResourceBody workspaceId={workspaceId} tab={tab} onOpenFile={openToolFile} />;
			}
			if (tab.kind === "document") {
				if (deletedSessions?.[tab.sourceId]) return <MissingResource kind="plan" />;
				return (
					<ErrorBoundary
						label={t("shell.workbench.panel.plan")}
						reportId="plan"
						resetKeys={[workspaceId, tab.id]}
					>
						<Suspense fallback={<MissingResource kind="plan" />}>
							<PlanPane workspaceId={workspaceId} sessionId={tab.sourceId} />
						</Suspense>
					</ErrorBoundary>
				);
			}
			if (tab.kind === "terminal") {
				const terminal = terminalByKey.get(tab.tabKey);
				const location = document ? findTabLocation(document, tab.id) : null;
				return (
					<ErrorBoundary
						label={t("shell.workbench.panel.terminal")}
						reportId="terminal"
						resetKeys={[workspaceId, tab.id]}
					>
						{terminal ? (
							<TerminalWorkbenchBody
								tab={terminal}
								onAdd={() =>
									useAppStore
										.getState()
										.addTerminal(workspaceId, undefined, location?.groupId, location?.area)
								}
							/>
						) : (
							<MissingResource kind="terminal" />
						)}
					</ErrorBoundary>
				);
			}
			return <EditorResourceBody workspaceId={workspaceId} tab={tab} />;
		},
		[deletedSessions, document, openToolFile, t, terminalByKey, workspaceId],
	);
	const renderTabBody = useCallback(
		(tab: LayoutCenterTab | Extract<LayoutTab, { kind: "terminal" }>) => (
			<Fragment key={workspaceId}>{renderResourceBody(tab)}</Fragment>
		),
		[renderResourceBody, workspaceId],
	);

	const toolBodies = useMemo<Record<LayoutToolId, ReactNode>>(() => {
		const bodies: Record<LayoutToolId, ReactNode> = {
			projects: (
				<QuietScrollArea
					data-testid="left-nav"
					className="h-full"
					viewportClassName="p-panel-inset"
				>
					<ProjectTree />
				</QuietScrollArea>
			),
			specs: (
				<QuietScrollArea className="h-full" viewportClassName="p-panel-inset">
					<SpecsPanel workspaceId={workspaceId} failed={specs.failed} onRetry={specs.reload} />
				</QuietScrollArea>
			),
			files: <FilesPanel key={workspaceId} workspaceId={workspaceId} />,
			review: <ReviewPanel key={workspaceId} workspaceId={workspaceId} failed={review.failed} />,
			plan: railPlanSessionId ? (
				<ErrorBoundary
					label={t("shell.workbench.panel.planRail")}
					reportId="plan_rail"
					resetKeys={[workspaceId, railPlanSessionId]}
				>
					<Suspense fallback={<MissingResource kind="plan" />}>
						<PlanRailPane workspaceId={workspaceId} sessionId={railPlanSessionId} />
					</Suspense>
				</ErrorBoundary>
			) : (
				<div
					data-testid="plan-rail-empty"
					className="flex h-full items-center justify-center p-16 text-text-subtle tr-text-ui"
				>
					{t("shell.workbench.planRailEmpty")}
				</div>
			),
		};
		for (const tool of Object.keys(bodies) as LayoutToolId[]) {
			bodies[tool] = (
				<ErrorBoundary
					label={t("shell.workbench.panel.tool", { tool })}
					reportId={`${tool}_tool`}
					resetKeys={[workspaceId, tool]}
				>
					{bodies[tool]}
				</ErrorBoundary>
			);
		}
		return bodies;
	}, [railPlanSessionId, review.failed, specs.failed, specs.reload, t, workspaceId]);
	const renderToolBody = useCallback((tool: LayoutToolId) => toolBodies[tool], [toolBodies]);

	const isDefault = workspace != null && isDefaultWorkspace(workspace);
	const isExternal = workspace != null && isExternalWorkspace(workspace);

	const startChat = useCallback(
		(groupId: string) => {
			const currentAttention = useAppStore.getState().layoutAttentionByWorkspace[workspaceId];
			if (!currentAttention) return;
			changeAttention({ ...currentAttention, lastFocusedCenterGroupId: groupId });
			void startChatInTab(workspaceId, groupId);
		},
		[changeAttention, workspaceId],
	);

	const renderTabAdornment = useCallback(
		(tab: LayoutTab): ReactNode => {
			if (tab.kind === "tool" && tab.tool === "review" && reviewDraftCount > 0) {
				return (
					<span
						data-testid="review-pending-badge"
						className="inline-flex min-w-16 items-center justify-center rounded-full bg-primary px-2 tr-text-label-pill text-text-on-primary"
					>
						{reviewDraftCount}
					</span>
				);
			}
			if (tab.kind !== "file" && tab.kind !== "diff") return null;
			const flag = reviewFlagForPaths(reviewFlagByPath, tabReviewPaths(tab));
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
					{t("shell.workbench.reviewFlag")}
				</span>
			) : null;
		},
		[reviewDraftCount, reviewFlagByPath, t],
	);

	const renderEmptyCenter = useCallback(
		(groupId: string): ReactNode => (
			<div
				data-testid="workspace-ready"
				className="flex h-full flex-col items-center justify-center gap-4 px-16 text-center"
			>
				<span className="tr-text-eyebrow text-text-muted">
					{isDefault
						? t("shell.workbench.ready.defaultEyebrow")
						: isExternal
							? t("shell.workbench.ready.externalEyebrow")
							: t("shell.workbench.ready.worktreeEyebrow")}
				</span>
				{workspace ? (
					<>
						<h2 className="max-w-full truncate tr-title-entity text-text-default">
							{isDefault ? (contextProject?.name ?? workspaceName(t, workspace)) : workspace.name}
						</h2>
						<p className="flex max-w-full items-center gap-4 tr-text-metadata text-text-muted">
							<GitBranch className="size-14 shrink-0" />
							{isDefault || isExternal ? (
								<span className="truncate">
									{t("shell.workbench.ready.onBranch", { branch: workspace.branch })}
								</span>
							) : (
								<>
									<span className="truncate">{workspace.branch}</span>
									<span className="shrink-0 text-text-muted">
										{t("shell.workbench.ready.fromBase", { base: workspace.baseBranch })}
									</span>
								</>
							)}
						</p>
					</>
				) : null}
				<p className="mt-4 tr-text-ui text-text-muted">
					{isDefault
						? t("shell.workbench.ready.defaultDescription")
						: t("shell.workbench.ready.worktreeDescription")}
				</p>
				<Button
					variant="outline"
					size="m"
					iconLeft={MessageSquarePlus}
					loading={chatStarting}
					data-testid="start-chat"
					data-starting={chatStarting || undefined}
					disabled={chatStarting}
					onClick={() => startChat(groupId)}
					className="mt-4"
				>
					{chatStarting
						? t("shell.workbench.ready.startingChat")
						: t("shell.workbench.ready.newChat")}
				</Button>
			</div>
		),
		[chatStarting, contextProject, isDefault, isExternal, startChat, t, workspace],
	);

	const renderCenterActions = useCallback(
		(groupId: string): ReactNode => (
			<>
				<WorkspaceChatHistory
					key={workspaceId}
					workspaceId={workspaceId}
					targetGroupId={groupId}
					{...(canRenameChat ? { onRenameChat: requestRenameChat } : {})}
				/>
				<IconButton
					variant="ghost"
					size="m"
					icon={SquareTerminal}
					label={t("shell.workbench.newTerminal")}
					data-testid="new-terminal"
					onClick={() => useAppStore.getState().addTerminal(workspaceId, undefined, groupId)}
					className="shrink-0 self-center"
				/>
			</>
		),
		[canRenameChat, requestRenameChat, t, workspaceId],
	);

	if (!rendered) {
		return (
			<div className="flex h-full items-center justify-center bg-container-content-bg tr-text-ui text-text-muted">
				{t("shell.workbench.restoringLayout")}
			</div>
		);
	}

	return (
		<div data-testid="workspace-workbench" data-layout-status="settled" className="contents">
			{planSessionIds.map((sessionId) => (
				<PlanSummaryAutoDraft
					key={`plan-summary-draft:${workspaceId}:${sessionId}`}
					workspaceId={workspaceId}
					sessionId={sessionId}
				/>
			))}
			<Workbench
				workspaceId={workspaceId}
				worktreePath={workspace?.worktreePath ?? ""}
				document={rendered.document}
				attention={rendered.attention}
				maxSideGroups={layoutPreferences.maxSideGroups}
				maxBottomGroups={layoutPreferences.maxBottomGroups}
				projectionEpoch={projectionEpoch}
				{...(focusRequest ? { focusRequest } : {})}
				subscribeCloseRequest={subscribeCloseRequest}
				renderTabBody={renderTabBody}
				renderTabAdornment={renderTabAdornment}
				renderToolBody={renderToolBody}
				renderEmptyCenter={renderEmptyCenter}
				renderCenterActions={renderCenterActions}
				onCommit={commit}
				onAttentionChange={changeAttention}
				onUserNavigation={() => useAppStore.getState().noteNavigation(workspaceId)}
				readNavigationTick={() => selectWorkspaceNavTick(useAppStore.getState(), workspaceId)}
				{...(canRenameChat ? { onRenameChat: requestRenameChat } : {})}
				chatFirstPrompts={chatFirstPrompts}
				onRequestClose={(tab, prepare) => {
					if (tab.kind === "terminal") {
						const close = () => {
							const state = useAppStore.getState();
							if (state.removedWorkspaceIds[workspaceId]) return;
							const latest = state.layoutDocumentsByWorkspace[workspaceId];
							const prepared = prepare(latest);
							if (!latest || prepared.document !== latest) {
								void commitWorkspaceLayout(
									workspaceId,
									prepared.document,
									latest ? { baseDocument: latest } : {},
								).catch(() => {});
							}
							const finalState = useAppStore.getState();
							const finalDocument = finalState.layoutDocumentsByWorkspace[workspaceId];
							const finalAttention = finalState.layoutAttentionByWorkspace[workspaceId];
							prepared.onAccepted(
								finalDocument && finalAttention
									? { document: finalDocument, attention: finalAttention }
									: undefined,
							);
						};
						const terminal = terminalByKey.get(tab.tabKey);
						if (terminal) terminalClose.requestClose(terminal, close);
						else close();
						return;
					}
					const prepared = prepare();
					const closedIdentity = layoutResourceIdentity(tab);
					void commitWorkspaceLayout(
						workspaceId,
						prepared.document,
						document ? { baseDocument: document } : {},
					)
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
							const currentAttention = state.layoutAttentionByWorkspace[workspaceId];
							prepared.onAccepted(
								current && currentAttention
									? { document: current, attention: currentAttention }
									: undefined,
							);
							if (tab.kind === "chat") {
								state.closeChatToHistory(tab.sessionId, false, workspaceId, false);
							} else if (
								tab.kind === "file" ||
								tab.kind === "diff" ||
								tab.kind === "changes" ||
								tab.kind === "document"
							) {
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
				onNewTerminal={(groupId, area, options) =>
					useAppStore
						.getState()
						.addTerminal(
							workspaceId,
							undefined,
							groupId,
							area,
							true,
							undefined,
							options?.newPaneBelow === true,
						)
				}
				onGestureCanceled={() => toast.info(t("shell.workbench.gestureCanceled"))}
			/>
			{terminalClose.confirmation}
		</div>
	);
}
