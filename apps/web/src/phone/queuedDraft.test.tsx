import { expect, test } from "bun:test";
import { messagesToRuntime } from "@thinkrail/chat-ui/hydrate";
import { deriveRows } from "@thinkrail/chat-ui/rows";
import { ChatTurnView } from "@thinkrail/chat-ui/turns";
import type { ChatTurn } from "@thinkrail/chat-ui/types";
import type { TranscriptMessage } from "@thinkrail/contracts";
import { TooltipProvider } from "@thinkrail/ui/tooltip";
import { renderToStaticMarkup } from "react-dom/server";
import { queuedDraft } from "./queuedDraft";

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
