import { expect, test } from "bun:test";
import {
	BACKGROUND_COMMAND_COMPLETION_CUSTOM_TYPE,
	type BackgroundCommandCompletionDetails,
	type TranscriptMessage,
} from "@thinkrail/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { EMPTY_RUNTIME, reduceSessionEvent } from "@/store";
import { BackgroundCommandCompletion } from "./BackgroundCommandCompletion";
import { messagesToRuntime } from "./hydrate";
import { deriveRows } from "./rows";

const details: BackgroundCommandCompletionDetails = {
	id: "command",
	sessionId: "chat",
	name: "Build",
	status: "completed",
	startedAt: 1,
	finishedAt: 2,
	exitCode: 0,
	output: { text: "<script>bad()</script>\n**plain text**", truncated: true },
};
const message: TranscriptMessage = {
	role: "custom",
	customType: BACKGROUND_COMMAND_COMPLETION_CUSTOM_TYPE,
	content: "Untrusted **notice**",
	details,
	display: true,
	timestamp: 2,
};

test("live and hydrated command completion messages produce the same historical row and never resource authority", () => {
	const live = reduceSessionEvent(EMPTY_RUNTIME, { type: "message_end", message });
	const hydrated = messagesToRuntime([message], undefined, { idScope: "chat" });
	for (const runtime of [live, hydrated]) {
		expect(runtime.turns).toHaveLength(1);
		expect(runtime.turns[0]).toMatchObject({ kind: "backgroundCommandCompletion", details });
		expect(deriveRows(runtime.turns, runtime.toolResults, false)[0]).toMatchObject({
			kind: "backgroundCommandCompletion",
			details,
		});
	}
	expect(hydrated.turnIdByMessageIndex[0]).toBe(hydrated.turns[0]?.id ?? null);
	expect(messagesToRuntime([message], undefined, { idScope: "chat" }).turns[0]?.id).toBe(
		hydrated.turns[0]?.id,
	);
	expect(live.isStreaming).toBe(false);
	expect(live.toolResults).toBe(EMPTY_RUNTIME.toolResults);
});

test("invalid and unknown custom notices keep their prior ignored behavior in both paths", () => {
	for (const ignored of [
		{ ...message, customType: "unknown-custom" },
		{ ...message, details: { ...details, finishedAt: undefined } },
		{ ...message, details: { ...details, status: "running" } },
		{ ...message, display: false },
	]) {
		expect(messagesToRuntime([ignored]).turns).toEqual([]);
		expect(
			reduceSessionEvent(EMPTY_RUNTIME, { type: "message_end", message: ignored }).turns,
		).toEqual([]);
	}
});

test("historical output renders as escaped bounded plain text, with native terminal status and exit code", () => {
	const html = renderToStaticMarkup(<BackgroundCommandCompletion details={details} />);
	expect(html).toContain('data-testid="background-command-completion"');
	expect(html).toContain('data-status="completed"');
	expect(html).toContain("Exit 0");
	expect(html).toContain("Output truncated");
	expect(html).toContain("&lt;script&gt;bad()&lt;/script&gt;");
	expect(html).toContain("**plain text**");
	expect(html).not.toContain("<script>");
	expect(html).not.toContain("<strong>");
});
