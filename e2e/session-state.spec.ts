import { realpathSync, rmSync } from "node:fs";
import { expect, test } from "@playwright/test";
import type { AskUserQuestionArgs } from "@thinkrail/contracts";
import {
	defaultWorkspaceRow,
	enterDefaultWorkspace,
	openFixtureProject,
	openPersistedChat,
} from "./fixtures/app";
import { E2E_FIXTURE_REPO } from "./fixtures/paths";
import { seedWorkspaceSession } from "./fixtures/sessions";

const BASE_TS = 1_704_000_000_000;

async function reconnectWithSeed(page: Parameters<typeof openFixtureProject>[0]): Promise<void> {
	await page.reload();
	await expect(page.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");
	await expect(page.getByTestId("project-item").first()).toBeVisible();
}

test("an unresolved persisted question is level-triggered in project and workspace state", async ({
	page,
}) => {
	await openFixtureProject(page);
	const args: AskUserQuestionArgs = {
		questions: [
			{
				question: "Which rollout?",
				header: "Rollout",
				options: [
					{ label: "Canary", description: "Start small" },
					{ label: "All", description: "Ship everywhere" },
				],
			},
		],
	};
	const session = seedWorkspaceSession(realpathSync(E2E_FIXTURE_REPO), {
		name: "needs input state",
		messages: [
			{ role: "user", text: "Ask for rollout input.", timestamp: BASE_TS },
			{
				role: "assistant",
				content: [
					{
						type: "toolCall",
						id: "state-question",
						name: "ask_user_question",
						arguments: args,
					},
				],
				stopReason: "toolUse",
				timestamp: BASE_TS + 1,
			},
		],
	});
	try {
		await reconnectWithSeed(page);
		await expect(
			page
				.getByTestId("project-item")
				.first()
				.locator('[data-testid="session-state-glyph"][data-state="needs_input"]'),
		).toHaveCount(1);
		await expect(
			defaultWorkspaceRow(page).locator(
				'[data-testid="session-state-glyph"][data-state="needs_input"]',
			),
		).toHaveCount(1);
	} finally {
		rmSync(session.path, { force: true });
	}
});

test("an unread finished result clears only after direct chat activation renders it", async ({
	page,
}) => {
	await openFixtureProject(page);
	const session = seedWorkspaceSession(realpathSync(E2E_FIXTURE_REPO), {
		name: "finished state receipt",
		messages: [
			{ role: "user", text: "Finish this run.", timestamp: BASE_TS + 10 },
			{ role: "assistant", text: "Finished result.", timestamp: BASE_TS + 11 },
		],
	});
	try {
		await reconnectWithSeed(page);
		const projectGlyph = page
			.getByTestId("project-item")
			.first()
			.locator('[data-testid="session-state-glyph"][data-state="finished"]');
		const workspaceGlyph = defaultWorkspaceRow(page).locator(
			'[data-testid="session-state-glyph"][data-state="finished"]',
		);
		await expect(projectGlyph).toHaveCount(1);
		await expect(workspaceGlyph).toHaveCount(1);
		const peer = await page.context().newPage();
		await peer.goto("/");
		await expect(peer.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");
		const peerGlyph = peer
			.getByTestId("project-item")
			.first()
			.locator('[data-testid="session-state-glyph"][data-state="finished"]');
		await expect(peerGlyph).toHaveCount(1);

		await enterDefaultWorkspace(page);
		await openPersistedChat(page, "finished state receipt");
		const result = page.getByText("Finished result.", { exact: true });
		await expect(result).toBeVisible();
		await result.click();
		await expect(projectGlyph).toHaveCount(0);
		await expect(workspaceGlyph).toHaveCount(0);
		await expect(peerGlyph).toHaveCount(0);
		await peer.close();
	} finally {
		rmSync(session.path, { force: true });
	}
});
