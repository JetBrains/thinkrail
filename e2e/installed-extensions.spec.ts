import { existsSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import type { ToolCall } from "@thinkrail/contracts";
import {
	closeSettings,
	enterDefaultWorkspace,
	expandAllRoutineGroups,
	openAppFresh,
	openFixtureProject,
	openPersistedChat,
	settingsDialog,
} from "./fixtures/app";
import {
	clearInstalledExtensions,
	declareExtensions,
	installedRow,
	openExtensionsSettings,
	PALETTE_DETAILS,
	PALETTE_DIR,
	PALETTE_HEXES,
	PALETTE_NAME,
	PALETTE_RATINGS,
	stageExtensionFixture,
	withWire,
} from "./fixtures/installedExtensions";
import { E2E_FIXTURE_REPO } from "./fixtures/paths";
import { seedWorkspaceSession } from "./fixtures/sessions";

const BASE_TS = 1_700_940_000_000;

test.afterEach(async ({ page }) => {
	if (page.isClosed() || !page.url().startsWith("http")) return;
	try {
		await clearInstalledExtensions(page);
	} finally {
		await closeSettings(page);
	}
});

type SeededMessages = Parameters<typeof seedWorkspaceSession>[1]["messages"];

function toolExchange(
	id: string,
	name: string,
	args: ToolCall["arguments"],
	details: unknown,
	at: number,
): SeededMessages {
	return [
		{
			role: "assistant",
			content: [{ type: "toolCall", id, name, arguments: args }],
			stopReason: "toolUse",
			timestamp: at,
		},
		{
			role: "toolResult",
			toolCallId: id,
			toolName: name,
			content: [{ type: "text", text: `${name} done.` }],
			details,
			isError: false,
			timestamp: at + 500,
		},
	];
}

async function openSeededChat(page: Page, name: string, messages: SeededMessages): Promise<void> {
	seedWorkspaceSession(realpathSync(E2E_FIXTURE_REPO), {
		name,
		messages: [{ role: "user", text: "Show it.", timestamp: BASE_TS }, ...messages],
	});
	await enterDefaultWorkspace(page);
	await openPersistedChat(page, name);
}

function paletteCard(page: Page) {
	return page.locator('[data-testid="tool-card"][data-tool="color_palette"]');
}

test("the palette sample installs from its folder through the dialog and lists what it brings", async ({
	page,
}) => {
	test.setTimeout(120_000);
	await openAppFresh(page);
	const section = await openExtensionsSettings(page);
	await section.getByTestId("packages-install").click();
	const dialog = page.getByTestId("install-package-dialog");
	await dialog.getByTestId("install-package-source").fill(PALETTE_DIR);
	await expect(dialog.getByTestId("install-package-echo")).toContainText("local folder or file");
	await dialog.getByTestId("install-package-submit").click();
	await expect(dialog.getByTestId("install-package-done")).toBeVisible({ timeout: 60_000 });
	await expect(dialog.getByTestId("install-package-kind")).toHaveAttribute(
		"data-kind",
		"extension",
	);
	await expect(dialog).toContainText("Installed Palette");
	await expect(dialog.getByTestId("install-package-chips")).toContainText("color_palette");
	await expect(dialog.getByTestId("install-package-cards")).toHaveText("Chat cards");
	await expect(dialog.getByTestId("install-package-settings")).toContainText("Rate contrast");
	await dialog.getByTestId("install-package-done").click();
	await expect(dialog).toBeHidden();

	const row = installedRow(page, PALETTE_NAME);
	await expect(row).toHaveAttribute("data-state", "loaded");
	await expect(row.getByTestId("installed-extension-kind")).toHaveText("ThinkRail extension");
	await expect(row).toContainText("Palette");
	await expect(row).toContainText(PALETTE_DIR);
	await expect(row.getByTestId("installed-extension-tool-color_palette")).toBeVisible();
	await expect(row.getByTestId("installed-extension-cards")).toHaveText("Chat cards");
	await expect(row.getByTestId(`extension-toggle-${PALETTE_NAME}`)).toHaveAttribute(
		"data-active",
		"true",
	);
	const setting = row.getByTestId(`extension-setting-${PALETTE_NAME}-contrast`);
	await expect(setting).toContainText("Rate contrast");
	await expect(setting).toContainText("WCAG contrast");

	const settingToggle = row.getByTestId(`extension-setting-toggle-${PALETTE_NAME}-contrast`);
	await expect(settingToggle).toHaveAttribute("data-active", "true");
	await settingToggle.click();
	await expect(settingToggle).toHaveAttribute("data-active", "false");
	await closeSettings(page);
	await page.reload();
	await openExtensionsSettings(page);
	await expect(
		installedRow(page, PALETTE_NAME).getByTestId(
			`extension-setting-toggle-${PALETTE_NAME}-contrast`,
		),
	).toHaveAttribute("data-active", "false");
	await expect(page.getByTestId("settings-bundled-extensions")).toContainText("Visualize");
	await expect(page.getByTestId("settings-bundled-extensions")).not.toContainText("Palette");
});

test("an extension asked for at repository scope installs globally in one click", async ({
	page,
}) => {
	test.setTimeout(120_000);
	await openFixtureProject(page);
	await withWire(page, async (wire) => {
		const project = (await wire.request("project.list", {}))[0];
		if (!project) throw new Error("Missing fixture project");
		await wire.request("project.setTrust", { id: project.id, trusted: true, resources: true });
	});
	await enterDefaultWorkspace(page);
	const section = await openExtensionsSettings(page);
	await section.getByTestId("packages-install").click();
	const dialog = page.getByTestId("install-package-dialog");
	await dialog.getByTestId("install-package-source").fill(PALETTE_DIR);
	await dialog.getByTestId("install-package-scope-project").click();
	await expect(dialog.getByTestId("install-package-scope-project")).toHaveAttribute(
		"data-active",
		"true",
	);
	await dialog.getByTestId("install-package-submit").click();
	await expect(dialog.getByTestId("install-package-scope-unsupported")).toBeVisible({
		timeout: 60_000,
	});
	await expect(dialog).toContainText("installs for you only");
	await dialog.getByTestId("install-package-install-globally").click();
	await expect(dialog.getByTestId("install-package-done")).toBeVisible({ timeout: 60_000 });
	await expect(dialog.getByTestId("install-package-kind")).toHaveAttribute(
		"data-kind",
		"extension",
	);
	await dialog.getByTestId("install-package-done").click();
	await expect(installedRow(page, PALETTE_NAME)).toHaveAttribute("data-state", "loaded");
});

test("a past palette call renders its card, keeps it while switched off and falls back once removed", async ({
	page,
}) => {
	test.setTimeout(120_000);
	await openFixtureProject(page);
	await declareExtensions(page, [PALETTE_DIR]);
	await openSeededChat(
		page,
		"palette card",
		toolExchange(
			"palette-1",
			"color_palette",
			{ base: "#3b82f6", harmony: "triadic" },
			PALETTE_DETAILS,
			BASE_TS + 1_000,
		),
	);
	const card = paletteCard(page);
	await expect(card).toHaveCount(1);
	await expect(card.getByTestId("palette-card")).toBeVisible();
	const swatches = card.getByTestId("palette-swatch");
	await expect(swatches).toHaveCount(5);
	for (const [index, hex] of PALETTE_HEXES.entries()) {
		await expect(swatches.nth(index)).toContainText(hex);
	}
	await expect(card.locator("[data-rating]")).toHaveCount(5);
	const ratings = await card
		.locator("[data-rating]")
		.evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-rating")));
	expect(ratings).toEqual(PALETTE_RATINGS);
	await expect(card).toContainText("triadic · #3b82f6");

	await openExtensionsSettings(page);
	const toggle = installedRow(page, PALETTE_NAME).getByTestId(`extension-toggle-${PALETTE_NAME}`);
	await toggle.click();
	await expect(toggle).toHaveAttribute("data-active", "false");
	await expect(
		installedRow(page, PALETTE_NAME).getByTestId(
			`extension-setting-toggle-${PALETTE_NAME}-contrast`,
		),
	).toBeDisabled();
	await closeSettings(page);
	await expect(card.getByTestId("palette-card")).toBeVisible();
	await expect(card.getByTestId("palette-swatch")).toHaveCount(5);

	await openExtensionsSettings(page);
	const row = installedRow(page, PALETTE_NAME);
	const primary = row.locator("[data-focus-row-primary]");
	await primary.focus();
	await page.keyboard.press("ArrowRight");
	await expect(row.getByTestId(`extension-toggle-${PALETTE_NAME}`)).toBeFocused();
	await page.keyboard.press("ArrowLeft");
	await expect(primary).toBeFocused();
	await page.keyboard.press("Shift+F10");
	await expect(page.getByTestId("installed-extension-menu-remove")).toBeVisible();
	await page.keyboard.press("Escape");
	await expect(page.getByTestId("installed-extension-menu-remove")).toHaveCount(0);
	await expect(settingsDialog(page)).toBeVisible();
	await expect(primary).toBeFocused();
	await page.keyboard.press("Delete");
	await page.getByTestId("installed-extension-remove-confirm").click();
	await expect(installedRow(page, PALETTE_NAME)).toHaveCount(0, { timeout: 60_000 });
	await closeSettings(page);
	await expect(page.getByTestId("palette-card")).toHaveCount(0);
	await expect(paletteCard(page)).toHaveCount(0);
	await expandAllRoutineGroups(page);
	await expect(
		page.locator('[data-testid="activity-step"][data-tool="color_palette"]'),
	).toHaveCount(1);
});

test("an extension built for a newer extension API is listed as incompatible and nothing of it runs", async ({
	page,
}) => {
	test.setTimeout(90_000);
	await openAppFresh(page);
	const folder = stageExtensionFixture("incompatible");
	const requested: string[] = [];
	page.on("request", (request) => {
		if (request.url().includes("/extensions/e2e-ext-incompatible")) requested.push(request.url());
	});
	const [entry] = await declareExtensions(page, [folder]);
	expect(entry?.state).toBe("incompatible");
	expect(entry?.web).toBeUndefined();

	await openExtensionsSettings(page);
	const row = installedRow(page, "e2e-ext-incompatible");
	await expect(row).toHaveAttribute("data-state", "incompatible");
	await expect(row.getByTestId("installed-extension-incompatible-tag")).toBeVisible();
	const notice = row.getByTestId("installed-extension-incompatible");
	await expect(notice).toContainText("Needs a newer ThinkRail");
	await expect(notice).toContainText("2.0");
	await expect(notice).toContainText("Update ThinkRail");
	await expect(row.getByRole("switch")).toHaveCount(0);
	await expect(row.getByTestId("installed-extension-brings")).toHaveCount(0);
	expect(existsSync(join(folder, "server-ran"))).toBe(false);
	expect(requested).toEqual([]);
	expect(await page.evaluate(() => "__e2eIncompatibleWebRan" in globalThis)).toBe(false);
});

test("a server half that fails to load shows the error on its row and the host keeps working", async ({
	page,
}) => {
	test.setTimeout(90_000);
	await openAppFresh(page);
	const folder = stageExtensionFixture("broken-server");
	const [entry] = await declareExtensions(page, [folder]);
	expect(entry?.state).toBe("failed");

	const section = await openExtensionsSettings(page);
	const row = installedRow(page, "e2e-ext-broken");
	await expect(row).toHaveAttribute("data-state", "failed");
	await expect(row.getByTestId("installed-extension-failed-tag")).toHaveText("Failed to load");
	await expect(row.getByTestId("installed-extension-error")).toContainText(
		"e2e broken server half",
	);
	await expect(row.getByRole("switch")).toHaveCount(0);
	await expect(section.getByTestId("extension-toggle-visualize")).toBeVisible();
	await expect(section.getByTestId("settings-packages")).toBeVisible();
	await withWire(page, async (wire) => {
		expect((await wire.request("extension.list", {})).length).toBeGreaterThan(1);
	});
	await closeSettings(page);
	await expect(page.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");
});

test("a card that throws falls back to the default renderer for its own row only", async ({
	page,
}) => {
	test.setTimeout(90_000);
	await openFixtureProject(page);
	const folder = stageExtensionFixture("throwing-card");
	const [entry] = await declareExtensions(page, [folder]);
	expect(entry?.web?.url).toContain("/extensions/e2e-ext-cards/");
	await openSeededChat(page, "throwing card", [
		...toolExchange("throws-1", "e2e_throwing_tool", { label: "bad" }, {}, BASE_TS + 1_000),
		...toolExchange("fine-1", "e2e_fine_tool", { label: "still fine" }, {}, BASE_TS + 3_000),
	]);
	const fine = page.locator('[data-testid="tool-card"][data-tool="e2e_fine_tool"]');
	await expect(fine.getByTestId("e2e-fine-card")).toHaveText("still fine");
	const throwing = page.locator('[data-testid="tool-card"][data-tool="e2e_throwing_tool"]');
	await expect(throwing.getByTestId("tool-renderer-fallback")).toBeVisible();
	await expect(fine.getByTestId("tool-renderer-fallback")).toHaveCount(0);
	await expect(page.getByTestId("chat-toolbar")).toBeVisible();
});
