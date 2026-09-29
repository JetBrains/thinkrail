import { mkdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
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

test("the plan shows the agent's latest message when it isn't asking or on a step", async ({
	page,
}) => {
	await openFixtureProject(page);
	const repo = realpathSync(E2E_FIXTURE_REPO);
	const session = seedWorkspaceSession(repo, {
		name: "agent activity",
		messages: [
			{ role: "user", text: "Look into the Telegram reminders.", timestamp: BASE_TS },
			{
				role: "assistant",
				content: [
					{
						type: "text",
						text: "Two problems with Lab Organic reminders: the day_of_visit avalanche and duplicates on resend \u2014 digging into the sender now.",
					},
				],
				stopReason: "endTurn",
				timestamp: BASE_TS + 1000,
			},
		],
	});
	const todosDir = join(repo, ".thinkrail", "context", "todos");
	mkdirSync(todosDir, { recursive: true });
	const todosPath = join(todosDir, `${session.id}.json`);
	writeFileSync(
		todosPath,
		JSON.stringify({
			version: 6,
			todos: [
				{
					id: "p1",
					title: "Dedup reminders by visit_id",
					status: "pending",
					origin: "agent",
					createdAt: "2026-01-01T00:00:00Z",
					updatedAt: "2026-01-01T00:00:00Z",
				},
			],
			groups: [],
		}),
	);
	try {
		await enterDefaultWorkspace(page);
		await hideAuxiliaryWorkbench(page);
		await openPersistedChat(page, "agent activity");
		await page.getByTestId("chat-plan-toggle").click();
		await page.getByTestId("chat-plan-popover").getByTestId("todo-open-plan").click();
		const pane = page.getByTestId("plan-pane");
		await expect(pane).toBeVisible();
		await expect(pane.getByTestId("plan-agent-message")).toContainText("day_of_visit avalanche");
	} finally {
		rmSync(todosPath, { force: true });
		rmSync(session.path, { force: true });
	}
});
