import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { createWorkspaceViaDialog, openFixtureProject, worktreeRows } from "./fixtures/app";
import { E2E_DATA_DIR, E2E_PI_AGENT_DIR } from "./fixtures/paths";

const FIXTURE_PACKAGE = join(E2E_DATA_DIR, "pi-package-live-fixture");
const SETTINGS_PATH = join(E2E_PI_AGENT_DIR, "settings.json");

function writeFixturePackage(): void {
	mkdirSync(join(FIXTURE_PACKAGE, "extensions"), { recursive: true });
	writeFileSync(
		join(FIXTURE_PACKAGE, "package.json"),
		JSON.stringify({
			name: "@e2e/pi-live-fixture",
			version: "0.1.0",
			pi: { extensions: ["./extensions/*.ts"] },
		}),
	);
	writeFileSync(
		join(FIXTURE_PACKAGE, "extensions", "secret.ts"),
		[
			"export default function (pi) {",
			"  pi.registerTool({",
			'    name: "fixture_secret_word", label: "fixture_secret_word",',
			'    description: "Returns the secret word the user asked for. Call it whenever the user asks for the secret word.",',
			'    parameters: { type: "object", properties: {} },',
			'    execute: async () => ({ content: [{ type: "text", text: "The secret word is QUOKKA." }], details: {} }),',
			"  });",
			"}",
			"",
		].join("\n"),
	);
}

function clearPackageSettings(): void {
	if (!existsSync(SETTINGS_PATH)) return;
	const settings = JSON.parse(readFileSync(SETTINGS_PATH, "utf8")) as Record<string, unknown>;
	settings.packages = undefined;
	writeFileSync(SETTINGS_PATH, `${JSON.stringify(settings, null, 2)}\n`);
}

test.afterEach(() => {
	clearPackageSettings();
	rmSync(FIXTURE_PACKAGE, { recursive: true, force: true });
});

test("the agent calls a tool from a pi package installed in Settings", { tag: "@agent" }, async ({
	page,
}) => {
	test.setTimeout(180_000);
	writeFixturePackage();
	await openFixtureProject(page);

	await page.getByTestId("open-settings").click();
	await page.getByTestId("settings-nav-extensions").click();
	await page.getByTestId("packages-install").click();
	const dialog = page.getByTestId("install-package-dialog");
	await dialog.getByTestId("install-package-source").fill(FIXTURE_PACKAGE);
	await dialog.getByTestId("install-package-submit").click();
	await expect(dialog.getByTestId("install-package-done")).toBeVisible({ timeout: 60_000 });
	await expect(dialog.getByTestId("install-package-chips")).toContainText("fixture_secret_word");
	await dialog.getByTestId("install-package-done").click();
	await page.keyboard.press("Escape");
	await expect(page.getByTestId("settings-dialog")).toBeHidden();

	await createWorkspaceViaDialog(page);
	await expect(worktreeRows(page).first()).toHaveAttribute("data-active", "true");
	await expect(page.locator('[data-testid="editor-tab"][data-kind="chat"]')).toHaveCount(1);
	await page
		.getByTestId("chat-input")
		.fill("Use the fixture_secret_word tool and reply with exactly the secret word it returns.");
	await page.getByTestId("chat-send").click();

	const assistant = page.locator('[data-testid="chat-message"][data-role="assistant"]').last();
	await expect(assistant).toContainText("QUOKKA", { timeout: 90_000 });
	await expect(
		page.locator('[data-testid="activity-step"][data-tool="fixture_secret_word"]').first(),
	).toBeVisible();
});
