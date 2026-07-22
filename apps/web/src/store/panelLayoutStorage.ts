/**
 * localStorage persistence for which side panels are collapsed — client-only view state (never sent to
 * the server). Mirrors the `docHistoryStorage` pattern; fails soft (missing/malformed/unavailable →
 * both expanded).
 */
const KEY = "thinkrail:panelCollapsed";

export interface PanelCollapsed {
	left: boolean;
	right: boolean;
	/** The lower-right terminal region (collapses downward), worktree-only. */
	terminal: boolean;
}

export function readPanelCollapsed(): PanelCollapsed {
	try {
		const raw = localStorage.getItem(KEY);
		if (!raw) return { left: false, right: false, terminal: false };
		const parsed: unknown = JSON.parse(raw);
		const p = parsed as Record<string, unknown>;
		return { left: p?.left === true, right: p?.right === true, terminal: p?.terminal === true };
	} catch {
		return { left: false, right: false, terminal: false };
	}
}

export function writePanelCollapsed(value: PanelCollapsed): void {
	try {
		localStorage.setItem(KEY, JSON.stringify(value));
	} catch {
		// Storage unavailable / quota — collapse state is best-effort view state, so a write failure is silent.
	}
}
