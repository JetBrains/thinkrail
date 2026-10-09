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

async function restoreSubagentLimitBaseline(page: Page): Promise<void> {
	if (page.isClosed()) return;
	if (await page.getByTestId("settings-dialog").isVisible()) await page.keyboard.press("Escape");
	await openChatSettings(page);
	const inherit = page.getByTestId("subagent-limit-workspace-inherit");
	if ((await inherit.count()) > 0 && (await inherit.getAttribute("data-active")) !== "true") {
		await inherit.click();
		await expect(inherit).toHaveAttribute("data-active", "true");
	}
	const input = page.getByTestId("subagent-limit-global-input");
	if ((await input.inputValue()) !== "4") {
		await input.fill("4");
		await input.press("Enter");
		await expect(inherit).toContainText("Currently 4");
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

test("global and workspace subagent limits persist, inherit, and converge across clients", async ({
	page,
	context,
}) => {
	let peer: Page | undefined;
	const globalInput = (target: Page) => target.getByTestId("subagent-limit-global-input");
	const workspaceInherit = (target: Page) => target.getByTestId("subagent-limit-workspace-inherit");
	const workspaceCustom = (target: Page) => target.getByTestId("subagent-limit-workspace-custom");
	const workspaceInput = (target: Page) => target.getByTestId("subagent-limit-workspace-input");
	try {
		await openFixtureProject(page);
		await enterDefaultWorkspace(page);
		peer = await context.newPage();
		await peer.goto(page.url());
		await expect(peer.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");
		await openChatSettings(page);
		await openChatSettings(peer);

		await expect(globalInput(page)).toHaveValue("4");
		await expect(workspaceInherit(page)).toHaveAttribute("data-active", "true");
		await expect(workspaceInherit(page)).toContainText("Currently 4");
		await expect(workspaceInput(page)).toHaveCount(0);

		await globalInput(page).fill("0");
		await expect(page.getByTestId("subagent-limit-global-apply")).toBeDisabled();
		await expect(page.getByText("Enter a whole number from 1 to 16.")).toBeVisible();
		await globalInput(page).fill("6");
		await globalInput(page).press("Enter");
		await expect(globalInput(peer)).toHaveValue("6");
		await expect(workspaceInherit(peer)).toContainText("Currently 6");

		await workspaceCustom(page).click();
		await expect(workspaceInput(page)).toHaveValue("6");
		await expect(workspaceInherit(peer)).toHaveAttribute("data-active", "true");
		await workspaceInput(page).fill("2");
		await page.getByTestId("subagent-limit-workspace-apply").click();
		await expect(workspaceCustom(peer)).toHaveAttribute("data-active", "true");
		await expect(workspaceCustom(peer)).toContainText("2 at once");
		await expect(workspaceInput(peer)).toHaveValue("2");

		await workspaceInherit(peer).click();
		for (const target of [page, peer]) {
			await expect(workspaceInherit(target)).toHaveAttribute("data-active", "true");
			await expect(workspaceInput(target)).toHaveCount(0);
		}
		await workspaceCustom(peer).click();
		await workspaceInput(peer).fill("2");
		await workspaceInput(peer).press("Enter");
		await expect(workspaceCustom(page)).toHaveAttribute("data-active", "true");
		await expect(workspaceInput(page)).toHaveValue("2");

		await page.reload();
		await expect(page.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");
		await openChatSettings(page);
		await expect(globalInput(page)).toHaveValue("6");
		await expect(workspaceInput(page)).toHaveValue("2");

		await workspaceInherit(page).click();
		await expect(workspaceInherit(peer)).toHaveAttribute("data-active", "true");
		await expect(workspaceInput(page)).toHaveCount(0);
	} finally {
		await restoreSubagentLimitBaseline(page).catch(() => {});
		await peer?.close();
	}
});
