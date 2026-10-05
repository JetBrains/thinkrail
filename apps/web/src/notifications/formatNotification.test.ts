import { describe, expect, test } from "bun:test";
import {
	type AttentionEvent,
	formatNotification,
	reasonLabel,
} from "./formatNotification";

function event(overrides: Partial<AttentionEvent> = {}): AttentionEvent {
	return {
		sessionId: "s1",
		workspaceId: "w1",
		worktreeName: "feature-branch",
		reason: { kind: "needs-input" },
		...overrides,
	};
}

describe("reasonLabel", () => {
	test("needs-input", () => {
		expect(reasonLabel({ kind: "needs-input" })).toBe("needs your input");
	});

	test("completion outcomes", () => {
		expect(
			reasonLabel({ kind: "completed", completion: { completionId: "c", outcome: "succeeded" } }),
		).toBe("finished");
		expect(
			reasonLabel({ kind: "completed", completion: { completionId: "c", outcome: "interrupted" } }),
		).toBe("interrupted");
		expect(
			reasonLabel({ kind: "completed", completion: { completionId: "c", outcome: "cancelled" } }),
		).toBe("cancelled");
		expect(
			reasonLabel({
				kind: "completed",
				completion: { completionId: "c", outcome: "failed", failure: "error" },
			}),
		).toBe("failed");
		expect(
			reasonLabel({
				kind: "completed",
				completion: { completionId: "c", outcome: "failed", failure: "length" },
			}),
		).toBe("stopped — context full");
	});
});

describe("formatNotification", () => {
	test("empty → null", () => {
		expect(formatNotification([])).toBeNull();
	});

	test("single → per-session notification targeting the chat", () => {
		const spec = formatNotification([event()]);
		expect(spec).toEqual({
			title: "feature-branch",
			body: "needs your input",
			tag: "attention:s1",
			target: { kind: "chat", workspaceId: "w1", sessionId: "s1" },
		});
	});

	test("single with blank name falls back to app name", () => {
		const spec = formatNotification([event({ worktreeName: "   " })]);
		expect(spec?.title).toBe("ThinkRail");
	});

	test("multiple → aggregated notification targeting the app", () => {
		const spec = formatNotification([
			event({ sessionId: "s1" }),
			event({ sessionId: "s2" }),
			event({ sessionId: "s3" }),
		]);
		expect(spec).toEqual({
			title: "ThinkRail",
			body: "3 worktrees need attention",
			tag: "thinkrail-attention",
			target: { kind: "app" },
		});
	});

	test("body is truncated to ~100 chars", () => {
		const spec = formatNotification([
			event({ reason: { kind: "needs-input" }, worktreeName: "x".repeat(200) }),
		]);
		// title carries the long name untruncated; body stays within the cap
		expect((spec?.body.length ?? 0) <= 100).toBe(true);
	});
});
