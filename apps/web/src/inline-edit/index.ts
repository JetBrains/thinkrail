/** Inline AI-editing: select text → instruct → hidden pi session edits → review in place. Public surface
 * consumed by `panels`. Presentational widgets + per-surface controllers + orchestration actions. */
export type { EditHunk, InlineEditRequest, InlineEditStatus, SelectionTarget } from "./types";
export type { DiffPart } from "./wordDiff";
export { wordDiff } from "./wordDiff";
