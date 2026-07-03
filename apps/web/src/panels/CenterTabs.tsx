import { History, MessageSquarePlus, RotateCcw, X } from "lucide-react";
import { lazy, Suspense, useEffect } from "react";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { messagesToRuntime } from "../chat/hydrate";
import { type ClosedChat, type EditorTab, useAppStore } from "../store";
import { getTransport } from "../transport";

// Monaco + the chat view are heavy — load each only when its tab is first shown (protects first paint).
const MonacoEditor = lazy(() => import("./MonacoEditor"));
const ChatView = lazy(() => import("../chat/ChatView"));

// Stable empty references so selectors don't re-render the component on unrelated state changes.
const NO_TABS: EditorTab[] = [];
const NO_CLOSED: ClosedChat[] = [];

function relativeTime(ms: number): string {
	const s = Math.floor((Date.now() - ms) / 1000);
	if (s < 60) return "just now";
	const m = Math.floor(s / 60);
	if (m < 60) return `${m}m ago`;
	const h = Math.floor(m / 60);
	if (h < 24) return `${h}h ago`;
	return `${Math.floor(h / 24)}d ago`;
}

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
				className="flex shrink-0 items-center border-border2 border-l px-sm text-hint outline-none hover:bg-hover hover:text-text focus-visible:ring-2 focus-visible:ring-primary"
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
						<span className="shrink-0 text-hint text-xs">{relativeTime(c.closedAt)}</span>
						<RotateCcw className="size-3.5 shrink-0 text-muted" />
					</DropdownMenuItem>
				))}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

/** The center area: a strip of the active workspace's tabs (files + chats) over the active tab. */
export function CenterTabs() {
	const activeWorkspaceId = useAppStore((s) => s.activeWorkspaceId);
	const tabsByWorkspace = useAppStore((s) => s.tabsByWorkspace);
	const activeTabByWorkspace = useAppStore((s) => s.activeTabByWorkspace);
	const closedChatsByWorkspace = useAppStore((s) => s.closedChatsByWorkspace);
	const setActiveTab = useAppStore((s) => s.setActiveTab);
	const closeTab = useAppStore((s) => s.closeTab);

	const openTabs = activeWorkspaceId ? (tabsByWorkspace[activeWorkspaceId] ?? NO_TABS) : NO_TABS;
	const activeTabId = activeWorkspaceId ? (activeTabByWorkspace[activeWorkspaceId] ?? null) : null;
	const closedChats = activeWorkspaceId
		? (closedChatsByWorkspace[activeWorkspaceId] ?? NO_CLOSED)
		: NO_CLOSED;

	// Hydrate-on-connect: when a workspace becomes active, pull its sessions from the host. Live ones (still
	// in host memory) auto-restore as tabs; disk-only ones (survived a host restart) go to chat-history to
	// reopen on demand. So a reload, a second tab, or a restart all rebuild from the host.
	useEffect(() => {
		if (!activeWorkspaceId) return;
		let cancelled = false;
		void getTransport()
			.request("session.list", { workspaceId: activeWorkspaceId })
			.then(async (summaries) => {
				const diskOnly: ClosedChat[] = [];
				for (const summary of summaries) {
					if (cancelled) return;
					if (useAppStore.getState().sessions[summary.sessionId]) continue; // already hydrated/live here
					if (!summary.live) {
						diskOnly.push({
							sessionId: summary.sessionId,
							title: summary.title,
							closedAt: summary.updatedAt,
						});
						continue;
					}
					try {
						const { summary: fresh, messages } = await getTransport().request(
							"session.getMessages",
							{ sessionId: summary.sessionId, workspaceId: activeWorkspaceId },
						);
						if (cancelled) return;
						const { turns, toolResults } = messagesToRuntime(messages);
						useAppStore.getState().hydrateSession(fresh, turns, toolResults);
					} catch {
						// Skip a session that failed to load; the others still hydrate.
					}
				}
				if (!cancelled && diskOnly.length > 0) {
					useAppStore.getState().noteClosedChats(activeWorkspaceId, diskOnly);
				}
			})
			.catch(() => {});
		return () => {
			cancelled = true;
		};
	}, [activeWorkspaceId]);

	// Reopen a chat from history: a live runtime just restores its tab; a disk-only one is re-opened on the
	// host, its transcript fetched, then hydrated + focused (hydrateSession drops it from history, keyed to
	// the session's own workspace — robust to a workspace switch during the fetch).
	const onReopenChat = async (sessionId: string) => {
		const store = useAppStore.getState();
		if (store.sessions[sessionId]) {
			store.reopenChat(sessionId);
			return;
		}
		if (!activeWorkspaceId) return;
		try {
			const { summary, messages } = await getTransport().request("session.getMessages", {
				sessionId,
				workspaceId: activeWorkspaceId,
			});
			const { turns, toolResults } = messagesToRuntime(messages);
			useAppStore.getState().hydrateSession(summary, turns, toolResults, true);
		} catch {
			// Leave it in history if the re-open failed.
		}
	};

	const startChat = async () => {
		if (!activeWorkspaceId) return;
		try {
			const { sessionId, model, thinkingLevel } = await getTransport().request("session.create", {
				workspaceId: activeWorkspaceId,
			});
			useAppStore.getState().openChatSession(activeWorkspaceId, sessionId, model, thinkingLevel);
		} catch {
			// Ignored until the error-handling pass.
		}
	};

	// Closing a chat tab moves it to history (its session + runtime stay alive so it can be reopened with
	// full state); file tabs just close.
	const onCloseTab = (tab: EditorTab) => {
		if (tab.kind === "chat") useAppStore.getState().closeChatToHistory(tab.sessionId);
		else closeTab(tab.id);
	};

	const placeholder = (
		<div className="flex h-full flex-col items-center justify-center gap-sm text-hint">
			<span>Open a file or start a chat</span>
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

	// Nothing open and nothing to reopen → just the centered prompt.
	if (openTabs.length === 0 && closedChats.length === 0) return placeholder;

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
								<button
									type="button"
									data-testid="editor-tab-close"
									aria-label={`Close ${tab.name}`}
									onClick={() => onCloseTab(tab)}
									className="rounded-[var(--radius-sm)] p-0.5 text-hint opacity-0 hover:bg-hover hover:text-text group-hover:opacity-100"
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
							className="flex items-center px-sm text-hint hover:bg-hover hover:text-text"
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
						) : (
							<MonacoEditor key={active.id} path={active.path} content={active.content} />
						)}
					</Suspense>
				) : (
					placeholder
				)}
			</div>
		</div>
	);
}
