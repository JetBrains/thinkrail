import { MessageSquarePlus, X } from "lucide-react";
import { lazy, Suspense } from "react";
import { type EditorTab, useAppStore } from "../store";
import { getTransport } from "../transport";

// Monaco + the chat view are heavy — load each only when its tab is first shown (protects first paint).
const MonacoEditor = lazy(() => import("./MonacoEditor"));
const ChatView = lazy(() => import("./ChatView"));

// Stable empty reference so the selector doesn't re-render the component on unrelated state changes.
const NO_TABS: EditorTab[] = [];

/** The center area: a strip of the active workspace's tabs (files + chats) over the active tab. */
export function CenterTabs() {
	const activeWorkspaceId = useAppStore((s) => s.activeWorkspaceId);
	const tabsByWorkspace = useAppStore((s) => s.tabsByWorkspace);
	const activeTabByWorkspace = useAppStore((s) => s.activeTabByWorkspace);
	const setActiveTab = useAppStore((s) => s.setActiveTab);
	const closeTab = useAppStore((s) => s.closeTab);

	const openTabs = activeWorkspaceId ? (tabsByWorkspace[activeWorkspaceId] ?? NO_TABS) : NO_TABS;
	const activeTabId = activeWorkspaceId ? (activeTabByWorkspace[activeWorkspaceId] ?? null) : null;

	const startChat = async () => {
		if (!activeWorkspaceId) return;
		try {
			const { sessionId } = await getTransport().request("session.create", {
				workspaceId: activeWorkspaceId,
			});
			useAppStore.getState().openChatSession(activeWorkspaceId, sessionId);
		} catch {
			// Ignored until the error-handling pass.
		}
	};

	// Closing a chat tab disposes its in-process AgentSession; file tabs just close.
	const onCloseTab = (tab: EditorTab) => {
		if (tab.kind === "chat") {
			void getTransport()
				.request("session.dispose", { sessionId: tab.sessionId })
				.catch(() => {});
		}
		closeTab(tab.id);
	};

	if (openTabs.length === 0) {
		return (
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
	}

	const active = openTabs.find((t) => t.id === activeTabId) ?? null;

	return (
		<div className="flex h-full min-h-0 flex-col">
			<div
				role="tablist"
				className="flex h-8 shrink-0 items-stretch overflow-x-auto border-b border-border2 bg-bg-dark"
			>
				{openTabs.map((tab) => {
					const isActive = tab.id === activeTabId;
					return (
						<div
							key={tab.id}
							data-testid="editor-tab"
							data-active={isActive}
							data-kind={tab.kind}
							className={`group flex items-center gap-xs border-r border-border2 pl-sm pr-xs text-sm ${
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
			<div data-testid="editor-pane" className="min-h-0 flex-1">
				{active ? (
					<Suspense
						fallback={
							<div className="flex h-full items-center justify-center text-hint">Loading…</div>
						}
					>
						{active.kind === "chat" ? (
							<ChatView key={active.id} sessionId={active.sessionId} />
						) : (
							<MonacoEditor key={active.id} path={active.path} content={active.content} />
						)}
					</Suspense>
				) : null}
			</div>
		</div>
	);
}
