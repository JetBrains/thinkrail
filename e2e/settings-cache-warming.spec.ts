import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import type { CacheWarmingMode } from "@thinkrail/contracts";
import { openSettingsSection, openWorkspaceChat } from "./fixtures/app";
import { E2E_PI_AGENT_DIR } from "./fixtures/paths";
import { shot } from "./fixtures/screenshots";
import { E2eWire } from "./fixtures/wire";

const settingsPath = join(E2E_PI_AGENT_DIR, "settings.json");
let wire: E2eWire;
let savedSettings: string | null = null;

function readSettings(): Record<string, unknown> {
	return existsSync(settingsPath)
		? (JSON.parse(readFileSync(settingsPath, "utf8")) as Record<string, unknown>)
		: {};
}

function savedMode(): unknown {
	return readSettings().cacheWarming;
}

function writeSettings(settings: Record<string, unknown>): void {
	writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
}

async function openModels(page: Page): Promise<void> {
	await openSettingsSection(page, "models");
}

async function expectMode(page: Page, mode: CacheWarmingMode): Promise<void> {
	await expect(page.getByTestId(`cache-warming-${mode}`)).toHaveAttribute("aria-selected", "true");
}

async function choose(page: Page, mode: CacheWarmingMode): Promise<void> {
	const segment = page.getByTestId(`cache-warming-${mode}`);
	await expect(segment).toBeEnabled();
	await segment.click();
	await expectMode(page, mode);
}

test.beforeAll(() => {
	savedSettings = existsSync(settingsPath) ? readFileSync(settingsPath, "utf8") : null;
});

test.afterAll(() => {
	if (savedSettings === null) rmSync(settingsPath, { force: true });
	else writeFileSync(settingsPath, savedSettings);
});

test.beforeEach(async ({ page }) => {
	const { cacheWarming: _unset, ...rest } = readSettings();
	writeSettings(rest);
	await openWorkspaceChat(page);
	await openModels(page);
	wire = await E2eWire.connect(Number(new URL(page.url()).port));
});

test.afterEach(() => {
	wire?.close();
});

test("cache warming starts on ThinkRail's streaming default, saves the user's choice into pi's settings.json and survives a reload", async ({
	page,
}) => {
	const group = page.getByTestId("cache-warming-group");
	await expect(page.getByTestId("cache-warming")).toHaveAttribute(
		"data-cache-warming-source",
		"default",
	);
	await expectMode(page, "streaming");
	await expect(group).toContainText("ThinkRail default");
	await expect(page.getByTestId("settings-reset-prompt-cache")).toHaveCount(0);
	expect(await wire.request("cacheWarming.get", {})).toEqual({
		mode: "streaming",
		source: "default",
	});
	await shot(group, "models-settings", "cache-warming-default");

	await choose(page, "idle");
	await expect.poll(savedMode).toBe("idle");
	await expect(page.getByTestId("cache-warming")).toHaveAttribute(
		"data-cache-warming-source",
		"user",
	);
	await expect(group).not.toContainText("ThinkRail default");
	expect(await wire.request("cacheWarming.get", {})).toEqual({ mode: "idle", source: "user" });

	await page.reload();
	await openModels(page);
	await expectMode(page, "idle");
	await shot(group, "models-settings", "cache-warming-idle");

	await page.getByTestId("cache-warming-idle").focus();
	await page.keyboard.press("ArrowLeft");
	await expectMode(page, "streaming");
	await expect(page.getByTestId("cache-warming-streaming")).toBeFocused();
	await expect.poll(savedMode).toBe("streaming");
	await page.keyboard.press("ArrowLeft");
	await expectMode(page, "off");
	await expect.poll(savedMode).toBe("off");

	await page.getByTestId("settings-reset-prompt-cache").click();
	await expectMode(page, "streaming");
	await expect.poll(savedMode).toBe("streaming");
	await expect(page.getByTestId("settings-reset-prompt-cache")).toHaveCount(0);
});

test("a mode pi's settings.json already names is shown as the user's choice", async ({ page }) => {
	const before = readSettings();
	writeSettings({ ...before, cacheWarming: "off" });
	await page.reload();
	await openModels(page);
	await expectMode(page, "off");
	await expect(page.getByTestId("cache-warming")).toHaveAttribute(
		"data-cache-warming-source",
		"user",
	);
	await choose(page, "streaming");
	await expect.poll(savedMode).toBe("streaming");
	expect(readSettings()).toEqual({ ...before, cacheWarming: "streaming" });
});
