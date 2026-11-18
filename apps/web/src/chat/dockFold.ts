export interface DockFold {
	choice: boolean | null;
	question: { toolCallId: string; collapsed: boolean } | null;
}

export const DEFAULT_DOCK_FOLD: DockFold = { choice: null, question: null };

export function dockCollapsed(fold: DockFold, dockedToolCallId: string | null): boolean | null {
	if (dockedToolCallId === null) return fold.choice;
	return fold.question?.toolCallId === dockedToolCallId ? fold.question.collapsed : true;
}

export function withDockCollapsed(
	fold: DockFold,
	dockedToolCallId: string | null,
	collapsed: boolean,
): DockFold {
	return dockedToolCallId === null
		? { choice: collapsed, question: null }
		: { ...fold, question: { toolCallId: dockedToolCallId, collapsed } };
}
