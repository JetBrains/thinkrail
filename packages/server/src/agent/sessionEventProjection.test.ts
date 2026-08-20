import { expect, test } from "bun:test";
import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import { projectSessionEvent } from "./sessionEventProjection";

test("compaction_end serializes only the versioned token-count allowlist", () => {
	const source: Extract<AgentSessionEvent, { type: "compaction_end" }> = {
		type: "compaction_end",
		reason: "threshold",
		result: {
			summary: "private conversation summary",
			firstKeptEntryId: "entry-42",
			tokensBefore: 148_000,
			estimatedTokensAfter: 12_000,
			details: { extensionSecret: "not-for-the-wire" },
		},
		aborted: false,
		willRetry: false,
	};

	expect(JSON.stringify(projectSessionEvent(source, null))).toBe(
		JSON.stringify({
			type: "compaction_end",
			reason: "threshold",
			result: { tokensBefore: 148_000, estimatedTokensAfter: 12_000 },
			aborted: false,
			willRetry: false,
		}),
	);
});
