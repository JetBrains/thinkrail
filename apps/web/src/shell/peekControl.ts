import { isImeComposing } from "@thinkrail/ui/keyboard";
import { openFileAtLine, openFileComparisonInTab, openFileInTab } from "../panels/openTabs";
import { selectPeekEntry, selectPeekOpen, useAppStore } from "../store";
import type { EscapePress } from "./escapeLeavesField";
import { keyboardClaimed } from "./extensionCommands";
import { openExtensionTab } from "./extensionPanelHost";
import { focusPreviousRegion, focusRegionOfKind } from "./regions";
import { isInLayer } from "./shortcutLayers";

const PEEK_REGION_SELECTOR = '[data-region-kind="peek"]';
const KEEPS_ESCAPE_SELECTOR = ".monaco-editor, .xterm";

export function leavePeek(): void {
	const region = document.querySelector(PEEK_REGION_SELECTOR);
	if (!region?.contains(document.activeElement)) return;
	if (!focusPreviousRegion()) focusRegionOfKind("center");
}

export function hidePeekFrom(workspaceId: string): void {
	leavePeek();
	useAppStore.getState().closePeek(workspaceId);
}

export function removePeekEntryFrom(workspaceId: string, index: number): void {
	const state = useAppStore.getState();
	if (state.peekByWorkspace[workspaceId]?.stack.length === 1) leavePeek();
	state.closePeekEntry(workspaceId, index);
}

export function openPeekInTab(workspaceId: string): void {
	const state = useAppStore.getState();
	const entry = selectPeekEntry(state, workspaceId);
	const index = state.peekByWorkspace[workspaceId]?.index;
	if (!entry || index === undefined) return;
	removePeekEntryFrom(workspaceId, index);
	switch (entry.kind) {
		case "file":
			void (entry.line === undefined
				? openFileInTab(workspaceId, entry.path, "keep")
				: openFileAtLine(workspaceId, entry.path, { line: entry.line }, "keep"));
			return;
		case "compare":
			void openFileComparisonInTab(workspaceId, entry.before, entry.after, "keep");
			return;
		case "extension":
			openExtensionTab(workspaceId, entry, entry.params);
			return;
	}
}

export function closesPeek(
	press: EscapePress,
	target: { closest(selector: string): unknown } | null,
	claimed: boolean,
): boolean {
	return (
		press.key === "Escape" &&
		!press.altKey &&
		!press.ctrlKey &&
		!press.metaKey &&
		!press.shiftKey &&
		!isImeComposing(press) &&
		!press.defaultPrevented &&
		!claimed &&
		(target === null || (target.closest(KEEPS_ESCAPE_SELECTOR) === null && !isInLayer(target)))
	);
}

export function installPeekEscape(): () => void {
	const onKeyDown = (event: KeyboardEvent) => {
		const state = useAppStore.getState();
		const workspaceId = state.activeWorkspaceId;
		if (!workspaceId || !selectPeekOpen(state, workspaceId)) return;
		if (state.peekByWorkspace[workspaceId]?.pinned) return;
		const target = event.composedPath()[0];
		if (!closesPeek(event, target instanceof Element ? target : null, keyboardClaimed())) return;
		event.preventDefault();
		hidePeekFrom(workspaceId);
	};
	window.addEventListener("keydown", onKeyDown);
	return () => window.removeEventListener("keydown", onKeyDown);
}
