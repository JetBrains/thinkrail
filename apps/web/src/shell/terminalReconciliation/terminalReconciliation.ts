import type { WorkspaceLayoutDocument } from "@thinkrail/contracts";
import { useEffect, useRef } from "react";
import { useTerminalCatalog } from "../../panels/TerminalWorkbench";
import { type TerminalTab, useAppStore } from "../../store";
import {
	closeLayoutTab,
	collectAllGroups,
	isLayoutUnavailable,
	moveTabToGroup,
	openCenterTab,
	primaryCenterGroupId,
	withAvailablePlacementId,
} from "../layout";

const NO_TERMINALS: TerminalTab[] = [];

export function terminalLayoutId(tabKey: string): string {
	return `terminal:${tabKey}`;
}

export function useTerminalPlacementReconciliation(
	workspaceId: string,
	commit: (document: WorkspaceLayoutDocument) => void,
): readonly TerminalTab[] {
	const document = useAppStore((state) => state.layoutDocumentsByWorkspace[workspaceId]);
	const status = useAppStore((state) => state.status);
	const connectionGeneration = useAppStore((state) => state.connectionGeneration);
	const layoutIntent = useAppStore(
		(state) => state.layoutIntents.find((intent) => intent.workspaceId === workspaceId) ?? null,
	);
	const pendingLayoutWrites = useAppStore(
		(state) => state.layoutPendingByWorkspace[workspaceId]?.length ?? 0,
	);
	const terminals = useAppStore((state) => state.terminalsByWorkspace[workspaceId] ?? NO_TERMINALS);
	const terminalCatalogReady = useTerminalCatalog(workspaceId);
	const reconciledTerminalCatalog = useRef<{
		workspaceId: string;
		connectionGeneration: number;
		terminals: readonly TerminalTab[];
	} | null>(null);

	// A new authoritative catalog is the only deletion proof: a remote placement can arrive before that
	// terminal's attach/list update. On the same pass, restore confirmed domain tabs that predate layout
	// persistence (upgrade/recovery) or outlive a rejected layout write. New attach-pending tabs keep using
	// their explicit placement intents, which deliberately reveal and mount them.
	useEffect(() => {
		if (
			!document ||
			!terminalCatalogReady ||
			layoutIntent ||
			pendingLayoutWrites > 0 ||
			status !== "connected"
		) {
			return;
		}
		if (useAppStore.getState().layoutDocumentsByWorkspace[workspaceId] !== document) return;
		const reconciled = reconciledTerminalCatalog.current;
		const catalogAdvanced =
			reconciled?.workspaceId !== workspaceId ||
			reconciled.connectionGeneration !== connectionGeneration ||
			reconciled.terminals !== terminals;
		let next = document;
		const attemptedCatalog = catalogAdvanced
			? { workspaceId, connectionGeneration, terminals }
			: null;
		if (attemptedCatalog) {
			const known = new Set(terminals.map((tab) => tab.tabKey));
			const dangling = collectAllGroups(next)
				.flatMap((group) => group.tabs)
				.filter((tab) => tab.kind === "terminal" && !known.has(tab.tabKey));
			next = dangling.reduce((current, tab) => closeLayoutTab(current, tab.id).document, next);
		}

		const placedTabs = collectAllGroups(next)
			.flatMap((group) => group.tabs)
			.filter((tab) => tab.kind === "terminal");
		for (const terminal of terminals) {
			const placed = placedTabs.find((tab) => tab.tabKey === terminal.tabKey);
			if (!placed || placed.name === terminal.title) continue;
			const refreshed = openCenterTab(
				next,
				{ ...placed, name: terminal.title },
				primaryCenterGroupId(next),
				"preview",
			);
			if (!isLayoutUnavailable(refreshed)) next = refreshed.document;
		}
		const placed = new Set(placedTabs.map((tab) => tab.tabKey));
		const missing = terminals.filter((tab) => !tab.attachPending && !placed.has(tab.tabKey));
		for (const terminal of missing) {
			const tab = withAvailablePlacementId(next, {
				kind: "terminal" as const,
				id: terminalLayoutId(terminal.tabKey),
				name: terminal.title,
				tabKey: terminal.tabKey,
			});
			const target = next.right.groups.at(-1);
			if (target) {
				const visible = next.right.visible;
				const moved = moveTabToGroup(next, tab, { area: "right", groupId: target.id });
				if (!isLayoutUnavailable(moved)) {
					next = {
						...moved.document,
						right: { ...moved.document.right, visible },
					};
				}
			} else {
				const moved = moveTabToGroup(next, tab, {
					area: "center",
					groupId: primaryCenterGroupId(next),
				});
				if (!isLayoutUnavailable(moved)) next = moved.document;
			}
		}
		if (next !== document) {
			commit(next);
			return;
		}
		// A catalog is reconciled only once its resulting projection is settled. Marking it before the
		// optimistic write could strand dangling placements forever if that write rolled back.
		if (attemptedCatalog) reconciledTerminalCatalog.current = attemptedCatalog;
	}, [
		commit,
		connectionGeneration,
		document,
		layoutIntent,
		pendingLayoutWrites,
		status,
		terminalCatalogReady,
		terminals,
		workspaceId,
	]);

	return terminals;
}
