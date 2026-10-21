import { expect, test } from "bun:test";
import {
	contentStamp,
	diffContentStamp,
	initialStampedComposerState,
	stampedComposerReducer,
} from "./reviewComposerState";

test("an open composer closes and raises a notice when its content hash changes", () => {
	const oldStamp = contentStamp({ kind: "text", text: "old", hash: "old-hash" });
	const newStamp = contentStamp({ kind: "text", text: "new", hash: "new-hash" });
	const selected = stampedComposerReducer(initialStampedComposerState<string>(), {
		type: "select",
		stamp: oldStamp,
		value: "/old/pointer",
		composing: true,
	});
	const refreshed = stampedComposerReducer(selected, { type: "refresh", stamp: newStamp });
	expect(refreshed).toEqual({ selection: null, composing: false, stale: true });
});

test("a diff composer stamp changes when either side hash changes", () => {
	const original = { kind: "text" as const, text: "old", hash: "base-1" };
	const modified = { kind: "text" as const, text: "new", hash: "worktree-1" };
	const initial = diffContentStamp(original, modified);
	expect(diffContentStamp({ ...original, hash: "base-2" }, modified)).not.toBe(initial);
	expect(diffContentStamp(original, { ...modified, hash: "worktree-2" })).not.toBe(initial);
});
