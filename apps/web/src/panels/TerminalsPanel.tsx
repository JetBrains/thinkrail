import { Plus, X } from "lucide-react";
import { lazy, Suspense } from "react";
import { type TerminalTab, useAppStore } from "../store/appStore";

const TerminalInstance = lazy(() => import("./TerminalInstance"));

const NO_TERMINALS: TerminalTab[] = [];

/** Lower-right terminals for the active worktree. All instances stay mounted; only the active is shown. */
export function TerminalsPanel() {
	const activeWorkspaceId = useAppStore((s) => s.activeWorkspaceId);
	const terminalsByWorkspace = useAppStore((s) => s.terminalsByWorkspace);
	const activeTerminalByWorkspace = useAppStore((s) => s.activeTerminalByWorkspace);
	const addTerminal = useAppStore((s) => s.addTerminal);
	const closeTerminalTab = useAppStore((s) => s.closeTerminalTab);
	const setActiveTerminalTab = useAppStore((s) => s.setActiveTerminalTab);

	const tabs = activeWorkspaceId
		? (terminalsByWorkspace[activeWorkspaceId] ?? NO_TERMINALS)
		: NO_TERMINALS;
	const activeTerminalId = activeWorkspaceId
		? (activeTerminalByWorkspace[activeWorkspaceId] ?? null)
		: null;
	const allTerminals = Object.values(terminalsByWorkspace).flat();

	return (
		<div data-testid="terminal-panel" className="flex h-full min-h-0 flex-col bg-bg-dark">
			<div className="flex h-7 shrink-0 items-center gap-xs border-b border-border pr-xs pl-sm">
				<span className="shrink-0 text-xs uppercase tracking-wider text-muted">Terminal</span>
				<div className="flex min-w-0 flex-1 items-center gap-px overflow-x-auto">
					{tabs.map((tab) => (
						<TerminalTabButton
							key={tab.clientId}
							tab={tab}
							active={tab.clientId === activeTerminalId}
							onSelect={() => setActiveTerminalTab(tab.workspaceId, tab.clientId)}
							onClose={() => closeTerminalTab(tab.workspaceId, tab.clientId)}
						/>
					))}
				</div>
				<button
					type="button"
					data-testid="terminal-add"
					aria-label="New terminal"
					disabled={!activeWorkspaceId}
					onClick={() => activeWorkspaceId && addTerminal(activeWorkspaceId)}
					className="flex size-5 shrink-0 items-center justify-center rounded-[var(--radius-sm)] text-muted hover:bg-hover hover:text-text disabled:opacity-40"
				>
					<Plus className="size-4" />
				</button>
			</div>
			<div className="relative min-h-0 flex-1">
				{!activeWorkspaceId ? (
					<p className="px-sm py-xs text-xs text-hint">Select a workspace.</p>
				) : tabs.length === 0 ? (
					<p data-testid="terminals-empty" className="px-sm py-xs text-xs text-hint">
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
	);
}

function TerminalTabButton({
	tab,
	active,
	onSelect,
	onClose,
}: {
	tab: TerminalTab;
	active: boolean;
	onSelect: () => void;
	onClose: () => void;
}) {
	return (
		<div
			className={`group flex shrink-0 items-center gap-xs rounded-[var(--radius-sm)] pr-xs pl-sm text-xs ${
				active ? "bg-hover text-text" : "text-muted hover:bg-hover"
			}`}
		>
			<button
				type="button"
				data-testid="terminal-tab"
				data-active={active}
				onClick={onSelect}
				className="max-w-[120px] truncate py-xs"
			>
				{tab.title}
			</button>
			<button
				type="button"
				data-testid="terminal-tab-close"
				aria-label={`Close ${tab.title}`}
				onClick={onClose}
				className="rounded-[var(--radius-sm)] p-0.5 text-hint opacity-0 hover:bg-elevated hover:text-text group-hover:opacity-100"
			>
				<X className="size-3" />
			</button>
		</div>
	);
}
