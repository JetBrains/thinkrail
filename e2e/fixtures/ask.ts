import { realpathSync, utimesSync } from "node:fs";
import { expect, type Page } from "@playwright/test";
import type { ToolCall, ToolResponsePendingDetails } from "@thinkrail/contracts";
import type { AskUserQuestionArgs } from "@thinkrail/pi-ask-user-question/core";
import { openPersistedChat } from "./app";
import { E2E_FIXTURE_REPO } from "./paths";
import { seedWorkspaceSession } from "./sessions";

export type QuestionnaireArgs = AskUserQuestionArgs & ToolCall["arguments"];

export function seedQuestionnaire(
	name: string,
	toolCallId: string,
	args: QuestionnaireArgs,
	timestamp: number,
	prompt = "Ask me these questions.",
): { id: string; path: string } {
	const ack: ToolResponsePendingDetails = { kind: "ack" };
	const session = seedWorkspaceSession(realpathSync(E2E_FIXTURE_REPO), {
		name,
		messages: [
			{ role: "user", text: prompt, timestamp },
			{
				role: "assistant",
				content: [{ type: "toolCall", id: toolCallId, name: "ask_user_question", arguments: args }],
				stopReason: "toolUse",
				timestamp: timestamp + 1_000,
			},
			{
				role: "toolResult",
				toolCallId,
				toolName: "ask_user_question",
				content: [{ type: "text", text: "Questions shown to the user; awaiting an answer." }],
				details: ack,
				isError: false,
				timestamp: timestamp + 2_000,
			},
		],
	});
	utimesSync(session.path, new Date(timestamp), new Date(timestamp));
	return session;
}

export async function openPersistedChatAfterInput(page: Page, title: string): Promise<void> {
	await openPersistedChat(page, title);
	const chatTab = page
		.locator('[data-testid="editor-tab"][data-kind="chat"]')
		.filter({ hasText: title });
	await chatTab.hover();
	await chatTab.getByTestId("editor-tab-close").click();
	await expect(chatTab).toHaveCount(0);
	await openPersistedChat(page, title);
}
