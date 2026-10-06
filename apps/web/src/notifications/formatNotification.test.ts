import { describe, expect, test } from "bun:test";
import { type AttentionEvent, formatNotification, reasonLabel } from "./formatNotification";

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
		expect(reasonLabel({ kind: "needs-input" })).toBe("Waiting for your input");
	});

	test("completion outcomes", () => {
		expect(
			reasonLabel({ kind: "completed", completion: { completionId: "c", outcome: "succeeded" } }),
		).toBe("The agent finished");
		expect(
			reasonLabel({ kind: "completed", completion: { completionId: "c", outcome: "interrupted" } }),
		).toBe("The run was interrupted");
		expect(
			reasonLabel({ kind: "completed", completion: { completionId: "c", outcome: "cancelled" } }),
		).toBe("The run was cancelled");
		expect(
			reasonLabel({
				kind: "completed",
				completion: { completionId: "c", outcome: "failed", failure: "error" },
			}),
		).toBe("The agent run failed");
		expect(
			reasonLabel({
				kind: "completed",
				completion: { completionId: "c", outcome: "failed", failure: "length" },
			}),
		).toBe("Stopped — the context is full");
	});
});

describe("formatNotification", () => {
	test("empty → null", () => {
		expect(formatNotification([])).toBeNull();
	});

	test("single → ThinkRail title, worktree + reason in body, targeting the chat", () => {
		const spec = formatNotification([event()]);
		expect(spec).toEqual({
			title: "ThinkRail",
			body: "feature-branch · Waiting for your input",
			tag: "attention:s1",
			target: { kind: "chat", workspaceId: "w1", sessionId: "s1" },
		});
	});

	test("single with a blank name drops to the reason alone", () => {
		const spec = formatNotification([event({ worktreeName: "   " })]);
		expect(spec?.title).toBe("ThinkRail");
		expect(spec?.body).toBe("Waiting for your input");
	});

	test("multiple → aggregated notification targeting the app", () => {
		const spec = formatNotification([
			event({ sessionId: "s1" }),
			event({ sessionId: "s2" }),
			event({ sessionId: "s3" }),
		]);
		expect(spec).toEqual({
			title: "ThinkRail",
			body: "3 worktrees need your attention",
			tag: "thinkrail-attention",
			target: { kind: "app" },
		});
	});

	test("single body reflects a completion outcome", () => {
		const spec = formatNotification([
			event({
				reason: {
					kind: "completed",
					completion: { completionId: "c", outcome: "failed", failure: "length" },
				},
			}),
		]);
		expect(spec?.body).toBe("feature-branch · Stopped — the context is full");
	});

	test("exactly two sessions aggregate with plural wording and a fixed tag", () => {
		const spec = formatNotification([event({ sessionId: "s1" }), event({ sessionId: "s2" })]);
		expect(spec?.body).toBe("2 worktrees need your attention");
		expect(spec?.tag).toBe("thinkrail-attention");
		expect(spec?.target).toEqual({ kind: "app" });
	});

	test("body is truncated to ~100 chars", () => {
		const spec = formatNotification([
			event({ reason: { kind: "needs-input" }, worktreeName: "x".repeat(200) }),
		]);
		// title carries the long name untruncated; body stays within the cap
		expect((spec?.body.length ?? 0) <= 100).toBe(true);
	});
});
