import { realpathSync, utimesSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { defaultWorkspaceRow, enterDefaultWorkspace, openFixtureProject } from "./fixtures/app";
import { E2E_FIXTURE_REPO } from "./fixtures/paths";
import { seedWorkspaceSession } from "./fixtures/sessions";

const BASE_TS = 1_700_300_000_000;
const LONG_PROMPT =
	"Please refactor the authentication module so that tokens refresh quietly\nand keep the tests green";
const LONG_PROMPT_HEAD = "Please refactor the authentication module so that tokens refresh quietly";
const LONG_PROMPT_LABEL = "Please refactor the authentication module so…";

const repoCwd = () => realpathSync(E2E_FIXTURE_REPO);

function setMtime(path: string, ms: number): void {
	utimesSync(path, new Date(ms), new Date(ms));
}

test("unnamed chats read as their first prompt in the tab strip and Recently closed until named", async ({
	page,
}) => {
	await openFixtureProject(page);
	const older = seedWorkspaceSession(repoCwd(), {
		messages: [
			{ role: "user", text: LONG_PROMPT, timestamp: BASE_TS },
			{ role: "assistant", text: "Refactored; tests green.", timestamp: BASE_TS + 1_000 },
		],
	});
	setMtime(older.path, BASE_TS);
	const latest = seedWorkspaceSession(repoCwd(), {
		messages: [
			{
				role: "user",
				text: "Fix the login redirect\nIt loops on /signin.",
				timestamp: BASE_TS + 10_000,
			},
		],
	});
	setMtime(latest.path, BASE_TS + 10_000);

	await page.reload();
	await expect(page.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");
	await expect(defaultWorkspaceRow(page)).toHaveAttribute("data-attention", "true");
	await page.keyboard.press("ControlOrMeta+k");
	const paletteTitle = page
		.locator(`[data-testid="search-row"][data-item-id="chat:${older.id}"]`)
		.locator("[data-title-source]");
	await expect(paletteTitle).toHaveAttribute("data-title-source", "prompt");
	await expect(paletteTitle).toHaveText(LONG_PROMPT_LABEL);
	await expect(paletteTitle).toHaveAttribute("title", LONG_PROMPT_HEAD);
	await page.keyboard.type("tokens refresh quietly");
	await expect(
		page.locator(`[data-testid="search-row"][data-item-id="chat:${older.id}"]`),
	).toBeVisible();
	await page.keyboard.press("Escape");
	await page.keyboard.press("Escape");
	await expect(page.getByTestId("search-palette")).toBeHidden();

	await enterDefaultWorkspace(page);
	const chatTab = page.locator('[data-testid="editor-tab"][data-kind="chat"]');
	await expect(chatTab).toHaveAttribute("data-session-id", latest.id);
	await expect(chatTab).toHaveAttribute("data-title-source", "prompt");
	await expect(chatTab).toContainText("Fix the login redirect");
	await expect(chatTab.getByRole("tab")).toHaveAttribute("title", "Fix the login redirect");

	await page.getByTestId("chat-history").first().click();
	const closedTitle = page
		.locator(`[data-testid="closed-chat-row"][data-session-id="${older.id}"]`)
		.locator("[data-title-source]");
	await expect(closedTitle).toHaveAttribute("data-title-source", "prompt");
	await expect(closedTitle).toHaveText(LONG_PROMPT_LABEL);
	await expect(closedTitle).toHaveAttribute("title", LONG_PROMPT_HEAD);
	await page.keyboard.press("Escape");
	await expect(page.getByTestId("closed-chat-item")).toHaveCount(0);

	await chatTab.click({ button: "right" });
	await page.getByRole("menuitem", { name: "Rename chat", exact: true }).click();
	const nameInput = chatTab.getByTestId("chat-tab-name-input");
	await expect(nameInput).toBeFocused();
	await expect(nameInput).toHaveValue("");
	await nameInput.fill("Login redirect loop");
	await nameInput.press("Enter");
	await expect(chatTab).toHaveAttribute("data-title-source", "name");
	await expect(chatTab).toContainText("Login redirect loop");
	await expect(chatTab.getByRole("tab")).toHaveAttribute("title", "Login redirect loop");

	await page.reload();
	await expect(page.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");
	await expect(chatTab).toHaveAttribute("data-title-source", "name");
	await expect(chatTab).toContainText("Login redirect loop");
});

test("a new chat takes its first prompt as its label the moment it is sent", async ({ page }) => {
	await openFixtureProject(page);
	await enterDefaultWorkspace(page);
	await page.getByTestId("new-chat").first().click();
	const chatTab = page.locator('[data-testid="editor-tab"][data-kind="chat"]');
	await expect(chatTab).toHaveCount(1);
	await expect(chatTab).toHaveAttribute("data-title-source", "default");
	await expect(chatTab).toContainText("Chat");

	const input = page.getByTestId("chat-input");
	await input.fill("Investigate   the flaky watcher test");
	await input.press("Shift+Enter");
	await input.pressSequentially("it fails every third run");
	await input.press("Enter");
	await expect(page.locator('[data-testid="chat-message"][data-role="user"]')).toContainText(
		"Investigate the flaky watcher test",
	);
	await expect(chatTab).toHaveAttribute("data-title-source", "prompt");
	await expect(chatTab).toContainText("Investigate the flaky watcher test");
	await expect(chatTab.getByRole("tab")).toHaveAttribute(
		"title",
		"Investigate the flaky watcher test",
	);
});
