import {
	GitBranch,
	GitCompareArrows,
	History,
	MessageSquarePlus,
	RotateCcw,
	X,
} from "lucide-react";
import { lazy, Suspense, useEffect, useMemo } from "react";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { relativeTime } from "@/lib";
import { messagesToRuntime } from "../chat/hydrate";
import {
	type ClosedChat,
	type DocTab,
	type EditorTab,
	isDefaultWorkspace,
	isExternalWorkspace,
	selectActiveWorkspace,
	selectContextProject,
	selectWorkspaceTick,
	toast,
	useAppStore,
} from "../store";
import { errorText, getTransport } from "../transport";
import { DiffPane } from "./DiffPane";
import { FilePane } from "./FilePane";
import { openChatInTab } from "./openChat";
import { type ReviewFlag, reviewFlags } from "./reviewModel";

// The chat view is heavy — load it only when its tab is first shown (protects first paint). File panes
// lazy-load their own Monaco / markdown chunks inside `FilePane`.
const ChatView = lazy(() => import("../chat/ChatView"));
// The rendered-markdown preview (markdown + shiki) — reused for ephemeral `doc` tabs; lazy like FilePane's.
const MarkdownPreview = lazy(() => import("./MarkdownPreview"));

/** An ephemeral `doc` tab: rendered markdown from inline content, no fs/source toggle (see `DocTab`). */
function DocPane({ tab }: { tab: DocTab }) {
	return <MarkdownPreview content={tab.content} workspaceId={tab.workspaceId} path={tab.docPath} />;
}

/**
 * A file/diff tab's review marker. It has TWO states rather than being present-or-absent, because
 * "in review" and "there is something to send" are different facts: violet while the file holds an
 * UNSENT draft (actionable — the pane toolbar's `Send review` is showing too), muted once only sent
 * comments remain. A file the chat is actively working through must not read as untouched in the tab
 * strip while the Review rail insists it is in review.
 */
function ReviewTabFlag({ flag }: { flag: ReviewFlag | null }) {
	if (!flag) return null;
	return (
		<span
			data-testid="review-tab-flag"
			data-flag={flag}
			title={flag === "draft" ? "Unsent review comments" : "Review in progress"}
			className={`shrink-0 tr-text-eyebrow ${flag === "draft" ? "text-primary" : "text-text-subtle"}`}
		>
			Review
		</span>
	);
}

/**
 * How many chats auto-open on workspace entry (newest first). Unfinished work should be in front of the
 * user, but a workspace that has accumulated a dozen half-finished chats must not open a dozen tabs and
 * load a dozen transcripts — past this, they stay one click away in chat-history.
 */
const AUTO_OPEN_LIMIT = 4;

// Stable empty references so selectors don't re-render the component on unrelated state changes.
const NO_TABS: EditorTab[] = [];
const NO_CLOSED: ClosedChat[] = [];

/** Dropdown of chats closed in this workspace; picking one reopens it (and removes it from history). */
function ChatHistoryMenu({
	closedChats,
	onReopen,
}: {
	closedChats: ClosedChat[];
	onReopen: (sessionId: string) => void;
}) {
	return (
		<DropdownMenu>
			<DropdownMenuTrigger
				data-testid="chat-history"
				aria-label="Reopen a closed chat"
				title="View chat history"
				className="flex shrink-0 items-center border-border-default border-l px-sm text-text-muted outline-none hover:bg-control-bg-hovered hover:text-text-default focus-visible:ring-2 focus-visible:ring-primary"
			>
				<History className="size-4" />
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end" className="min-w-[16rem]">
				<DropdownMenuLabel>Recently closed</DropdownMenuLabel>
				{closedChats.map((c) => (
					<DropdownMenuItem
						key={c.sessionId}
						data-testid="closed-chat-item"
						data-session-id={c.sessionId}
						onSelect={() => onReopen(c.sessionId)}
					>
						<span className="flex-1 truncate">{c.title}</span>
						<span className="shrink-0 text-text-muted tr-text-metadata">
							{relativeTime(c.closedAt)}
						</span>
						<RotateCcw className="size-3.5 shrink-0 text-text-muted" />
					</DropdownMenuItem>
				))}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

/**
 * The center area: a strip of the active workspace's tabs (files + chats) over the active tab. One tab in
 * the strip may be the workspace's **preview** tab — the reusable slot light opens land in, rendered in
 * italics and promoted by a double click (see `SPEC.md`'s gesture map).
 */
export function CenterTabs() {
	const activeWorkspaceId = useAppStore((s) => s.activeWorkspaceId);
	const activeWorkspace = useAppStore(selectActiveWorkspace);
	const contextProject = useAppStore(selectContextProject);
	const tabsByWorkspace = useAppStore((s) => s.tabsByWorkspace);
	const activeTabByWorkspace = useAppStore((s) => s.activeTabByWorkspace);
	const previewTabByWorkspace = useAppStore((s) => s.previewTabByWorkspace);
	const closedChatsByWorkspace = useAppStore((s) => s.closedChatsByWorkspace);
	const chatLocationRequest = useAppStore((s) => s.chatLocationRequest);
	const setActiveTab = useAppStore((s) => s.setActiveTab);
	const closeTab = useAppStore((s) => s.closeTab);

	const openTabs = activeWorkspaceId ? (tabsByWorkspace[activeWorkspaceId] ?? NO_TABS) : NO_TABS;
	// Review is self-announcing (panels/SPEC.md): tabs whose file is still in review wear a flag, loud
	// for unsent drafts and quiet once the chat has them — derived once per snapshot here, not per tab.
	const reviewComments = useAppStore((s) =>
		activeWorkspaceId ? s.reviewsByWorkspace[activeWorkspaceId]?.comments : undefined,
	);
	const reviewFlagByPath = useMemo(() => reviewFlags(reviewComments), [reviewComments]);
	const activeTabId = activeWorkspaceId ? (activeTabByWorkspace[activeWorkspaceId] ?? null) : null;
	const previewTabId = activeWorkspaceId
		? (previewTabByWorkspace[activeWorkspaceId] ?? null)
		: null;
	const closedChats = activeWorkspaceId
		? (closedChatsByWorkspace[activeWorkspaceId] ?? NO_CLOSED)
		: NO_CLOSED;
	// Hydrate-on-connect: when a workspace becomes active, pull its sessions from the host. Live ones (still
	// in host memory) auto-restore as tabs, and so do disk-only ones carrying unfinished TODOs (work in
	// progress must survive a host restart as open tabs, not history entries) — the newest
	// `AUTO_OPEN_LIMIT` of them (see the const). Everything else goes to chat-history, one click away. If
	// nothing opened at all, the most recent of those opens as a fallback — the center is never empty when
	// the workspace has any chat. So a reload, a second tab, or a restart all rebuild from the host.
	//
	// Every transcript is requested up front and *applied* newest-first, so the reads overlap while focus
	// stays deterministic: `hydrateSession` takes focus only while the workspace has no active tab, and
	// that is decided when a store write lands, not when its request goes out.
	useEffect(() => {
		if (!activeWorkspaceId) return;
		const workspaceId = activeWorkspaceId;
		let cancelled = false;
		// Sync baseline for disk-only attaches, snapshotted before the fetches (see selectWorkspaceTick).
		const syncedTick = selectWorkspaceTick(useAppStore.getState(), workspaceId);
		// Split into request + apply so a batch can have its reads in flight together while the *writes*
		// still land in a chosen order (focus follows the first write, not the first response).
		const fetchMessages = (sessionId: string) =>
			getTransport()
				.request("session.getMessages", { sessionId, workspaceId })
				// A session that failed to load is skipped; the others still hydrate.
				.catch(() => null);
		const applyHydrate = (result: Awaited<ReturnType<typeof fetchMessages>>, live: boolean) => {
			if (!result || cancelled) return;
			// A live restore reused the server's already-loaded resources → no baseline (stays
			// conservatively stale); a disk attach reloaded against current disk → the pre-fetch tick.
			const tick = live ? undefined : syncedTick;
			useAppStore
				.getState()
				.hydrateSession(result.summary, messagesToRuntime(result.messages), false, tick);
		};
		const hydrateFromHost = async (sessionId: string, live: boolean) =>
			applyHydrate(await fetchMessages(sessionId), live);
		void getTransport()
			.request("session.list", { workspaceId })
			.then(async (summaries) => {
				// Not "disk-only" any more: past the cap a *live* session lands here too — this is simply
				// everything the pass chose not to auto-open.
				const toHistory: typeof summaries = [];
				const toOpen: typeof summaries = [];
				// A session already in this client's store but without a tab was closed to history *here* —
				// its presence vetoes the open-something fallback below, so the fallback never undoes a close
				// the user just made. (Closes aren't persisted, so after a reload a closed chat is
				// indistinguishable from any other disk chat and the fallback may reopen it.)
				let sawKnown = false;
				// Newest-first, so the most recently active chat hydrates (and takes focus) first.
				const ordered = [...summaries].sort((a, b) => b.updatedAt - a.updatedAt);
				for (const summary of ordered) {
					if (useAppStore.getState().sessions[summary.sessionId]) {
						sawKnown = true; // already hydrated/live here
						continue;
					}
					const wanted = summary.live || (summary.openTodos ?? 0) > 0;
					if (wanted && toOpen.length < AUTO_OPEN_LIMIT) toOpen.push(summary);
					else toHistory.push(summary);
				}
				if (cancelled) return;
				// All reads start now; applying them newest-first keeps focus deterministic (see above).
				const inFlight = toOpen.map((s) => ({ live: s.live, result: fetchMessages(s.sessionId) }));
				for (const { live, result } of inFlight) applyHydrate(await result, live);
				if (cancelled) return;
				// Fallback: nothing opened (and nothing was deliberately closed) → open the newest disk chat.
				const state = useAppStore.getState();
				const hasChatTab = (state.tabsByWorkspace[workspaceId] ?? []).some(
					(t) => t.kind === "chat",
				);
				if (!hasChatTab && !sawKnown && toHistory.length > 0) {
					const newest = toHistory.shift(); // `ordered` kept them newest-first
					if (newest) await hydrateFromHost(newest.sessionId, newest.live);
				}
				if (!cancelled && toHistory.length > 0) {
					useAppStore.getState().noteClosedChats(
						workspaceId,
						toHistory.map((s) => ({
							sessionId: s.sessionId,
							title: s.title,
							closedAt: s.updatedAt,
						})),
					);
				}
			})
			.catch(() => {});
		return () => {
			cancelled = true;
		};
	}, [activeWorkspaceId]);

	// Jump-to-message deep link from history search (`chatLocationRequest`, see `store/SPEC.md`): open,
	// reopen, or activate the target chat in this workspace. `requestChatLocation` already set
	// `activeWorkspaceId` to the request's own workspace, so this only has to place/focus the tab; it
	// deliberately never clears the request — `ChatView` (mounted once its tab is active) consumes it to
	// scroll + flash, and clears it once it has resolved a row (or given up and toasted).
	useEffect(() => {
		if (!chatLocationRequest || chatLocationRequest.workspaceId !== activeWorkspaceId) return;
		const { sessionId } = chatLocationRequest;
		// (a) Already open in a tab — just focus it, the exact action its own tab button calls.
		const tab = openTabs.find((t) => t.kind === "chat" && t.sessionId === sessionId);
		if (tab) {
			setActiveTab(tab.id);
			return;
		}
		const store = useAppStore.getState();
		// (b) Closed to history but its runtime is still live (`closeChatToHistory`, not a restart) —
		// `reopenChat` just re-attaches the tab; no fetch needed.
		if (store.sessions[sessionId]) {
			store.reopenChat(sessionId);
			return;
		}
		// (c) Neither — the same fetch + hydrate `onReopenChat` below does for a disk-only history entry.
		let cancelled = false;
		void getTransport()
			.request("session.getMessages", { sessionId, workspaceId: chatLocationRequest.workspaceId })
			.then(({ summary, messages }) => {
				if (cancelled) return;
				useAppStore.getState().hydrateSession(summary, messagesToRuntime(messages), true);
			})
			.catch((err) => {
				if (cancelled) return;
				// The request would otherwise sit unconsumed forever (its only other consumer, `ChatView`,
				// never mounts for a session whose tab never opens) — say why the jump did nothing.
				toast.error(errorText(err), "Couldn't open the chat");
				useAppStore.getState().clearChatLocation();
			});
		return () => {
			cancelled = true;
		};
	}, [chatLocationRequest, activeWorkspaceId, openTabs, setActiveTab]);

	// Reopen a chat from history — the shared tab→runtime→disk escalation (`openChat.ts`); a failed
	// fetch raises a toast and the entry stays in history for a retry.
	const onReopenChat = async (sessionId: string) => {
		if (!activeWorkspaceId) return;
		await openChatInTab(activeWorkspaceId, sessionId);
	};

	const startChat = async () => {
		if (!activeWorkspaceId) return;
		// Starting a chat is a navigation, even though its tab only appears once the create returns — so a
		// file read still in flight must not activate itself on top of the chat the user asked for.
		useAppStore.getState().noteNavigation(activeWorkspaceId);
		// Snapshot the sync baseline before the create round-trip (see selectWorkspaceTick / openChatSession).
		const syncedTick = selectWorkspaceTick(useAppStore.getState(), activeWorkspaceId);
		try {
			const { sessionId, model, thinkingLevel } = await getTransport().request("session.create", {
				workspaceId: activeWorkspaceId,
			});
			useAppStore
				.getState()
				.openChatSession(activeWorkspaceId, sessionId, model, thinkingLevel, syncedTick);
		} catch (err) {
			// Without this, a failed create makes "+ New chat" do nothing, silently.
			toast.error(errorText(err), "Couldn't start the chat");
		}
	};

	// Closing a chat tab moves it to history (its session + runtime stay alive so it can be reopened with
	// full state); file tabs just close.
	const onCloseTab = (tab: EditorTab) => {
		if (tab.kind === "chat") useAppStore.getState().closeChatToHistory(tab.sessionId);
		else closeTab(tab.id);
	};

	// User-owned workspaces never claim ThinkRail-created provenance. Default runs in the project folder;
	// external is an existing checkout but keeps the normal workspace-scoped tools.
	const isDefault = activeWorkspace != null && isDefaultWorkspace(activeWorkspace);
	const isExternal = activeWorkspace != null && isExternalWorkspace(activeWorkspace);
	const placeholder = (
		<div className="flex h-full flex-col items-center justify-center gap-md px-lg text-center text-text-muted">
			{activeWorkspace ? (
				<div
					data-testid="workspace-ready"
					className="flex max-w-[440px] flex-col items-center gap-xs"
				>
					<span className="tr-text-eyebrow text-text-muted">
						{isDefault ? "Default workspace" : isExternal ? "Existing worktree" : "Workspace ready"}
					</span>
					<h2 className="max-w-full truncate tr-title-entity text-text-default">
						{isDefault ? (contextProject?.name ?? activeWorkspace.name) : activeWorkspace.name}
					</h2>
					<p className="flex max-w-full items-center gap-xs text-text-muted tr-text-metadata">
						<GitBranch className="size-3.5 shrink-0" />
						{isDefault || isExternal ? (
							<span className="truncate">on {activeWorkspace.branch}</span>
						) : (
							<>
								<span className="truncate">{activeWorkspace.branch}</span>
								<span className="shrink-0 text-text-muted">
									· from {activeWorkspace.baseBranch}
								</span>
							</>
						)}
					</p>
					<p className="mt-xs text-text-muted tr-text-ui">
						{isDefault
							? "Chats, changes, and terminals run directly in your project folder."
							: "Files, chats, changes, and terminals are scoped to this workspace."}
					</p>
				</div>
			) : (
				<span>Open a file or start a chat</span>
			)}
			{activeWorkspaceId ? (
				<button
					type="button"
					data-testid="start-chat"
					onClick={() => void startChat()}
					className="flex items-center gap-xs rounded-[var(--radius-md)] border border-border-default bg-container-elevated-bg px-md py-xs tr-text-ui text-text-default hover:bg-control-bg-hovered"
				>
					<MessageSquarePlus className="size-4" /> New chat
				</button>
			) : null}
		</div>
	);

	// Nothing open and nothing to reopen → just the centered prompt.
	if (openTabs.length === 0 && closedChats.length === 0) return placeholder;

	const active = openTabs.find((t) => t.id === activeTabId) ?? null;

	return (
		<div className="flex h-full min-h-0 flex-col">
			<div className="flex h-8 shrink-0 items-stretch border-border-muted border-b bg-container-workspace-bg">
				<div role="tablist" className="flex flex-1 items-stretch overflow-x-auto">
					{openTabs.map((tab) => {
						const isActive = tab.id === activeTabId;
						const isPreview = tab.id === previewTabId;
						return (
							<div
								key={tab.id}
								data-testid="editor-tab"
								data-active={isActive}
								data-preview={isPreview}
								data-kind={tab.kind}
								className={`group flex items-center gap-xs border-border-default border-r pr-xs pl-sm tr-text-ui ${
									isActive
										? "bg-container-workspace-bg text-text-default"
										: "text-text-muted hover:bg-control-bg-hovered"
								}`}
							>
								<button
									type="button"
									className="flex max-w-[180px] items-center gap-xs py-xs"
									title={isPreview ? "Preview — double-click to keep" : undefined}
									// A click on the tab that is BOTH active and in preview keeps it: the one promote
									// gesture a touch device can perform (a double tap is the browser's zoom), and a
									// no-op on desktop otherwise. Anywhere else a click only activates — "preview"
									// here means "leave the slot alone", never demote.
									onClick={() => setActiveTab(tab.id, isActive && isPreview ? "keep" : "preview")}
									onDoubleClick={() => setActiveTab(tab.id, "keep")}
								>
									{tab.kind === "diff" ? (
										<GitCompareArrows className="size-3.5 shrink-0 text-text-muted" />
									) : null}
									<span className={`truncate ${isPreview ? "italic" : ""}`}>{tab.name}</span>
									{(tab.kind === "file" || tab.kind === "diff") && (
										<ReviewTabFlag flag={reviewFlagByPath.get(tab.path) ?? null} />
									)}
								</button>
								<button
									type="button"
									data-testid="editor-tab-close"
									aria-label={`Close ${tab.name}`}
									onClick={() => onCloseTab(tab)}
									className="rounded-[var(--radius-sm)] p-0.5 text-text-muted opacity-0 hover:bg-control-bg-hovered hover:text-text-default group-hover:opacity-100"
								>
									<X className="size-3.5" />
								</button>
							</div>
						);
					})}
					{activeWorkspaceId ? (
						<button
							type="button"
							data-testid="new-chat"
							aria-label="New chat"
							onClick={() => void startChat()}
							className="flex items-center px-sm text-text-muted hover:bg-control-bg-hovered hover:text-text-default"
						>
							<MessageSquarePlus className="size-4" />
						</button>
					) : null}
				</div>
				{closedChats.length > 0 ? (
					<ChatHistoryMenu closedChats={closedChats} onReopen={(id) => void onReopenChat(id)} />
				) : null}
			</div>
			<div data-testid="editor-pane" className="min-h-0 flex-1">
				{active ? (
					// Per-tab boundary: a tab's crash/failed lazy-load stays contained; switching tabs (new `active.id`) resets it.
					<ErrorBoundary label={active.kind === "chat" ? "chat" : "editor"} resetKeys={[active.id]}>
						<Suspense
							fallback={
								<div className="flex h-full items-center justify-center text-text-muted">
									Loading…
								</div>
							}
						>
							{active.kind === "chat" ? (
								<ChatView
									key={active.id}
									sessionId={active.sessionId}
									workspaceId={active.workspaceId}
								/>
							) : active.kind === "doc" ? (
								<DocPane key={active.id} tab={active} />
							) : active.kind === "diff" ? (
								<DiffPane key={active.id} tab={active} />
							) : (
								<FilePane key={active.id} tab={active} />
							)}
						</Suspense>
					</ErrorBoundary>
				) : (
					placeholder
				)}
			</div>
		</div>
	);
}
