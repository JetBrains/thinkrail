import { Plus, X } from "lucide-react";
import { lazy, Suspense, useEffect } from "react";
import {
	allTerminalTabs,
	isTerminalVisible,
	selectActiveTerminalId,
	selectWorkspaceTerminals,
	type TerminalTab,
	useAppStore,
} from "../store";

const TerminalInstance = lazy(() => import("./TerminalInstance"));

/** Lower-right terminals for the active worktree. All instances stay mounted; only the active is shown. */
export function TerminalsPanel() {
	const activeWorkspaceId = useAppStore((s) => s.activeWorkspaceId);
	const terminalsByWorkspace = useAppStore((s) => s.terminalsByWorkspace);
	const tabs = useAppStore(selectWorkspaceTerminals);
	const activeTerminalId = useAppStore(selectActiveTerminalId);
	const addTerminal = useAppStore((s) => s.addTerminal);
	const closeTerminalTab = useAppStore((s) => s.closeTerminalTab);
	const setActiveTerminalTab = useAppStore((s) => s.setActiveTerminalTab);

	// Landing on a workspace with no terminals opens one — every worktree gets a shell ready to go.
	useEffect(() => {
		if (!activeWorkspaceId) return;
		const store = useAppStore.getState();
		if ((store.terminalsByWorkspace[activeWorkspaceId]?.length ?? 0) === 0) {
			store.addTerminal(activeWorkspaceId);
		}
	}, [activeWorkspaceId]);

	const allTerminals = allTerminalTabs(terminalsByWorkspace);

	return (
		<div data-testid="terminal-panel" className="flex h-full min-h-0 flex-col">
			<div className="flex h-7 shrink-0 items-center gap-xs border-b border-border-default pr-xs pl-sm">
				<span className="shrink-0 tr-text-eyebrow text-text-muted">Terminal</span>
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
					className="flex size-5 shrink-0 items-center justify-center rounded-[var(--radius-sm)] text-text-muted hover:bg-control-bg-hovered hover:text-text-default disabled:text-control-disabled-text"
				>
					<Plus className="size-4" />
				</button>
			</div>
			<div className="relative min-h-0 flex-1">
				{!activeWorkspaceId ? (
					<p className="px-sm py-xs tr-text-metadata text-text-muted">Select a workspace.</p>
				) : tabs.length === 0 ? (
					<p data-testid="terminals-empty" className="px-sm py-xs tr-text-metadata text-text-muted">
						No terminals yet — press + to open one.
					</p>
				) : null}
				{allTerminals.map((tab) => (
					<Suspense key={tab.clientId} fallback={null}>
						<TerminalInstance
							clientId={tab.clientId}
							workspaceId={tab.workspaceId}
							visible={isTerminalVisible(tab, activeWorkspaceId, activeTerminalId)}
							{...(tab.initialCommand ? { initialCommand: tab.initialCommand } : {})}
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
			className={`group flex shrink-0 items-center gap-xs rounded-[var(--radius-sm)] pr-xs pl-sm tr-text-ui ${
				active
					? "bg-control-bg text-text-default hover:bg-control-bg-hovered"
					: "text-text-muted hover:bg-control-bg-hovered"
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
				className="rounded-[var(--radius-sm)] p-0.5 text-text-muted opacity-0 hover:bg-container-elevated-bg hover:text-text-default group-hover:opacity-100"
			>
				<X className="size-3" />
			</button>
		</div>
	);
}
