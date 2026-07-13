/** Inline AI-editing: select text → instruct → hidden pi session edits → review in place. Public surface
 * consumed by `panels`. Presentational widgets + per-surface controllers + orchestration actions. */

export {
	hasPendingEditForPath,
	keepInlineEdit,
	openInlineEditInTab,
	refineInlineEdit,
	refreshTabContent,
	revertAll,
	startInlineEdit,
	stopInlineEdit,
	undoLastChange,
} from "./actions";
export { monacoSelectionTarget, resolveMarkdownSelection, sourceLineRehype } from "./anchor";
export { EditActionBar } from "./EditActionBar";
export { EditStatusChip } from "./EditStatusChip";
export { InstructionPopup } from "./InstructionPopup";
export { MonacoReviewCard } from "./MonacoReviewCard";
export { PreviewPopover } from "./PreviewPopover";
export { buildSeedPrompt } from "./prompt";
export { SelectionPill } from "./SelectionPill";
export { SuggestionOverlay } from "./SuggestionOverlay";
export type { EditHunk, InlineEditRequest, InlineEditStatus, SelectionTarget } from "./types";
export type { DiffPart } from "./wordDiff";
export { wordDiff } from "./wordDiff";
