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

test("a follow-up chip appends its prompt, dismisses only itself, and survives typing", async ({
	page,
}) => {
	await openFixtureProject(page);

	seedWorkspaceSession(repoCwd(), {
		name: "follow-up chat",
		messages: [
			{ role: "user", text: "where are we?", timestamp: BASE_TS },
			{ role: "assistant", text: "All done here.", timestamp: BASE_TS + 1_000 },
		],
	});

	await enterDefaultWorkspace(page);
	await expect(page.getByText("All done here.")).toBeVisible();

	const row = page.getByTestId("followup-row");
	const chips = page.getByTestId("followup-chip");
	const composer = page.getByTestId("chat-input");
	await expect(row).toBeVisible();
	await expect(chips).toHaveCount(3);

	await composer.fill("hello");
	await expect(composer).toHaveValue("hello");
	await expect(row).toBeVisible();
	await expect(chips).toHaveCount(3);

	await chips.filter({ hasText: "Continue" }).click();
	await expect(composer).toHaveValue("hello Continue with the implementation.");
	await expect(composer).toBeFocused();
	await expect(chips).toHaveCount(2);
	await expect(chips.filter({ hasText: "Continue" })).toHaveCount(0);

	await chips.filter({ hasText: "Explain this" }).click();
	await expect(composer).toHaveValue(
		"hello Continue with the implementation. Explain what you just did and why.",
	);
	await expect(row).toBeVisible();
	await expect(chips).toHaveCount(1);
	await expect(chips.filter({ hasText: "Run the tests" })).toBeVisible();
});
