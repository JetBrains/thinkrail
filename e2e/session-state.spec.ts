import { realpathSync, rmSync } from "node:fs";
import { expect, type Locator, test } from "@playwright/test";
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

async function expectAttentionDot(row: Locator): Promise<void> {
	await expect(row).toHaveAttribute("data-attention", "true");
	const dot = row.getByTestId("attention-dot");
	await expect(dot).toHaveAttribute("aria-label", "Needs attention");
	await expect(dot.locator('[aria-hidden="true"]')).toHaveClass(/bg-primary/);
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
		const project = page.getByTestId("project-item").first();
		const expand = project.getByTestId("project-expand");
		const workspace = defaultWorkspaceRow(page);
		await expectAttentionDot(workspace);
		await expect(expand).toHaveAttribute("data-expanded", "true");
		await expand.click();
		await expectAttentionDot(project);
		await expand.click();
		await expectAttentionDot(workspace);
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
	const quietSibling = seedWorkspaceSession(realpathSync(E2E_FIXTURE_REPO), {
		name: "quiet sibling",
		messages: [],
	});
	try {
		await reconnectWithSeed(page);
		const project = page.getByTestId("project-item").first();
		const workspace = defaultWorkspaceRow(page);
		await expectAttentionDot(workspace);
		await expect(project.getByTestId("project-expand")).toHaveAttribute("data-expanded", "true");
		await project.getByTestId("project-expand").click();
		await expectAttentionDot(project);
		const peer = await page.context().newPage();
		await peer.goto("/");
		await expect(peer.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");
		const peerProject = peer.getByTestId("project-item").first();
		const peerExpand = peerProject.getByTestId("project-expand");
		if ((await peerExpand.getAttribute("data-expanded")) === "true") await peerExpand.click();
		await expectAttentionDot(peerProject);

		await enterDefaultWorkspace(page);
		await openPersistedChat(page, "finished state receipt");
		await expect(page.getByText("Finished result.", { exact: true })).toBeVisible();
		await expect(workspace).not.toHaveAttribute("data-attention", /.+/);
		const projectExpand = project.getByTestId("project-expand");
		if ((await projectExpand.getAttribute("data-expanded")) === "true") await projectExpand.click();
		await expect(project).not.toHaveAttribute("data-attention", /.+/);
		await expect(peerProject).not.toHaveAttribute("data-attention", /.+/);
		await peer.close();
	} finally {
		rmSync(session.path, { force: true });
		rmSync(quietSibling.path, { force: true });
	}
});
