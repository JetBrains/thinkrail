import { realpathSync, rmSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { enterDefaultWorkspace, openFixtureProject } from "./fixtures/app";
import { E2E_FIXTURE_REPO } from "./fixtures/paths";
import { seedWorkspaceSession } from "./fixtures/sessions";

const BASE_TS = 1_700_300_000_000;
const repoCwd = () => realpathSync(E2E_FIXTURE_REPO);

test.afterEach(() => {
	rmSync(join(E2E_FIXTURE_REPO, ".thinkrail"), { recursive: true, force: true });
});

test("clicking a follow-up chip fills the draft, dismisses only that chip, and keeps the rest", async ({
	page,
}) => {
	await openFixtureProject(page);

	seedWorkspaceSession(repoCwd(), {
		name: "follow-up chat",
		messages: [
			{ role: "user", text: "which way should we go?", timestamp: BASE_TS },
			{
				role: "assistant",
				text: "Here are two approaches; I recommend the first option.",
				timestamp: BASE_TS + 1_000,
			},
		],
	});

	await enterDefaultWorkspace(page);
	await expect(page.getByText("I recommend the first option")).toBeVisible();

	const row = page.getByTestId("followup-row");
	const chips = page.getByTestId("followup-chip");
	await expect(row).toBeVisible();
	await expect(chips).toHaveCount(2);
	const picked = chips.filter({ hasText: "Use the recommended option" });
	await expect(picked).toBeVisible();

	await picked.click();

	const composer = page.getByTestId("chat-input");
	await expect(composer).toHaveValue(
		"Use the recommended option and continue with the implementation.",
	);
	await expect(composer).toBeFocused();
	await expect(row).toBeVisible();
	await expect(chips).toHaveCount(1);
	await expect(chips.filter({ hasText: "Compare the options" })).toBeVisible();
	await expect(picked).toHaveCount(0);
});
