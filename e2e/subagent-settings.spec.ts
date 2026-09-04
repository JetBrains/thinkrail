import { expect, type Page, test } from "@playwright/test";
import {
	createWorkspaceViaDialog,
	enterDefaultWorkspace,
	openFixtureProject,
	openWorkspaceMenu,
	waitTerminalReady,
	worktreeRows,
} from "./fixtures/app";
import { installChannelHold } from "./fixtures/channelHold";

async function openChatSettings(page: Page): Promise<void> {
	await page.getByTestId("open-settings").click();
	await page.getByTestId("settings-nav-chat").click();
	await expect(page.getByTestId("settings-subagents")).toBeVisible();
}

function controls(page: Page) {
	return {
		global: page.getByTestId("subagents-global-toggle"),
		inherit: page.getByTestId("subagents-workspace-inherit"),
		on: page.getByTestId("subagents-workspace-on"),
		off: page.getByTestId("subagents-workspace-off"),
	};
}

async function restoreSubagentBaseline(page: Page): Promise<void> {
	if (page.isClosed()) return;
	if (await page.getByTestId("settings-dialog").isVisible()) await page.keyboard.press("Escape");
	await openChatSettings(page);
	const current = controls(page);
	if ((await current.global.getAttribute("data-active")) !== "true") {
		await current.global.click();
		await expect(current.global).toHaveAttribute("data-active", "true");
	}
	if (
		(await current.inherit.count()) > 0 &&
		(await current.inherit.getAttribute("data-active")) !== "true"
	) {
		await current.inherit.click();
		await expect(current.inherit).toHaveAttribute("data-active", "true");
	}
	await page.keyboard.press("Escape");
}

test("a maximal unbroken workspace name stays contained on a phone-sized settings pane", async ({
	page,
}) => {
	await openFixtureProject(page);
	await createWorkspaceViaDialog(page);
	await waitTerminalReady(page);
	const row = worktreeRows(page).first();
	const longName = "W".repeat(60);
	await openWorkspaceMenu(row);
	await page.getByTestId("workspace-rename").click();
	const input = row.getByRole("textbox", { name: "Workspace name" });
	await input.fill(longName);
	await input.press("Enter");
	await expect(row.getByTestId("workspace-name")).toHaveText(longName);

	await page.setViewportSize({ width: 390, height: 780 });
	await openChatSettings(page);
	const heading = page.getByRole("heading", { name: `This workspace — ${longName}` });
	await expect(heading).toBeVisible();
	expect(await heading.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
		true,
	);
});

test("global and workspace subagent choices converge from authoritative pushes", async ({
	page,
	context,
}) => {
	const channelHold = await installChannelHold(page);
	let releaseGlobal = () => {};
	let releaseWorkspace = () => {};
	let peer: Page | undefined;
	try {
		await openFixtureProject(page);
		await enterDefaultWorkspace(page);
		await restoreSubagentBaseline(page);

		peer = await context.newPage();
		await peer.goto(page.url());
		await expect(peer.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");
		await openChatSettings(page);
		await openChatSettings(peer);
		const source = controls(page);
		const observer = controls(peer);
		await expect(source.global).toHaveAttribute("data-active", "true");
		await expect(source.inherit).toHaveAttribute("data-active", "true");

		const globalFrame = channelHold.arm("settings.changed");
		releaseGlobal = globalFrame.release;
		await source.global.click();
		await globalFrame.held;
		await expect(source.global).toHaveAttribute("data-active", "true");
		await expect(observer.global).toHaveAttribute("data-active", "false");
		releaseGlobal();
		await expect(source.global).toHaveAttribute("data-active", "false");
		await expect(source.inherit).toContainText("Currently off");

		const workspaceFrame = channelHold.arm("workspace.updated");
		releaseWorkspace = workspaceFrame.release;
		await source.on.click();
		await workspaceFrame.held;
		await expect(source.inherit).toHaveAttribute("data-active", "true");
		await expect(observer.on).toHaveAttribute("data-active", "true");
		releaseWorkspace();
		await expect(source.on).toHaveAttribute("data-active", "true");

		await source.global.click();
		for (const current of [source, observer]) {
			await expect(current.global).toHaveAttribute("data-active", "true");
			await expect(current.on).toHaveAttribute("data-active", "true");
		}

		await source.off.click();
		for (const current of [source, observer]) {
			await expect(current.off).toHaveAttribute("data-active", "true");
		}

		await page.reload();
		await expect(page.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");
		await openChatSettings(page);
		await expect(source.global).toHaveAttribute("data-active", "true");
		await expect(source.off).toHaveAttribute("data-active", "true");

		await source.inherit.click();
		await expect(source.inherit).toHaveAttribute("data-active", "true");
		await expect(source.inherit).toContainText("Currently on");
	} finally {
		releaseGlobal();
		releaseWorkspace();
		await restoreSubagentBaseline(page).catch(() => {});
		await peer?.close();
	}
});
