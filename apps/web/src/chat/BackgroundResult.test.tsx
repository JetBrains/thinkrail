import { expect, test } from "bun:test";
import {
	BACKGROUND_COMMAND_COMPLETION_CUSTOM_TYPE,
	type BackgroundCommandCompletionDetails,
	type TranscriptMessage,
} from "@thinkrail/contracts";
import { currentTranslator } from "@thinkrail/locales/react";
import { renderToStaticMarkup } from "react-dom/server";
import { EMPTY_RUNTIME, reduceSessionEvent } from "@/store";
import { BackgroundCommandResult, SubagentResult } from "./BackgroundResult";
import { type ChatActions, ChatActionsContext } from "./ChatActions";
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
	const hydrated = messagesToRuntime(currentTranslator(), [message], undefined, {
		idScope: "chat",
	});
	for (const runtime of [live, hydrated]) {
		expect(runtime.turns).toHaveLength(1);
		expect(runtime.turns[0]).toMatchObject({ kind: "backgroundCommandCompletion", details });
		expect(deriveRows(runtime.turns, runtime.toolResults, false)[0]).toMatchObject({
			kind: "backgroundCommandCompletion",
			details,
		});
	}
	expect(hydrated.turnIdByMessageIndex[0]).toBe(hydrated.turns[0]?.id ?? null);
	expect(
		messagesToRuntime(currentTranslator(), [message], undefined, { idScope: "chat" }).turns[0]?.id,
	).toBe(hydrated.turns[0]?.id);
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
		expect(messagesToRuntime(currentTranslator(), [ignored]).turns).toEqual([]);
		expect(
			reduceSessionEvent(EMPTY_RUNTIME, { type: "message_end", message: ignored }).turns,
		).toEqual([]);
	}
});

test("a command result rests as one collapsed row with its state, exit code and last output line", () => {
	const html = renderToStaticMarkup(<BackgroundCommandResult id="row" details={details} />);
	expect(html).toContain('data-testid="background-command-completion"');
	expect(html).toContain('data-status="completed"');
	expect(html).toContain("data-chat-fold-root");
	expect(html).toContain('data-expanded="false"');
	expect(html).toContain("Done");
	expect(html).toContain("exit 0");
	expect(html).toContain(">**plain text**<");
	expect(html).not.toContain("Output truncated");
	expect(html).not.toContain("<script>");
});

test("a command result offers Open log only while the chat can still open it in Resources", () => {
	const render = (resultOpener: ChatActions["resultOpener"]) =>
		renderToStaticMarkup(
			<ChatActionsContext.Provider value={{ resultOpener } as unknown as ChatActions}>
				<BackgroundCommandResult id="row" details={details} />
			</ChatActionsContext.Provider>,
		);
	const asked: unknown[] = [];
	expect(
		render((target) => {
			asked.push(target);
			return () => {};
		}),
	).toContain("Open log");
	expect(asked).toEqual([{ kind: "command", id: "command" }]);
	expect(render(() => undefined)).not.toContain('data-testid="background-result-open"');
});

test("a subagent result teases its report, offers the transcript and never renders the pi header", () => {
	const actions = { resultOpener: () => () => {} } as unknown as ChatActions;
	const html = renderToStaticMarkup(
		<ChatActionsContext.Provider value={actions}>
			<SubagentResult
				id="sub"
				details={{
					childSessionId: "child-1",
					roleName: "reviewer",
					task: "review",
					status: "completed",
					usage: {
						input: 40_000,
						output: 8_000,
						cacheRead: 0,
						cacheWrite: 0,
						cost: 0.31,
						turns: 12,
						contextTokens: 0,
					},
					durationMs: 4 * 60_000,
				}}
				text={'Subagent "reviewer" (child-1) completed:\n\n**Verdict: approve.**\n\n- nit'}
			/>
		</ChatActionsContext.Provider>,
	);
	expect(html).toContain('data-testid="subagent-completion"');
	expect(html).toContain("reviewer");
	expect(html).toContain("Done");
	expect(html).toContain("4 min");
	expect(html).toContain("12 turns · 48k tok · $0.310");
	expect(html).toContain("Verdict: approve.");
	expect(html).toContain('data-testid="background-result-open"');
	expect(html).not.toContain("completed:");
	expect(html).not.toContain("<strong>");
});
