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

test("a follow-up chip fills the composer draft without sending, and hides once a draft exists", async ({
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
	await expect(row).toBeVisible();
	const chip = page.getByTestId("followup-chip").filter({ hasText: "Use the recommended option" });
	await expect(chip).toBeVisible();

	await chip.click();

	const composer = page.getByTestId("chat-input");
	await expect(composer).toHaveValue(
		"Use the recommended option and continue with the implementation.",
	);
	await expect(composer).toBeFocused();
	// The row hides once a draft exists (draft-protection: a chip only replaces an empty draft).
	await expect(row).toHaveCount(0);
});
