import { realpathSync, rmSync, utimesSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { enterDefaultWorkspace, openFixtureProject } from "./fixtures/app";
import { E2E_FIXTURE_REPO } from "./fixtures/paths";
import { seedWorkspaceSession } from "./fixtures/sessions";

const BASE_TS = 1_700_700_000_000;

async function selectMessageOrder(page: Page, order: "oldest-first" | "newest-first") {
	await page.getByTestId("open-settings").click();
	await page.getByTestId("settings-nav-chat").click();
	const option = page.getByTestId(`chat-order-${order}`);
	await option.click();
	await expect(option).toHaveAttribute("data-active", "true");
	await page.keyboard.press("Escape");
}

test("the synchronized message-order setting reverses groups and their rows", async ({ page }) => {
	const session = seedWorkspaceSession(realpathSync(E2E_FIXTURE_REPO), {
		name: "message order chat",
		messages: [
			{ role: "user", text: "oldest request", timestamp: BASE_TS },
			{ role: "assistant", text: "oldest answer", timestamp: BASE_TS + 1_000 },
			{ role: "user", text: "newest request", timestamp: BASE_TS + 2_000 },
			{ role: "assistant", text: "newest answer", timestamp: BASE_TS + 3_000 },
		],
	});
	utimesSync(session.path, new Date(BASE_TS + 10_000), new Date(BASE_TS + 10_000));

	try {
		await openFixtureProject(page);
		await selectMessageOrder(page, "oldest-first");
		await enterDefaultWorkspace(page);

		const messages = page.getByTestId("chat-message");
		await expect(messages).toHaveText([
			"oldest request",
			"oldest answer",
			"newest request",
			"newest answer",
		]);

		await selectMessageOrder(page, "newest-first");
		await expect(messages).toHaveText([
			"newest answer",
			"newest request",
			"oldest answer",
			"oldest request",
		]);
		await expect(page.getByText("newest answer")).toBeInViewport();

		await page.reload();
		await expect(page.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");
		await expect(messages).toHaveText([
			"newest answer",
			"newest request",
			"oldest answer",
			"oldest request",
		]);

		await selectMessageOrder(page, "oldest-first");
	} finally {
		rmSync(session.path, { force: true });
	}
});
