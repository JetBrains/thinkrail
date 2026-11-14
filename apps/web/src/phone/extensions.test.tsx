import { expect, test } from "bun:test";
import { PendingExtUiPrompt } from "@thinkrail/chat-ui/ExtUiPrompt";
import { messagesToRuntime } from "@thinkrail/chat-ui/hydrate";
import {
	deriveInteractionStates,
	InteractionStatesContext,
} from "@thinkrail/chat-ui/interactionState";
import { deriveRows } from "@thinkrail/chat-ui/rows";
import { getToolRenderer, isInteractiveTool } from "@thinkrail/chat-ui/toolRegistry";
import { ChatTurnView } from "@thinkrail/chat-ui/turns";
import type { ExtUiDialogRequest } from "@thinkrail/chat-ui/types";
import type { TranscriptMessage } from "@thinkrail/contracts";
import askUserQuestion from "@thinkrail/ext-ask-user-question/web";
import visualize from "@thinkrail/ext-visualize/web";
import { TooltipProvider } from "@thinkrail/ui/tooltip";
import { renderToStaticMarkup } from "react-dom/server";
import { registerWebExtensions } from "../extensions";

const asking = [
	{ role: "user", content: "pick a database", timestamp: 1 },
	{
		role: "assistant",
		content: [
			{
				type: "toolCall",
				id: "ask1",
				name: "ask_user_question",
				arguments: {
					questions: [
						{
							question: "Which database?",
							header: "Database",
							options: [
								{ label: "Postgres (Recommended)", description: "Relational" },
								{ label: "SQLite", description: "Embedded" },
							],
						},
					],
				},
			},
		],
	},
] as unknown as TranscriptMessage[];

test("the phone registers the same extension cards as the IDE, ask_user_question as interactive", () => {
	registerWebExtensions();
	expect(getToolRenderer("ask_user_question")).toBe(
		askUserQuestion.toolRenderers.ask_user_question.renderer,
	);
	expect(isInteractiveTool("ask_user_question")).toBe(true);
	expect(getToolRenderer("visualize")).toBe(visualize.toolRenderers.visualize.renderer);
});

test("a waiting ask_user_question renders as its question card with its options, not raw arguments", () => {
	registerWebExtensions();
	const runtime = messagesToRuntime(asking);
	const rows = deriveRows(runtime.turns, runtime.toolResults, true);
	const html = renderToStaticMarkup(
		<TooltipProvider>
			<InteractionStatesContext.Provider
				value={{
					states: deriveInteractionStates(
						runtime.turns,
						runtime.toolResponses,
						runtime.toolResults,
					),
					focusScope: {},
					awaitingToolCallId: "ask1",
				}}
			>
				{rows.map((row) => (
					<ChatTurnView key={row.id} row={row} agentResponded={false} isFinalAnswer={false} />
				))}
			</InteractionStatesContext.Provider>
		</TooltipProvider>,
	);
	expect(html).toContain("Which database?");
	expect(html).toContain("Postgres");
	expect(html).toContain("SQLite");
	expect(html).not.toContain("&quot;questions&quot;");
});

test("a pending confirm dialog renders its question and both answers", () => {
	const request = {
		kind: "confirm",
		id: "d1",
		title: "Allow rm -rf build?",
		message: "",
	} as unknown as ExtUiDialogRequest;
	const html = renderToStaticMarkup(
		<PendingExtUiPrompt
			pending={{
				request,
				reply: () => {},
				draft: () => undefined,
				rememberDraft: () => {},
				claimReveal: () => false,
			}}
		/>,
	);
	expect(html).toContain("Allow rm -rf build?");
	expect(html).toContain("Cancel");
	expect(html).toContain("OK");
});
