import type { TerminalTabsPush } from "@thinkrail/contracts";
import { WS_CHANNELS } from "@thinkrail/contracts";
import { Plus, X } from "lucide-react";
import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import {
	selectActiveTerminalId,
	selectWorkspaceTerminals,
	type TerminalTab,
	useAppStore,
} from "../store";
import { getTransport } from "../transport";
import { ConfirmDialog } from "./ConfirmDialog";
import { workspaceTabStateClass } from "./tabState";

const TerminalInstance = lazy(() => import("./TerminalInstance"));

/** Lower-right terminals for the active worktree. Only the shown tab is mounted — see `shown` below. */
export function TerminalsPanel() {
	const activeWorkspaceId = useAppStore((s) => s.activeWorkspaceId);
	const tabs = useAppStore(selectWorkspaceTerminals);
	const activeTerminalId = useAppStore(selectActiveTerminalId);
	const addTerminal = useAppStore((s) => s.addTerminal);
	const setActiveTerminalTab = useAppStore((s) => s.setActiveTerminalTab);
	/** The tab whose shell is running something, held while we ask whether to kill it anyway. */
	const [confirmBusy, setConfirmBusy] = useState<TerminalTab | null>(null);

	// Adopt the host's tab list for this workspace, then open one if it has none. The host owns the list, so a
	// reload — or a different browser — finds the shells that are still running rather than starting new ones.
	useEffect(() => {
		if (!activeWorkspaceId) return;
		let current = true;
		void getTransport()
			.request("terminal.list", { workspaceId: activeWorkspaceId })
			.then(({ tabs: hostTabs }) => {
				if (!current) return;
				useAppStore.getState().setWorkspaceTerminals(activeWorkspaceId, hostTabs);
				// Re-read AFTER the write: `getState()` hands back a snapshot, so the pre-write one would still
				// show no tabs and we would open a second terminal beside the shells already running here.
				const after = useAppStore.getState();
				// Every worktree gets a shell ready to go — but only once we know the host has none.
				if ((after.terminalsByWorkspace[activeWorkspaceId]?.length ?? 0) === 0) {
					after.addTerminal(activeWorkspaceId);
				}
			})
			.catch(() => {
				// The host is unreachable; the transport reconnects and this re-runs on the next workspace entry.
			});
		return () => {
			current = false;
		};
	}, [activeWorkspaceId]);

	// Which terminals exist is shared state, so the host announces every change. Without folding it, a tab
	// closed in another browser would leave a dead instance mounted here, still accepting input.
	useEffect(() => {
		return getTransport().subscribe(WS_CHANNELS.terminalTabs, (payload) => {
			const ev = payload as TerminalTabsPush;
			useAppStore.getState().setWorkspaceTerminals(ev.workspaceId, ev.tabs);
		});
	}, []);

	/**
	 * Close a tab and kill its shell — the only gesture that ever does.
	 *
	 * The host refuses while the shell has child processes and says so, and we ask before retrying with
	 * `force`. Deliberately not a flag read from the tab list: something started after the rail loaded would
	 * make a cached answer wrong in exactly the direction that loses work.
	 */
	const closeTab = useCallback((tab: TerminalTab, force: boolean) => {
		void getTransport()
			.request("terminal.close", { workspaceId: tab.workspaceId, tabKey: tab.tabKey, force })
			.then(({ busy }) => {
				if (busy) {
					setConfirmBusy(tab);
					return;
				}
				// Anything not busy means the tab is gone host-side — either this call killed it, or there was no
				// such tab (an attach that never landed, or one another client already closed). Both leave the row
				// stale, and only dropping it on `closed` would make those two undismissable.
				useAppStore.getState().closeTerminalTab(tab.workspaceId, tab.tabKey);
				setConfirmBusy(null);
			})
			.catch(() => {
				// Nothing was closed, so the tab stays exactly as it is.
			});
	}, []);

	// EXACTLY ONE instance is mounted, app-wide: the tab this client is actually looking at.
	//
	// Mounting is attaching, and attachment is exclusive — so rendering every tab would have this client claim
	// terminals it is not showing. With a shared tab list that is actively harmful: the moment another browser
	// opened a terminal, our hidden instance for it would attach and snatch it out from under the person who
	// just opened it. Switching tabs re-attaches and repaints from the host's recording, which is exactly what
	// that recording is for; a background shell keeps running and keeps being recorded regardless.
	const shown = tabs.find((tab) => tab.tabKey === activeTerminalId) ?? null;

	return (
		<div data-testid="terminal-panel" className="flex h-full min-h-0 flex-col">
			<div className="flex h-7 shrink-0 items-center gap-xs border-b border-border-default pr-xs pl-sm">
				<span className="shrink-0 tr-text-eyebrow text-text-muted">Terminal</span>
				<div className="flex h-full min-w-0 flex-1 items-stretch gap-px overflow-x-auto">
					{tabs.map((tab) => (
						<TerminalTabButton
							key={tab.tabKey}
							tab={tab}
							active={tab.tabKey === activeTerminalId}
							onSelect={() => setActiveTerminalTab(tab.workspaceId, tab.tabKey)}
							onClose={() => closeTab(tab, false)}
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
				{shown ? (
					<Suspense key={shown.tabKey} fallback={null}>
						<TerminalInstance
							tabKey={shown.tabKey}
							workspaceId={shown.workspaceId}
							{...(shown.initialCommand ? { initialCommand: shown.initialCommand } : {})}
						/>
					</Suspense>
				) : null}
			</div>
			<ConfirmDialog
				open={confirmBusy !== null}
				onOpenChange={(open) => {
					if (!open) setConfirmBusy(null);
				}}
				title="Something is running"
				description={`“${confirmBusy?.title ?? "This terminal"}” has a running process. Closing the tab ends it.`}
				confirmLabel="Close anyway"
				confirmTestId="terminal-close-busy-confirm"
				destructive
				onConfirm={() => {
					if (confirmBusy) closeTab(confirmBusy, true);
				}}
			/>
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
			className={`group flex shrink-0 items-center gap-xs rounded-[var(--radius-sm)] pr-xs pl-sm tr-text-ui ${workspaceTabStateClass(active)}`}
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
