import { realpathSync } from "node:fs";
import { expect, test } from "@playwright/test";
import {
	defaultWorkspaceRow,
	enterDefaultWorkspace,
	openChatFromHistory,
	openFixtureProject,
} from "./fixtures/app";
import { E2E_FIXTURE_REPO } from "./fixtures/paths";
import { seedWorkspaceSession } from "./fixtures/sessions";

const BASE_TS = 1_700_900_000_000;
const INSTRUCTION_MARKER = "Inspect every changed file before making recommendations.";
const USER_REQUEST = "Focus on the transport boundary and run the relevant tests.";

const expandedSkill = [
	'<skill name="e2e-review" location="/tmp/e2e-review/SKILL.md">',
	"References are relative to /tmp/e2e-review.",
	"",
	"# Review workflow",
	"",
	INSTRUCTION_MARKER,
	"",
	"Report concrete findings with file references.",
	"</skill>",
	"",
	USER_REQUEST,
].join("\n");

test("a persisted expanded skill renders as one collapsed invocation with its request visible", async ({
	page,
}) => {
	await openFixtureProject(page);
	seedWorkspaceSession(realpathSync(E2E_FIXTURE_REPO), {
		name: "skill invocation chat",
		messages: [
			{ role: "user", text: expandedSkill, timestamp: BASE_TS },
			{ role: "assistant", text: "I will review that boundary.", timestamp: BASE_TS + 1_000 },
		],
	});

	await expect(defaultWorkspaceRow(page)).toBeVisible();
	await enterDefaultWorkspace(page);
	await openChatFromHistory(page, "skill invocation chat");

	const userTurns = page.locator('[data-testid="chat-message"][data-role="user"]');
	await expect(userTurns).toHaveCount(1);
	const card = page.getByTestId("skill-invocation-card");
	await expect(card).toBeVisible();
	await expect(card).toHaveAttribute("data-expanded", "false");
	await expect(page.getByTestId("skill-invocation-name")).toHaveText("e2e-review");
	await expect(page.getByTestId("skill-user-request")).toHaveText(USER_REQUEST);
	await expect(page.getByTestId("skill-invocation-content")).toHaveCount(0);
	await expect(page.getByText(INSTRUCTION_MARKER)).toHaveCount(0);

	const toggle = page.getByTestId("skill-invocation-toggle");
	await toggle.click();
	await expect(card).toHaveAttribute("data-expanded", "true");
	await expect(toggle).toHaveAttribute("aria-expanded", "true");
	await expect(page.getByTestId("skill-invocation-content")).toBeVisible();
	await expect(page.getByText(INSTRUCTION_MARKER)).toBeVisible();

	await toggle.click();
	await expect(card).toHaveAttribute("data-expanded", "false");
	await expect(page.getByText(INSTRUCTION_MARKER)).toHaveCount(0);
});
