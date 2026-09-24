import { realpathSync, rmSync } from "node:fs";
import { expect, test } from "@playwright/test";
import type { AskUserQuestionAckDetails, AskUserQuestionArgs } from "@thinkrail/contracts";
import {
	enterDefaultWorkspace,
	hideAuxiliaryWorkbench,
	openFixtureProject,
	openPersistedChat,
} from "./fixtures/app";
import { E2E_FIXTURE_REPO } from "./fixtures/paths";
import { seedWorkspaceSession } from "./fixtures/sessions";

const BASE_TS = 1_700_800_000_000;

test("a pending ask_user_question is answerable from the plan page", async ({ page }) => {
	await openFixtureProject(page);
	const args: AskUserQuestionArgs = {
		questions: [
			{
				question: "Which rollout should we use?",
				header: "Rollout",
				options: [
					{ label: "Blue", description: "the blue one" },
					{ label: "Green", description: "the green one" },
				],
			},
		],
	};
	const ack: AskUserQuestionAckDetails = { kind: "ack" };
	const session = seedWorkspaceSession(realpathSync(E2E_FIXTURE_REPO), {
		name: "plan ask question",
		messages: [
			{ role: "user", text: "Ask me.", timestamp: BASE_TS },
			{
				role: "assistant",
				content: [{ type: "toolCall", id: "ask-1", name: "ask_user_question", arguments: args }],
				stopReason: "toolUse",
				timestamp: BASE_TS + 1000,
			},
			{
				role: "toolResult",
				toolCallId: "ask-1",
				toolName: "ask_user_question",
				content: [{ type: "text", text: "awaiting" }],
				details: ack,
				isError: false,
				timestamp: BASE_TS + 2000,
			},
		],
	});
	try {
		await enterDefaultWorkspace(page);
		await hideAuxiliaryWorkbench(page);
		await openPersistedChat(page, "plan ask question");
		await page.getByTestId("chat-plan-toggle").click();
		await page.getByTestId("chat-plan-popover").getByTestId("todo-open-plan").click();
		const pane = page.getByTestId("plan-pane");
		await expect(pane).toBeVisible();
		const card = pane.getByTestId("plan-ask");
		await expect(card.getByTestId("ask-question-text")).toHaveText("Which rollout should we use?");
		await card.getByTestId("ask-option").filter({ hasText: "Green" }).click();
		await card.getByTestId("ask-submit").click();
		await expect(card.getByTestId("ask-sent")).toBeVisible();
	} finally {
		rmSync(session.path, { force: true });
	}
});
