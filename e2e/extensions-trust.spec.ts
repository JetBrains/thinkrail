import { mkdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { enterDefaultWorkspace, openFixtureProject, openPersistedChat } from "./fixtures/app";
import {
	DEMO_EXTENSION,
	installDemoExtension,
	reloadDemoExtension,
	removeDemoExtension,
	removeExtension,
} from "./fixtures/extensions";
import { E2E_FIXTURE_REPO } from "./fixtures/paths";
import { shot } from "./fixtures/screenshots";
import { seedWorkspaceSession } from "./fixtures/sessions";

const GROUP = "extensions-trust";
const PROJECT_EXTENSION = "e2e-trusted";
const projectExtensionDir = join(E2E_FIXTURE_REPO, ".thinkrail", "extensions", PROJECT_EXTENSION);

const writeProjectExtension = () => {
	mkdirSync(projectExtensionDir, { recursive: true });
	writeFileSync(
		join(projectExtensionDir, "extension.json"),
		JSON.stringify({
			name: PROJECT_EXTENSION,
			title: "Trusted probe",
			surfaces: [{ id: "main", slot: "panel", title: "Trusted panel" }],
		}),
	);
	writeFileSync(
		join(projectExtensionDir, "index.ts"),
		'import { defineExtension } from "@thinkrail/ext";\nexport default defineExtension(() => {});\n',
	);
	writeFileSync(
		join(projectExtensionDir, "main.tsx"),
		'export default function Main() {\n\treturn <div data-testid="trusted-probe">trusted probe</div>;\n}\n',
	);
};

const openMenu = (page: Page) => page.getByTestId("ext-menu").first().click();

const expectSurfaceInMenu = async (page: Page) => {
	const item = page.getByTestId(`ext-open-${PROJECT_EXTENSION}-main`);
	await expect(async () => {
		await page.keyboard.press("Escape");
		await openMenu(page);
		await expect(item).toBeVisible({ timeout: 1_000 });
	}).toPass({ timeout: 30_000 });
	return item;
};

test.afterEach(async () => {
	rmSync(projectExtensionDir, { recursive: true, force: true });
	await removeExtension(PROJECT_EXTENSION);
	await removeDemoExtension();
});

test("the extensions button shows an empty state when nothing is installed", async ({ page }) => {
	await openFixtureProject(page);
	await enterDefaultWorkspace(page);
	await openMenu(page);
	const empty = page.getByTestId("ext-menu-empty");
	await expect(empty).toContainText("No extensions.");
	await expect(empty).toContainText("~/.thinkrail/extensions/<name>");
	await expect(empty).toContainText("<project>/.thinkrail/extensions/<name>");
	await expect(empty).toContainText("~/.thinkrail/ext-sdk/README.md");
	await expect(page.getByTestId("ext-trust-dialog")).toHaveCount(0);
	await shot(page, GROUP, "09-empty-state");
});

test("a user extension loads and mounts without trusting the project", async ({ page }) => {
	await openFixtureProject(page);
	await enterDefaultWorkspace(page);
	installDemoExtension();
	expect(await reloadDemoExtension()).toMatchObject({ scope: "user", status: "active" });

	await openMenu(page);
	await expect(page.getByTestId("ext-trust-dialog")).toHaveCount(0);
	await expect(page.getByTestId("ext-menu-group-user")).toContainText("User");
	await expect(page.getByTestId("ext-menu-group-project")).toHaveCount(0);
	const item = page.getByTestId(`ext-open-${DEMO_EXTENSION}-side`);
	await expect(item).toHaveAttribute("data-scope", "user");
	await item.click();
	await expect(page.getByTestId("demo-count")).toHaveText("count 0");
});

test("an untrusted project's extensions wait behind a trust dialog, then load live", async ({
	page,
}) => {
	writeProjectExtension();
	await openFixtureProject(page);
	await enterDefaultWorkspace(page);

	const dialog = page.getByTestId("ext-trust-dialog");
	await expect(async () => {
		await openMenu(page);
		await expect(dialog).toBeVisible({ timeout: 1_000 });
	}).toPass({ timeout: 15_000 });
	await expect(page.getByTestId("ext-trust-warning")).toContainText(
		"full access to your files, your network, and your sessions",
	);
	await expect(page.getByTestId("ext-trust-item")).toHaveCount(1);
	await expect(page.getByTestId("ext-trust-item")).toContainText("Trusted probe");
	await expect(page.getByTestId("ext-trust-item")).toContainText(PROJECT_EXTENSION);
	await shot(page, GROUP, "09-trust-modal");

	await page.getByTestId("ext-trust-cancel").click();
	await expect(dialog).toHaveCount(0);
	await openMenu(page);
	await expect(page.getByTestId("ext-menu-blocked")).toContainText("1 project extension off");
	await page.getByTestId("ext-menu-blocked").click();
	await expect(dialog).toBeVisible();

	await page.getByTestId("ext-trust-confirm").click();
	await expect(dialog).toHaveCount(0);
	const item = await expectSurfaceInMenu(page);
	await expect(page.getByTestId("ext-menu-group-project")).toContainText("Project");
	await expect(page.getByTestId("ext-menu-blocked")).toHaveCount(0);
	await expect(item).toHaveAttribute("data-scope", "project");
	await item.click();
	await expect(page.getByTestId("trusted-probe")).toHaveText("trusted probe");
});

test("the Skills dialog offers trust when only extensions are blocked", async ({ page }) => {
	writeProjectExtension();
	await openFixtureProject(page);
	seedWorkspaceSession(realpathSync(E2E_FIXTURE_REPO), {
		name: "Trust from skills",
		messages: [{ role: "user", text: "hello", timestamp: 1_700_700_000_000 }],
	});
	await enterDefaultWorkspace(page);
	await openPersistedChat(page, "Trust from skills");

	await page.getByTestId("open-skills").click();
	const banner = page.getByTestId("skills-trust-all");
	await expect(banner).toContainText("1 extension (Trusted probe) off until you trust this repo.");
	await expect(banner).toContainText("full access to your files, network, and sessions");
	await banner.getByRole("button", { name: "Trust project" }).click();
	await expect(banner).toHaveCount(0);
	await page.keyboard.press("Escape");
	await expect(page.getByTestId("skills-dialog")).toHaveCount(0);

	await (await expectSurfaceInMenu(page)).click();
	await expect(page.getByTestId("trusted-probe")).toHaveText("trusted probe");
});
