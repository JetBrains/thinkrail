import type { LayoutTerminalTab, WorkspaceLayoutDocument } from "@thinkrail/contracts";
import { useEffect, useRef } from "react";
import type { LayoutAttention } from "../../lib";
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

export function placeRecoveredTerminal(
	document: WorkspaceLayoutDocument,
	attention: LayoutAttention | undefined,
	tab: LayoutTerminalTab,
): { document: WorkspaceLayoutDocument } {
	const preferredId = attention?.lastFocusedSideGroupId.bottom;
	const target =
		document.bottom.groups.find((group) => group.id === preferredId) ??
		document.bottom.groups.at(-1);
	if (!target) return { document };
	const visible = document.bottom.visible;
	const placed = moveTabToGroup(document, tab, { area: "bottom", groupId: target.id });
	if (isLayoutUnavailable(placed)) return { document };
	return {
		document: {
			...placed.document,
			bottom: { ...placed.document.bottom, visible },
		},
	};
}

export function useTerminalPlacementReconciliation(
	workspaceId: string,
	commit: (document: WorkspaceLayoutDocument) => void,
): { terminals: readonly TerminalTab[]; catalogReady: boolean } {
	const document = useAppStore((state) => state.layoutDocumentsByWorkspace[workspaceId]);
	const status = useAppStore((state) => state.status);
	const connectionGeneration = useAppStore((state) => state.connectionGeneration);
	const layoutIntent = useAppStore(
		(state) => state.layoutIntents.find((intent) => intent.workspaceId === workspaceId) ?? null,
	);
	const attention = useAppStore((state) => state.layoutAttentionByWorkspace[workspaceId]);
	const terminals = useAppStore((state) => state.terminalsByWorkspace[workspaceId] ?? NO_TERMINALS);
	const terminalCatalogReady = useTerminalCatalog(workspaceId);
	const reconciledTerminalCatalog = useRef<{
		workspaceId: string;
		connectionGeneration: number;
		terminals: readonly TerminalTab[];
	} | null>(null);

	useEffect(() => {
		if (!document || !terminalCatalogReady || layoutIntent || status !== "connected") {
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
		const missing = terminals.filter((tab) => !tab.reservationPending && !placed.has(tab.tabKey));
		for (const terminal of missing) {
			const tab = withAvailablePlacementId(next, {
				kind: "terminal" as const,
				id: terminalLayoutId(terminal.tabKey),
				name: terminal.title,
				tabKey: terminal.tabKey,
			});
			next = placeRecoveredTerminal(next, attention, tab).document;
		}
		if (next !== document) {
			commit(next);
			return;
		}
		if (attemptedCatalog) reconciledTerminalCatalog.current = attemptedCatalog;
	}, [
		attention,
		commit,
		connectionGeneration,
		document,
		layoutIntent,
		status,
		terminalCatalogReady,
		terminals,
		workspaceId,
	]);

	return { terminals, catalogReady: terminalCatalogReady };
}
