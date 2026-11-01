import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { enterDefaultWorkspace, openFixtureProject, openPersistedChat } from "./fixtures/app";
import { E2E_DATA_DIR, E2E_FIXTURE_REPO, E2E_PI_AGENT_DIR } from "./fixtures/paths";
import { piExtensionSource, writePiPackageFixture } from "./fixtures/piPackage";
import { seedWorkspaceSession } from "./fixtures/sessions";
import { E2eWire } from "./fixtures/wire";

const FIXTURE_PACKAGE = join(E2E_DATA_DIR, "pi-package-fixture");
const SETTINGS_PATH = join(E2E_PI_AGENT_DIR, "settings.json");

function writeFixturePackage(): void {
	writePiPackageFixture(FIXTURE_PACKAGE, {
		name: "@e2e/pi-fixture-tools",
		description: "Fixture tools for the e2e lane",
		extension: { file: "hello.ts", tool: "fixture_hello", command: "fixture-hello" },
		skill: { name: "triage", description: "Fixture triage skill." },
	});
}

function readSettings(): Record<string, unknown> {
	if (!existsSync(SETTINGS_PATH)) return {};
	return JSON.parse(readFileSync(SETTINGS_PATH, "utf8")) as Record<string, unknown>;
}

function clearPackageSettings(): void {
	if (!existsSync(SETTINGS_PATH)) return;
	const settings = readSettings();
	delete settings.packages;
	delete settings.extensions;
	writeFileSync(SETTINGS_PATH, `${JSON.stringify(settings, null, 2)}\n`);
}

async function openExtensionsSettings(page: Page) {
	await page.getByTestId("open-settings").click();
	await page.getByTestId("settings-nav-extensions").click();
	const section = page.getByTestId("settings-extensions");
	await expect(section).toBeVisible();
	return section;
}

async function closeSettings(page: Page): Promise<void> {
	const dialog = page.getByTestId("settings-dialog");
	if (!(await dialog.isVisible())) return;
	await page.keyboard.press("Escape");
	await expect(dialog).toBeHidden();
}

test.beforeEach(() => {
	writeFixturePackage();
	clearPackageSettings();
});

test.afterEach(async ({ page }) => {
	clearPackageSettings();
	rmSync(FIXTURE_PACKAGE, { recursive: true, force: true });
	if (page.isClosed()) return;
	const wire = await E2eWire.connect(Number(new URL(page.url()).port));
	try {
		await wire.request("settings.update", { config: { disabledPackages: [] } });
	} finally {
		wire.close();
	}
});

test("a pi package installed from Settings reaches a chat, switches off and on, and is removed", async ({
	page,
}) => {
	test.setTimeout(120_000);
	await openFixtureProject(page);
	const wire = await E2eWire.connect(Number(new URL(page.url()).port));
	try {
		const section = await openExtensionsSettings(page);
		await expect(section.getByTestId("settings-packages")).toBeVisible();
		await expect(section.getByTestId("packages-empty")).toBeVisible();
		await expect(section.getByTestId("builtin-toggle-mcp")).toHaveAttribute("data-active", "true");

		await section.getByTestId("packages-install").click();
		const dialog = page.getByTestId("install-package-dialog");
		await expect(dialog).toBeVisible();
		await dialog
			.getByTestId("install-package-source")
			.fill("https://pi.dev/packages/@jals1212/pi-spaces");
		await expect(dialog.getByTestId("install-package-echo")).toHaveText(
			"npm · @jals1212/pi-spaces",
		);
		await expect(dialog.getByTestId("install-package-submit")).toContainText("@jals1212/pi-spaces");
		await dialog.getByTestId("install-package-source").fill(FIXTURE_PACKAGE);
		await expect(dialog.getByTestId("install-package-echo")).toContainText("local folder or file");
		await dialog.getByTestId("install-package-submit").click();
		await expect(dialog.getByTestId("install-package-done")).toBeVisible({ timeout: 60_000 });
		await expect(dialog.getByTestId("install-package-chips")).toContainText("fixture_hello");
		await expect(dialog.getByTestId("install-package-chips")).toContainText("/fixture-hello");
		await expect(dialog.getByTestId("install-package-chips")).toContainText("skill: triage");
		await expect(dialog.getByTestId("install-package-applies")).toContainText("Installed globally");
		await dialog.getByTestId("install-package-done").click();
		await expect(dialog).toBeHidden();

		const row = section.getByTestId("package-row");
		await expect(row).toHaveCount(1);
		await expect(row).toContainText("@e2e/pi-fixture-tools");
		await expect(row.getByTestId("package-chip-fixture_hello")).toBeVisible();
		await expect(row.getByTestId("package-toggle")).toHaveAttribute("data-active", "true");
		expect(readSettings().packages).toEqual([expect.stringContaining("pi-package-fixture")]);
		await closeSettings(page);

		const project = (await wire.request("project.list", {}))[0];
		if (!project) throw new Error("Missing fixture project");
		const workspaces = await wire.request("workspace.list", { projectId: project.id });
		const workspace = workspaces.find((candidate) => candidate.kind === "default");
		if (!workspace) throw new Error("Missing default workspace");
		const session = seedWorkspaceSession(realpathSync(E2E_FIXTURE_REPO), {
			name: "package lifecycle",
			messages: [{ role: "user", text: "hello", timestamp: Date.now() }],
		});
		await enterDefaultWorkspace(page);
		await openPersistedChat(page, "package lifecycle");
		await expect(page.getByTestId("chat-toolbar")).toBeVisible();
		const commandNames = async () =>
			(await wire.request("session.getCommands", { sessionId: session.id })).map((c) => c.name);
		await expect.poll(commandNames, { timeout: 30_000 }).toContain("fixture-hello");

		await openExtensionsSettings(page);
		await page.getByTestId("package-toggle").click();
		await expect(page.getByTestId("package-toggle")).toHaveAttribute("data-active", "false");
		await expect.poll(commandNames, { timeout: 30_000 }).not.toContain("fixture-hello");
		await page.getByTestId("package-toggle").click();
		await expect(page.getByTestId("package-toggle")).toHaveAttribute("data-active", "true");
		await expect.poll(commandNames, { timeout: 30_000 }).toContain("fixture-hello");

		await page.getByTestId("package-expand").click();
		const resources = page.getByTestId("package-resources");
		await expect(resources).toBeVisible();
		await expect(resources.getByTestId("package-resource-hello.ts")).toBeVisible();
		await expect(resources.getByTestId("package-resource-triage")).toBeVisible();
		await expect(resources.getByTestId("package-resource-toggle-hello.ts")).toHaveCount(0);

		await page.getByTestId("builtin-toggle-tool-search").click();
		await expect(page.getByTestId("builtin-toggle-tool-search")).toHaveAttribute(
			"data-active",
			"false",
			{ timeout: 15_000 },
		);
		expect(JSON.stringify(readSettings().extensions)).toContain("-builtin:tool-search");
		await page.getByTestId("builtin-toggle-tool-search").click();
		await expect(page.getByTestId("builtin-toggle-tool-search")).toHaveAttribute(
			"data-active",
			"true",
		);

		await page.getByTestId("package-menu").click();
		await page.getByTestId("package-menu-remove").click();
		await page.getByTestId("package-remove-confirm").click();
		await expect(page.getByTestId("package-row")).toHaveCount(0, { timeout: 30_000 });
		await expect(page.getByTestId("packages-empty")).toBeVisible();
		expect(readSettings().packages ?? []).toEqual([]);
		await expect.poll(commandNames, { timeout: 30_000 }).not.toContain("fixture-hello");
	} finally {
		wire.close();
	}
});

test("a hand-dropped extension file is listed as a local file with its tools and switch", async ({
	page,
}) => {
	const loose = join(E2E_PI_AGENT_DIR, "extensions", "loose-e2e.ts");
	mkdirSync(join(E2E_PI_AGENT_DIR, "extensions"), { recursive: true });
	writeFileSync(loose, piExtensionSource("loose_tool"));
	try {
		await openFixtureProject(page);
		const section = await openExtensionsSettings(page);
		const row = section.getByTestId("loose-extension-row").filter({ hasText: "loose-e2e.ts" });
		await expect(row).toHaveCount(1);
		await expect(row.getByTestId("package-chip-loose_tool")).toHaveCount(0);
		await closeSettings(page);

		seedWorkspaceSession(realpathSync(E2E_FIXTURE_REPO), {
			name: "loose file",
			messages: [{ role: "user", text: "hello", timestamp: Date.now() }],
		});
		await enterDefaultWorkspace(page);
		await openPersistedChat(page, "loose file");
		await expect(page.getByTestId("chat-toolbar")).toBeVisible();
		await openExtensionsSettings(page);
		await expect(row.getByTestId("package-chip-loose_tool")).toBeVisible({ timeout: 30_000 });
		await row.getByTestId("loose-extension-toggle").click();
		await expect(row.getByTestId("loose-extension-toggle")).toHaveAttribute(
			"data-active",
			"false",
			{ timeout: 15_000 },
		);
		expect(JSON.stringify(readSettings().extensions)).toContain("-extensions/loose-e2e.ts");
	} finally {
		rmSync(loose, { force: true });
	}
});

test("a package declared in settings but missing on disk is listed as Not installed and can be removed", async ({
	page,
}) => {
	const settings = readSettings();
	settings.packages = ["npm:@e2e/never-published"];
	writeFileSync(SETTINGS_PATH, `${JSON.stringify(settings, null, 2)}\n`);
	await openFixtureProject(page);
	const section = await openExtensionsSettings(page);
	const row = section.getByTestId("package-row");
	await expect(row).toHaveCount(1);
	await expect(row).toHaveAttribute("data-installed", "false");
	await expect(row.getByTestId("package-not-installed")).toBeVisible();
	await expect(row.getByTestId("package-toggle")).toHaveCount(0);
	await row.getByTestId("package-menu").click();
	await page.getByTestId("package-menu-remove").click();
	await page.getByTestId("package-remove-confirm").click();
	await expect(section.getByTestId("packages-empty")).toBeVisible();
	expect(readSettings().packages ?? []).toEqual([]);
});
