import { expect, type Page, test } from "@playwright/test";
import { enterDefaultWorkspace, openFixtureProject } from "./fixtures/app";
import {
	DEMO_EXTENSION,
	demoSource,
	installDemoExtension,
	invokeDemoAction,
	reloadDemoExtension,
	removeDemoExtension,
	writeDemoFile,
} from "./fixtures/extensions";
import { shot } from "./fixtures/screenshots";

const GROUP = "extensions";
const PANEL_TOOL = `ext:${DEMO_EXTENSION}:side`;

async function openDemoWorkspace(page: Page): Promise<void> {
	await openFixtureProject(page);
	await enterDefaultWorkspace(page);
	installDemoExtension();
	expect((await reloadDemoExtension()).status).toBe("active");
}

async function openSurfaceFromMenu(page: Page, surface: string): Promise<void> {
	await page.getByTestId("ext-menu").first().click();
	await page.getByTestId(`ext-open-${DEMO_EXTENSION}-${surface}`).click();
}

test.afterEach(() => removeDemoExtension());

test("an extension mounts in a panel, a tab, and the topbar with live channels and actions", async ({
	page,
}) => {
	await openDemoWorkspace(page);
	const badge = page.getByTestId("demo-badge");
	await expect(badge).toHaveText("demo 0");

	await openSurfaceFromMenu(page, "side");
	await expect(page.getByTestId(`tab-${PANEL_TOOL}`)).toContainText("Demo panel");
	const count = page.getByTestId("demo-count");
	await expect(count).toHaveText("count 0");
	await expect(page.locator("link[data-ext-stylesheet]")).not.toHaveCount(0);

	await invokeDemoAction("bump", 3);
	await expect(count).toHaveText("count 3");
	await expect(badge).toHaveText("demo 3");

	await page.getByTestId("demo-bump").click();
	await expect(count).toHaveText("count 5");
	await page.getByTestId("demo-echo").click();
	await expect(page.getByTestId("demo-reply")).toContainText('"payload":"ping"');
	await expect(page.getByTestId("demo-reply")).not.toContainText('"workspace":null');

	await openSurfaceFromMenu(page, "board");
	const board = page.getByTestId("demo-board");
	await expect(board).toBeVisible();
	await expect(page.getByTestId("demo-board-count")).toHaveText("count 5");
	await expect(page.getByTestId("demo-board-workspace")).toHaveText("workspace attached");
	await expect(
		page
			.locator('[data-testid="editor-tab"][data-kind="extension"]')
			.filter({ hasText: "Demo board" }),
	).toHaveCount(1);

	await openSurfaceFromMenu(page, "board");
	await expect(page.locator('[data-kind="extension"]')).toHaveCount(1);

	await shot(page, GROUP, "00-panel-tab-status");
	await shot(page.getByTestId("demo-side"), GROUP, "01-panel");
	await shot(board, GROUP, "02-tab");
	await shot(page.getByTestId("ext-status-items"), GROUP, "03-status");
});

test("a reload swaps the view in place and a broken reload keeps the last working view", async ({
	page,
}) => {
	await openDemoWorkspace(page);
	await openSurfaceFromMenu(page, "side");
	const version = page.getByTestId("demo-version");
	await expect(version).toHaveText("Demo panel v1");
	await page.evaluate(() => Reflect.set(window, "__extReloadMarker", "kept"));

	writeDemoFile("side.tsx", demoSource("side.tsx").replace("Demo panel v1", "Demo panel v2"));
	const swapped = await reloadDemoExtension();
	expect(swapped.status).toBe("active");
	await expect(version).toHaveText("Demo panel v2");
	await expect(page.locator(`[data-testid="ext-surface"][data-surface="side"]`)).toHaveAttribute(
		"data-build",
		swapped.build ?? "",
	);
	expect(await page.evaluate(() => Reflect.get(window, "__extReloadMarker"))).toBe("kept");

	writeDemoFile("side.tsx", "export default function Side() { return <div>{</div>; }\n");
	const broken = await reloadDemoExtension();
	expect(broken.status).toBe("error");
	expect(broken.generation).toBe(swapped.generation);
	expect(broken.build).toBe(swapped.build);
	await expect(version).toHaveText("Demo panel v2");
	const banner = page
		.getByTestId("ext-surface-error")
		.filter({ hasText: "Reload failed; showing the last working version" });
	await expect(banner.first()).toBeVisible();
	await expect(banner.first()).toContainText("side.tsx");
	expect(await page.evaluate(() => Reflect.get(window, "__extReloadMarker"))).toBe("kept");
	await shot(
		page.locator('[data-testid="ext-surface"][data-surface="side"]'),
		GROUP,
		"04-broken-reload",
	);
});

test("a restored layout keeps a placeholder for an extension that is not loaded", async ({
	page,
}) => {
	await openDemoWorkspace(page);
	await openSurfaceFromMenu(page, "side");
	await openSurfaceFromMenu(page, "board");
	await expect(page.getByTestId("demo-board")).toBeVisible();

	await removeDemoExtension();
	const placeholder = page
		.getByTestId("ext-surface-placeholder")
		.filter({ hasText: `extension ${DEMO_EXTENSION} not loaded` });
	await expect(placeholder.first()).toBeVisible();
	await expect(page.getByTestId("demo-badge")).toHaveCount(0);

	await page.reload();
	await expect(page.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");
	await expect(page.getByTestId(`tab-${PANEL_TOOL}`)).toBeVisible();
	await expect(page.locator('[data-kind="extension"]')).toHaveCount(1);
	await expect(placeholder.first()).toBeVisible();
});
