import { describe, expect, test } from "bun:test";
import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import { currentOffer } from "./offer.ts";
import type { NextStepItem } from "./schema.ts";

let seq = 0;
const entry = (fields: Record<string, unknown>): SessionEntry =>
	({
		id: `e${++seq}`,
		parentId: null,
		timestamp: "2026-01-01T00:00:00.000Z",
		...fields,
	}) as unknown as SessionEntry;

const items: NextStepItem[] = [
	{ label: "Run tests", prompt: "Run the e2e suite." },
	{ label: "Open a PR", prompt: "Open a PR for this branch." },
];

const offerResult = (overrides: Record<string, unknown> = {}): SessionEntry =>
	entry({
		type: "message",
		message: {
			role: "toolResult",
			toolCallId: "call-1",
			toolName: "offer_next_steps",
			content: [{ type: "text", text: "…" }],
			details: { items },
			isError: false,
			timestamp: 1,
			...overrides,
		},
	});

const userMessage = () =>
	entry({ type: "message", message: { role: "user", content: "hi", timestamp: 1 } });

const assistantMessage = () =>
	entry({
		type: "message",
		message: { role: "assistant", content: [{ type: "text", text: "done" }], timestamp: 1 },
	});

describe("currentOffer", () => {
	test("reads the offer when its result is the latest message on the branch", () => {
		expect(currentOffer([userMessage(), assistantMessage(), offerResult()])).toEqual({
			toolCallId: "call-1",
			items,
		});
	});

	test("looks past non-message entries — a resumed session replays model/label entries", () => {
		const entries = [
			userMessage(),
			assistantMessage(),
			offerResult(),
			entry({ type: "model_change", provider: "anthropic", modelId: "m" }),
			entry({ type: "label", targetId: "e1", label: "checkpoint" }),
			entry({ type: "custom", customType: "some-extension", data: {} }),
		];
		expect(currentOffer(entries)?.toolCallId).toBe("call-1");
	});

	test("a later user message makes the offer stale", () => {
		expect(currentOffer([offerResult(), userMessage()])).toBeNull();
	});

	test("a later assistant message makes the offer stale", () => {
		expect(currentOffer([offerResult(), assistantMessage()])).toBeNull();
	});

	test("a later result from another tool makes the offer stale", () => {
		const other = entry({
			type: "message",
			message: {
				role: "toolResult",
				toolCallId: "call-2",
				toolName: "bash",
				content: [],
				isError: false,
				timestamp: 2,
			},
		});
		expect(currentOffer([offerResult(), other])).toBeNull();
	});

	test("a failed offer is not on offer", () => {
		expect(currentOffer([offerResult({ isError: true })])).toBeNull();
	});

	test("details that no longer validate are not on offer", () => {
		expect(currentOffer([offerResult({ details: { items: [] } })])).toBeNull();
		expect(currentOffer([offerResult({ details: undefined })])).toBeNull();
	});

	test("an empty or message-free branch has no offer", () => {
		expect(currentOffer([])).toBeNull();
		expect(currentOffer([entry({ type: "session_info", name: "chat" })])).toBeNull();
	});
});
