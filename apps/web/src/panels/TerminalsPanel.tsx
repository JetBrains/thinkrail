import { GitBranch, History, PanelBottom, Plus, X } from "lucide-react";
import { lazy, Suspense, useEffect } from "react";
import { Tip } from "@/components/Tip";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { selectActiveWorkspace, type TerminalTab, useAppStore } from "../store";

const TerminalInstance = lazy(() => import("./TerminalInstance"));

const NO_TERMINALS: TerminalTab[] = [];

/** MOCK ONLY: a deterministic active(green)/idle(muted) flag for a backgrounded terminal's status dot.
 * There is no real process-state polling or wire call in this change. */
function mockTerminalActive(clientId: string): boolean {
	let h = 0;
	for (const ch of clientId) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
	return h % 2 === 0;
}

/**
 * Lower-right terminals for the active worktree (terminals are worktree-scoped — the shell mounts this
 * only when a workspace is active). One "Terminal 1" tab opens immediately and can't be closed while it's
 * the only tab. Two fixed controls sit right of the tabs: "+" (add) and a background/history control
 * (disabled until a terminal runs in the background, then a menu to reattach one). Closing a tab is a
 * view-only detach (the PTY keeps running in the background). A muted branch label at the bottom names
 * the worktree this terminal belongs to. All instances stay mounted; only the active is shown.
 */
export function TerminalsPanel() {
	const activeWorkspaceId = useAppStore((s) => s.activeWorkspaceId);
	const branch = useAppStore(selectActiveWorkspace)?.branch;
	const togglePanel = useAppStore((s) => s.togglePanel);
	const terminalsByWorkspace = useAppStore((s) => s.terminalsByWorkspace);
	const activeTerminalByWorkspace = useAppStore((s) => s.activeTerminalByWorkspace);
	const backgroundedByWorkspace = useAppStore((s) => s.backgroundedTerminalsByWorkspace);
	const addTerminal = useAppStore((s) => s.addTerminal);
	const closeTerminalTab = useAppStore((s) => s.closeTerminalTab);
	const reattachTerminal = useAppStore((s) => s.reattachTerminal);
	const setActiveTerminalTab = useAppStore((s) => s.setActiveTerminalTab);

	// Landing on a workspace with no terminals opens one — every worktree gets a shell ready to go.
	useEffect(() => {
		if (!activeWorkspaceId) return;
		const store = useAppStore.getState();
		if ((store.terminalsByWorkspace[activeWorkspaceId]?.length ?? 0) === 0) {
			store.addTerminal(activeWorkspaceId);
		}
	}, [activeWorkspaceId]);

	const tabs = activeWorkspaceId
		? (terminalsByWorkspace[activeWorkspaceId] ?? NO_TERMINALS)
		: NO_TERMINALS;
	const activeTerminalId = activeWorkspaceId
		? (activeTerminalByWorkspace[activeWorkspaceId] ?? null)
		: null;
	const backgrounded = activeWorkspaceId
		? (backgroundedByWorkspace[activeWorkspaceId] ?? NO_TERMINALS)
		: NO_TERMINALS;
	// Both open AND backgrounded instances stay mounted (hidden unless active) so a detached terminal's
	// PTY keeps running — closing a tab is a view action, not a kill.
	const allTerminals = [
		...Object.values(terminalsByWorkspace).flat(),
		...Object.values(backgroundedByWorkspace).flat(),
	];

	return (
		<div data-testid="terminal-panel" className="flex h-full min-h-0 flex-col">
			{/* Tab bar (reference style): far-left collapse chevron, then the tabs with "+" right after the
			    last one, and the background/history control pinned to the far right. No "TERMINAL" title. */}
			<div className="flex h-8 shrink-0 items-stretch gap-xs border-b border-border2 pr-xs pl-sm">
				<Tip side="top" label="Collapse terminal">
					<button
						type="button"
						data-testid="toggle-terminal-panel"
						aria-label="Collapse terminal panel"
						onClick={() => togglePanel("terminal")}
						className="flex shrink-0 items-center rounded-[var(--radius-sm)] px-0.5 text-muted hover:text-text"
					>
						{/* panel-bottom: matches the panel-left/right toggles — "hide the bottom (terminal) panel". */}
						<PanelBottom className="size-4" />
					</button>
				</Tip>
				<div className="flex min-w-0 flex-1 items-stretch gap-xs overflow-x-auto">
					{tabs.map((tab) => (
						<TerminalTabButton
							key={tab.clientId}
							tab={tab}
							active={tab.clientId === activeTerminalId}
							// The last remaining tab can't be closed — never go down to zero open tabs.
							closable={tabs.length > 1}
							onSelect={() => setActiveTerminalTab(tab.workspaceId, tab.clientId)}
							onClose={() => closeTerminalTab(tab.workspaceId, tab.clientId)}
						/>
					))}
					{/* "+" sits immediately after the last tab (not pushed to the far right). */}
					<Tip side="top" label="Add new terminal">
						<button
							type="button"
							data-testid="terminal-add"
							aria-label="Add new terminal"
							disabled={!activeWorkspaceId}
							onClick={() => activeWorkspaceId && addTerminal(activeWorkspaceId)}
							className="flex shrink-0 items-center rounded-[var(--radius-sm)] px-0.5 text-muted hover:text-text disabled:opacity-40"
						>
							<Plus className="size-4" />
						</button>
					</Tip>
				</div>
				{backgrounded.length === 0 ? (
					// Disabled until at least one terminal is running in the background.
					<button
						type="button"
						data-testid="terminal-bg"
						aria-label="Background terminals"
						disabled
						className="flex shrink-0 items-center rounded-[var(--radius-sm)] px-0.5 text-muted opacity-40"
					>
						<History className="size-4" />
					</button>
				) : (
					<DropdownMenu>
						<DropdownMenuTrigger
							data-testid="terminal-bg"
							aria-label="Background terminals"
							className="flex shrink-0 items-center rounded-[var(--radius-sm)] px-0.5 text-muted outline-none hover:text-text"
						>
							<History className="size-4" />
						</DropdownMenuTrigger>
						<DropdownMenuContent align="end">
							<DropdownMenuLabel>Running in background</DropdownMenuLabel>
							{backgrounded.map((tab) => (
								<DropdownMenuItem
									key={tab.clientId}
									data-testid="terminal-bg-item"
									onSelect={() => reattachTerminal(tab.workspaceId, tab.clientId)}
								>
									<span
										className={`size-1.5 shrink-0 rounded-full ${mockTerminalActive(tab.clientId) ? "bg-green" : "bg-hint"}`}
									/>
									<span className="truncate">{tab.title}</span>
								</DropdownMenuItem>
							))}
						</DropdownMenuContent>
					</DropdownMenu>
				)}
			</div>
			{/* Padded body: balanced left/right + top padding so content isn't flush to the edges. The inner
			    relative box is the positioning context for the (absolute) terminal instances, so the padding
			    insets them. */}
			<div className="min-h-0 flex-1 px-sm pt-sm">
				<div className="relative h-full w-full">
					{!activeWorkspaceId ? (
						<p className="py-xs text-xs text-hint">Select a workspace.</p>
					) : tabs.length === 0 ? (
						<p data-testid="terminals-empty" className="py-xs text-xs text-hint">
							No terminals yet — press + to open one.
						</p>
					) : null}
					{allTerminals.map((tab) => (
						<Suspense key={tab.clientId} fallback={null}>
							<TerminalInstance
								clientId={tab.clientId}
								workspaceId={tab.workspaceId}
								visible={tab.workspaceId === activeWorkspaceId && tab.clientId === activeTerminalId}
							/>
						</Suspense>
					))}
				</div>
			</div>
			{/* Which worktree this terminal belongs to — a small muted branch label. */}
			{branch ? (
				<div
					data-testid="terminal-branch"
					className="flex h-5 shrink-0 items-center gap-xs border-t border-border2 px-sm text-hint text-xs"
				>
					<GitBranch className="size-3 shrink-0" />
					<span className="truncate font-[var(--font-mono)]">{branch}</span>
				</div>
			) : null}
		</div>
	);
}

function TerminalTabButton({
	tab,
	active,
	closable,
	onSelect,
	onClose,
}: {
	tab: TerminalTab;
	active: boolean;
	closable: boolean;
	onSelect: () => void;
	onClose: () => void;
}) {
	return (
		<div
			// Active tab marked with an accent underline (not a filled pill); full-height so the underline sits
			// on the bar's baseline.
			className={`group flex shrink-0 items-center gap-xs border-b-2 pr-xs pl-sm text-xs ${
				active ? "border-primary text-text" : "border-transparent text-muted hover:text-text"
			}`}
		>
			<button
				type="button"
				data-testid="terminal-tab"
				data-active={active}
				onClick={onSelect}
				className="max-w-[140px] truncate py-xs"
			>
				{tab.title}
			</button>
			{closable ? (
				<button
					type="button"
					data-testid="terminal-tab-close"
					aria-label={`Close ${tab.title}`}
					onClick={onClose}
					className="rounded-[var(--radius-sm)] p-0.5 text-hint opacity-0 hover:bg-elevated hover:text-text group-hover:opacity-100"
				>
					<X className="size-3" />
				</button>
			) : null}
		</div>
	);
}
