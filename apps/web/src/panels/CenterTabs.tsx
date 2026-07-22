import { FileText, GitBranch, GitCompare, History, MessageSquarePlus, X } from "lucide-react";
import { lazy, Suspense, useEffect } from "react";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { Tip } from "@/components/Tip";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { messagesToRuntime } from "../chat/hydrate";
import {
	type DocHistoryEntry,
	type EditorTab,
	selectActiveWorkspace,
	toast,
	useAppStore,
} from "../store";
import { errorText, getTransport } from "../transport";
import { FilePane } from "./FilePane";
import { openDiffInTab, openFileInTab } from "./openFile";

// The chat view is heavy — load it only when its tab is first shown (protects first paint). File panes
// lazy-load their own Monaco / markdown chunks inside `FilePane`.
const ChatView = lazy(() => import("../chat/ChatView"));
// The diff pane pulls Monaco's diff editor — load it only when a diff tab is first shown.
const DiffPane = lazy(() => import("./DiffPane"));

// Stable empty references so selectors don't re-render the component on unrelated state changes.
const NO_TABS: EditorTab[] = [];
const NO_DOCS: DocHistoryEntry[] = [];

/** History of the last documents opened in this workspace (files + diffs, most-recent-first); picking
 * one re-opens it as a center tab. View state only — never chat. */
function DocHistoryMenu({
	entries,
	onOpen,
}: {
	entries: DocHistoryEntry[];
	onOpen: (entry: DocHistoryEntry) => void;
}) {
	return (
		<DropdownMenu>
			<DropdownMenuTrigger
				data-testid="doc-history"
				aria-label="Recently opened documents"
				title="Recently opened documents"
				className="flex shrink-0 items-center border-border2 border-l px-sm text-hint outline-none hover:bg-hover hover:text-text focus-visible:ring-2 focus-visible:ring-primary"
			>
				<History className="size-4" />
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end" className="min-w-[18rem]">
				<DropdownMenuLabel>Recently opened</DropdownMenuLabel>
				{entries.map((entry) => (
					<DropdownMenuItem
						key={`${entry.kind}:${entry.path}`}
						data-testid="doc-history-item"
						data-kind={entry.kind}
						onSelect={() => onOpen(entry)}
					>
						{entry.kind === "diff" ? (
							<GitCompare className="size-3.5 shrink-0 text-muted" />
						) : (
							<FileText className="size-3.5 shrink-0 text-muted" />
						)}
						<span className="flex-1 truncate">{entry.name}</span>
						<span className="max-w-[9rem] shrink-0 truncate text-hint text-xs">{entry.path}</span>
					</DropdownMenuItem>
				))}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

/** The center area: a strip of the active workspace's tabs (files + chats) over the active tab. */
export function CenterTabs() {
	const activeWorkspaceId = useAppStore((s) => s.activeWorkspaceId);
	const activeWorkspace = useAppStore(selectActiveWorkspace);
	const tabsByWorkspace = useAppStore((s) => s.tabsByWorkspace);
	const activeTabByWorkspace = useAppStore((s) => s.activeTabByWorkspace);
	const docHistoryByWorkspace = useAppStore((s) => s.docHistoryByWorkspace);
	const setActiveTab = useAppStore((s) => s.setActiveTab);
	const closeTab = useAppStore((s) => s.closeTab);

	const openTabs = activeWorkspaceId ? (tabsByWorkspace[activeWorkspaceId] ?? NO_TABS) : NO_TABS;
	const activeTabId = activeWorkspaceId ? (activeTabByWorkspace[activeWorkspaceId] ?? null) : null;
	const docHistory = activeWorkspaceId
		? (docHistoryByWorkspace[activeWorkspaceId] ?? NO_DOCS)
		: NO_DOCS;
	// Hydrate-on-connect: when a workspace becomes active, restore its ONE chat tab from the host. Only
	// ever one chat tab exists (view restriction), so if this workspace already has one, there's nothing
	// to do; otherwise pull the host's sessions and restore the most-recently-updated one (live or
	// disk-only — `session.getMessages` re-opens a disk-only session on the host). Any other host sessions
	// stay alive, just untabbed: the single-chat limit is view-only and never disposes a session.
	useEffect(() => {
		if (!activeWorkspaceId) return;
		const ws = activeWorkspaceId;
		if ((useAppStore.getState().tabsByWorkspace[ws] ?? []).some((t) => t.kind === "chat")) return;
		let cancelled = false;
		void getTransport()
			.request("session.list", { workspaceId: ws })
			.then(async (summaries) => {
				if (cancelled || summaries.length === 0) return;
				const summary = [...summaries].sort((a, b) => b.updatedAt - a.updatedAt)[0];
				if (!summary || useAppStore.getState().sessions[summary.sessionId]) return;
				try {
					const { summary: fresh, messages } = await getTransport().request("session.getMessages", {
						sessionId: summary.sessionId,
						workspaceId: ws,
					});
					if (!cancelled) useAppStore.getState().hydrateSession(fresh, messagesToRuntime(messages));
				} catch {
					// Skip a session that failed to load — the placeholder "New chat" bootstrap still works.
				}
			})
			.catch(() => {});
		return () => {
			cancelled = true;
		};
	}, [activeWorkspaceId]);

	// Re-open a document from History (view state): files re-read fresh, diffs reconstruct — both dedupe
	// to their existing tab if already open.
	const onOpenDoc = (entry: DocHistoryEntry) => {
		if (!activeWorkspaceId) return;
		if (entry.kind === "file") void openFileInTab(activeWorkspaceId, entry.path);
		else openDiffInTab(activeWorkspaceId, entry.path);
	};

	const startChat = async () => {
		if (!activeWorkspaceId) return;
		try {
			const { sessionId, model, thinkingLevel } = await getTransport().request("session.create", {
				workspaceId: activeWorkspaceId,
			});
			useAppStore.getState().openChatSession(activeWorkspaceId, sessionId, model, thinkingLevel);
		} catch (err) {
			// Without this, a failed create makes the "New chat" bootstrap do nothing, silently.
			toast.error(errorText(err), "Couldn't start the chat");
		}
	};

	// Only file/diff tabs are closable (a pure view action); the single chat tab is non-closable, so its
	// session is never touched by the view. (This is only ever called from a file/diff tab's close button.)
	const onCloseTab = (tab: EditorTab) => {
		closeTab(tab.id);
	};

	const placeholder = (
		<div className="flex h-full flex-col items-center justify-center gap-md px-lg text-center text-hint">
			{activeWorkspace ? (
				<div
					data-testid="workspace-ready"
					className="flex max-w-[440px] flex-col items-center gap-xs"
				>
					<span className="font-medium text-hint text-xs uppercase tracking-wider">
						Workspace ready
					</span>
					<h2 className="max-w-full truncate font-medium text-md text-text">
						{activeWorkspace.name}
					</h2>
					<p className="flex max-w-full items-center gap-xs font-[var(--font-mono)] text-muted text-xs">
						<GitBranch className="size-3.5 shrink-0" />
						<span className="truncate">{activeWorkspace.branch}</span>
						<span className="shrink-0 text-hint">· from {activeWorkspace.baseBranch}</span>
					</p>
					<p className="mt-xs text-muted text-sm">
						Files, chats, changes, and terminals are scoped to this workspace.
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
					className="flex items-center gap-xs rounded-[var(--radius-md)] border border-border2 bg-elevated px-md py-xs text-sm text-text hover:bg-hover"
				>
					<MessageSquarePlus className="size-4" /> New chat
				</button>
			) : null}
		</div>
	);

	// Nothing open → just the centered prompt (which carries the single-chat bootstrap).
	if (openTabs.length === 0) return placeholder;

	const active = openTabs.find((t) => t.id === activeTabId) ?? null;

	return (
		<div className="flex h-full min-h-0 flex-col">
			<div className="flex h-8 shrink-0 items-stretch border-border2 border-b bg-bg-dark">
				<div role="tablist" className="flex flex-1 items-stretch overflow-x-auto">
					{openTabs.map((tab) => {
						const isActive = tab.id === activeTabId;
						return (
							<div
								key={tab.id}
								data-testid="editor-tab"
								data-active={isActive}
								data-kind={tab.kind}
								className={`group flex items-center gap-xs border-border2 border-r pr-xs pl-sm text-sm ${
									isActive ? "bg-bg text-text" : "text-muted hover:bg-hover"
								}`}
							>
								<button
									type="button"
									className="max-w-[160px] truncate py-xs"
									onClick={() => setActiveTab(tab.id)}
								>
									{tab.name}
								</button>
								{/* The single chat tab is non-closable (view-only limit); file/diff tabs close freely. */}
								{tab.kind === "chat" ? null : (
									<Tip side="bottom" label="Close tab (keeps the session running)">
										<button
											type="button"
											data-testid="editor-tab-close"
											aria-label={`Close ${tab.name}`}
											onClick={() => onCloseTab(tab)}
											className="rounded-[var(--radius-sm)] p-0.5 text-hint opacity-0 hover:bg-hover hover:text-text group-hover:opacity-100"
										>
											<X className="size-3.5" />
										</button>
									</Tip>
								)}
							</div>
						);
					})}
				</div>
				{docHistory.length > 0 ? <DocHistoryMenu entries={docHistory} onOpen={onOpenDoc} /> : null}
			</div>
			<div data-testid="editor-pane" className="min-h-0 flex-1">
				{active ? (
					// Per-tab boundary: a tab's crash/failed lazy-load stays contained; switching tabs (new `active.id`) resets it.
					<ErrorBoundary label={active.kind === "chat" ? "chat" : "editor"} resetKeys={[active.id]}>
						<Suspense
							fallback={
								<div className="flex h-full items-center justify-center text-hint">Loading…</div>
							}
						>
							{active.kind === "chat" ? (
								<ChatView
									key={active.id}
									sessionId={active.sessionId}
									workspaceId={active.workspaceId}
								/>
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
