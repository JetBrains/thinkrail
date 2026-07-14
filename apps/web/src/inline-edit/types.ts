import type { EditHunk, InlineEditRequest, InlineEditStatus } from "@/store";

export type { EditHunk, InlineEditRequest, InlineEditStatus };

/**
 * A resolved selection on a file surface — the shared shape both the markdown and Monaco triggers produce
 * and the popup consumes. `rect` positions the pill/popup (viewport coords). Line numbers are 1-based.
 */
export interface SelectionTarget {
	workspaceId: string;
	path: string;
	text: string;
	startLine: number;
	endLine: number;
	rect: { top: number; left: number; bottom: number; right: number };
}
