// Production public surface of the history module. Test-only session-file builders live in
// `testFixtures.ts` and are exposed via the server package's `./history-test-fixtures` subpath export
// (see package.json), NOT here — they write to disk and must never enter the runtime module graph.
export { extractEntries, type HistoryEntry, MAX_SEARCHABLE } from "./extract";
export {
	clampLimit,
	getHistoryIndex,
	HistoryIndex,
	makeSnippet,
	matchesTerms,
} from "./historyIndex";
