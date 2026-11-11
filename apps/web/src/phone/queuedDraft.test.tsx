import { expect, test } from "bun:test";
import { messagesToRuntime } from "@thinkrail/chat-ui/hydrate";
import { deriveRows } from "@thinkrail/chat-ui/rows";
import { ChatTurnView } from "@thinkrail/chat-ui/turns";
import type { ChatTurn } from "@thinkrail/chat-ui/types";
import type { TranscriptMessage } from "@thinkrail/contracts";
import { TooltipProvider } from "@thinkrail/ui/tooltip";
import { renderToStaticMarkup } from "react-dom/server";
import { draftWith, queuedDraft } from "./queuedDraft";

test("puts queued text before the current draft and collects images", () => {
	const image = { type: "image" as const, data: "x", mimeType: "image/png" };
	const queued = queuedDraft({
		steering: [{ text: "first", images: [image] }],
		followUp: [{ text: " " }, { text: "second" }],
	});
	expect(queued).toEqual({ text: "first\n\nsecond", images: [image] });
	expect(draftWith(queued.text, "mine")).toBe("first\n\nsecond\n\nmine");
	expect(draftWith(queuedDraft({ steering: [{ text: "only" }], followUp: [] }).text, "  ")).toBe(
		"only",
	);
	expect(draftWith("", "typed")).toBe("typed");
});

test("a message that did not send goes back before what was typed since, with its images", () => {
	const image = { type: "image" as const, data: "x", mimeType: "image/png" };
	const queued = queuedDraft({ steering: [{ text: "lost", images: [image] }], followUp: [] });
	expect(draftWith(queued.text, "typed since")).toBe("lost\n\ntyped since");
	expect(queued.images).toEqual([image]);
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

test("a provider failure in a hydrated transcript offers Try again once the phone passes it", () => {
	const { turns } = messagesToRuntime(failed, undefined, { idScope: "s" });
	expect(render(turns, () => {})).toContain("Try again");
	expect(render(turns)).not.toContain("Try again");
});
