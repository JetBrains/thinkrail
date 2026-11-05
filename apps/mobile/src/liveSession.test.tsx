import { describe, expect, test } from "bun:test";
import { messagesToRuntime } from "@thinkrail/chat-ui/hydrate";
import { deriveRows } from "@thinkrail/chat-ui/rows";
import { ChatTurnView } from "@thinkrail/chat-ui/turns";
import type { ChatTurn } from "@thinkrail/chat-ui/types";
import type { TranscriptMessage } from "@thinkrail/contracts";
import { TooltipProvider } from "@thinkrail/ui/tooltip";
import { renderToStaticMarkup } from "react-dom/server";
import { phoneExtUi, queuedDraft, queueOf, withNotes } from "./liveSession";

const system = (id: string): ChatTurn => ({ kind: "system", id, text: id });

describe("queueOf", () => {
	test("reads a queue_update and ignores other events", () => {
		expect(
			queueOf({ type: "queue_update", steering: ["a"], followUp: [], hasImages: true }),
		).toEqual({ steering: ["a"], followUp: [], hasImages: true });
		expect(queueOf({ type: "agent_start" })).toBeUndefined();
	});
});

describe("phoneExtUi", () => {
	test("turns this session's notify into a note anchored after the last turn", () => {
		expect(
			phoneExtUi(
				{ id: "1", sessionId: "s", kind: "notify", message: "boom", level: "error" },
				"s",
				"t2",
			),
		).toEqual({ kind: "note", note: { id: "note:1", kind: "error", text: "boom", after: "t2" } });
	});

	test("keeps a provider notice, ignores other sessions and dialogs", () => {
		expect(
			phoneExtUi(
				{ id: "1", sessionId: "s", kind: "notice", notice: "anthropicExtraUsage" },
				"s",
				null,
			),
		).toEqual({ kind: "notice", notice: "anthropicExtraUsage" });
		expect(
			phoneExtUi(
				{ id: "1", sessionId: "x", kind: "notify", message: "m", level: "info" },
				"s",
				null,
			),
		).toBeNull();
		expect(
			phoneExtUi({ id: "1", sessionId: "s", kind: "confirm", title: "t", message: "m" }, "s", null),
		).toBeNull();
	});
});

describe("withNotes", () => {
	test("places notes after their anchor turn, first ones before any turn, orphans at the end", () => {
		const turns = [system("t1"), system("t2")];
		const ids = withNotes(turns, [
			{ id: "n0", kind: "system", text: "", after: null },
			{ id: "n1", kind: "system", text: "", after: "t1" },
			{ id: "n2", kind: "error", text: "", after: "gone" },
			{ id: "n3", kind: "system", text: "", after: "t1" },
		]).map((turn) => turn.id);
		expect(ids).toEqual(["n0", "t1", "n1", "n3", "t2", "n2"]);
	});

	test("returns the same turns when there are no notes", () => {
		const turns = [system("t1")];
		expect(withNotes(turns, [])).toBe(turns);
	});
});

describe("queuedDraft", () => {
	test("puts queued text before the current draft and collects images", () => {
		const image = { type: "image" as const, data: "x", mimeType: "image/png" };
		expect(
			queuedDraft("mine", {
				steering: [{ text: "first", images: [image] }],
				followUp: [{ text: "second" }],
			}),
		).toEqual({ text: "first\n\nsecond\n\nmine", images: [image] });
		expect(queuedDraft("  ", { steering: [{ text: "only" }], followUp: [] }).text).toBe("only");
	});
});

const failed = [
	{ role: "user", content: "hi", timestamp: 1 },
	{
		role: "assistant",
		content: [],
		stopReason: "error",
		errorMessage: "529 overloaded",
		timestamp: 2,
	},
] as unknown as TranscriptMessage[];

const render = (turns: ChatTurn[], onTryAgain?: () => void): string => {
	const rows = deriveRows(turns, {}, false);
	return renderToStaticMarkup(
		<TooltipProvider>
			{rows.map((row) => (
				<ChatTurnView
					key={row.id}
					row={row}
					agentResponded={false}
					isFinalAnswer={false}
					onTryAgain={onTryAgain}
				/>
			))}
		</TooltipProvider>,
	);
};

test("a provider failure in a re-read transcript offers Try again once the phone passes it", () => {
	const { turns } = messagesToRuntime(failed, undefined, { idScope: "s" });
	expect(render(turns, () => {})).toContain("Try again");
	expect(render(turns)).not.toContain("Try again");
});

test("an extension's notify renders in the transcript where it arrived", () => {
	const { turns } = messagesToRuntime(failed.slice(0, 1), undefined, { idScope: "s" });
	const html = render(
		withNotes(turns, [
			{ id: "n", kind: "system", text: "Lint passed", after: turns[0]?.id ?? null },
		]),
	);
	expect(html).toContain("Lint passed");
});
