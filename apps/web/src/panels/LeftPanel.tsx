import type { SessionStats } from "@thinkrail/contracts";
import { HelpCircle, PanelLeft, Settings } from "lucide-react";
import { SessionStatsBar } from "@/chat/SessionStatsBar";
import { Tip } from "@/components/Tip";
import { selectActiveSessionStats, useAppStore } from "../store";

// MOCK app-level usage shown when no chat session is active, so the usage footer is ALWAYS present (it's
// overall-application info, not workspace state). Same shape/formatting as a real session's stats.
const MOCK_USAGE: SessionStats = {
	sessionId: "mock",
	totalMessages: 0,
	tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 431_000_000 },
	cost: 313.29,
	contextUsage: { tokens: null, contextWindow: 0, percent: 56 },
};

import type { ConnectionStatus } from "../transport";
import { ProjectTree } from "./ProjectTree";

const STATUS_LABEL: Record<ConnectionStatus, string> = {
	connected: "Connected",
	connecting: "Connecting…",
	disconnected: "Disconnected",
};

const STATUS_DOT: Record<ConnectionStatus, string> = {
	connected: "bg-green",
	connecting: "bg-gold",
	disconnected: "bg-red",
};

/**
 * The full-height left panel (Conductor-style): a top region (logo + collapse toggle) over the
 * scrollable `ProjectTree` (which owns the "add project" menu on its PROJECTS row), capped by a footer
 * that carries the app-wide chrome moved out of the old global top bar — the connection beacon (reused
 * from `store.status`, never re-fetched), a help link, and the settings gear. The left|main divider
 * (owned by the shell) runs the full height beside it.
 */
export function LeftPanel() {
	const status = useAppStore((s) => s.status);
	const togglePanel = useAppStore((s) => s.togglePanel);
	// Persistent, application-level usage footer: the active chat session's usage when there is one, else a
	// mock — so the row is always visible regardless of navigation state (never appears/disappears).
	const stats = useAppStore(selectActiveSessionStats) ?? MOCK_USAGE;

	return (
		<aside data-testid="left-nav" className="flex h-full flex-col bg-surface-sidebar">
			<div className="flex h-[48px] shrink-0 items-center justify-between border-border2 border-b px-md">
				{/* Solid-accent square as a stand-in for the real logo; clicking it opens the main/welcome screen. */}
				<button
					type="button"
					data-testid="app-logo"
					aria-label="ThinkRail home"
					onClick={() => useAppStore.getState().showWelcome()}
					className="size-[26px] shrink-0 rounded-[7px] bg-primary outline-none focus-visible:ring-2 focus-visible:ring-primary"
				/>
				<Tip side="bottom" label="Collapse left panel">
					<button
						type="button"
						data-testid="toggle-left-panel"
						aria-label="Collapse left panel"
						onClick={() => togglePanel("left")}
						className="flex size-7 items-center justify-center rounded-[var(--radius-sm)] text-muted outline-none transition-colors hover:bg-hover hover:text-text focus-visible:ring-2 focus-visible:ring-primary"
					>
						<PanelLeft className="size-4" />
					</button>
				</Tip>
			</div>

			<div className="min-h-0 flex-1 overflow-auto">
				<ProjectTree />
			</div>

			<footer className="flex shrink-0 flex-col border-border2 border-t">
				<div className="flex items-center gap-md px-md py-sm">
					<Tip
						side="top"
						label={
							status === "connected" ? "Connected to host" : "Disconnected — trying to reconnect"
						}
					>
						<span
							data-testid="connection-status"
							data-status={status}
							className="inline-flex items-center gap-sm text-muted text-xs"
						>
							<span className={`size-2 rounded-full ${STATUS_DOT[status]}`} />
							{STATUS_LABEL[status]}
						</span>
					</Tip>
					<div className="ml-auto flex items-center gap-md">
						<Tip side="top" label="Getting started">
							<button
								type="button"
								data-testid="open-docs"
								aria-label="Getting started"
								onClick={() => useAppStore.getState().openOnboarding("review")}
								className="flex size-7 items-center justify-center rounded-[var(--radius-sm)] text-muted outline-none transition-colors hover:bg-hover hover:text-text focus-visible:ring-2 focus-visible:ring-primary"
							>
								<HelpCircle className="size-4" />
							</button>
						</Tip>
						<Tip side="top" label="Settings">
							<button
								type="button"
								data-testid="open-settings"
								aria-label="Settings"
								onClick={() => useAppStore.getState().openSettings()}
								className="flex size-7 items-center justify-center rounded-[var(--radius-sm)] text-muted outline-none transition-colors hover:bg-hover hover:text-text focus-visible:ring-2 focus-visible:ring-primary"
							>
								<Settings className="size-4" />
							</button>
						</Tip>
					</div>
				</div>
				{/* Usage (tokens · cost · context bar · %) — a persistent, application-level line under the footer
				    row. Reuses SessionStatsBar unchanged; always shown (active-session stats, else the mock). */}
				<div className="flex items-center border-border2 border-t px-md py-sm">
					<SessionStatsBar stats={stats} />
				</div>
			</footer>
		</aside>
	);
}
