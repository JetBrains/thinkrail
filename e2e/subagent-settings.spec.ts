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
		workspace: page.getByTestId("subagents-workspace-toggle"),
		source: page.getByTestId("subagents-workspace-source"),
		globalLimit: page.getByTestId("subagent-limit-global-input"),
		workspaceLimit: page.getByTestId("subagent-limit-workspace-input"),
		limitSource: page.getByTestId("subagent-limit-workspace-source"),
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
	for (const tag of [current.source, current.limitSource]) {
		if ((await tag.count()) > 0 && (await tag.getAttribute("data-source")) === "custom") {
			await tag.click();
			await expect(tag).toHaveAttribute("data-source", "global");
		}
	}
	if ((await current.globalLimit.inputValue()) !== "4") {
		await current.globalLimit.fill("4");
		await current.globalLimit.press("Enter");
		await expect(current.workspaceLimit).toHaveAttribute("placeholder", "4");
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
	const heading = page.getByTestId("subagents-workspace-heading");
	await expect(heading).toContainText(longName);
	for (const element of [heading, page.getByTestId("settings-subagents")]) {
		expect(await element.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
	}
});

test("global and workspace subagent switches converge from authoritative pushes", async ({
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
		await expect(source.workspace).toHaveAttribute("data-active", "true");
		await expect(source.source).toHaveAttribute("data-source", "global");

		const globalFrame = channelHold.arm("settings.changed");
		releaseGlobal = globalFrame.release;
		await source.global.click();
		await globalFrame.held;
		await expect(source.global).toHaveAttribute("data-active", "true");
		await expect(observer.global).toHaveAttribute("data-active", "false");
		releaseGlobal();
		await expect(source.global).toHaveAttribute("data-active", "false");
		await expect(source.workspace).toHaveAttribute("data-active", "false");
		await expect(source.source).toHaveAttribute("data-source", "global");

		const workspaceFrame = channelHold.arm("workspace.updated");
		releaseWorkspace = workspaceFrame.release;
		await source.workspace.click();
		await workspaceFrame.held;
		await expect(source.workspace).toHaveAttribute("data-active", "false");
		await expect(observer.workspace).toHaveAttribute("data-active", "true");
		await expect(observer.source).toHaveAttribute("data-source", "custom");
		releaseWorkspace();
		await expect(source.workspace).toHaveAttribute("data-active", "true");
		await expect(source.source).toHaveAttribute("data-source", "custom");

		await source.global.click();
		await source.workspace.click();
		for (const current of [source, observer]) {
			await expect(current.global).toHaveAttribute("data-active", "true");
			await expect(current.workspace).toHaveAttribute("data-active", "false");
			await expect(current.source).toHaveAttribute("data-source", "custom");
		}

		await page.reload();
		await expect(page.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");
		await openChatSettings(page);
		await expect(source.global).toHaveAttribute("data-active", "true");
		await expect(source.workspace).toHaveAttribute("data-active", "false");

		await source.source.click();
		for (const current of [source, observer]) {
			await expect(current.workspace).toHaveAttribute("data-active", "true");
			await expect(current.source).toHaveAttribute("data-source", "global");
		}
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

		await expect(source.globalLimit).toHaveValue("4");
		await expect(source.workspaceLimit).toHaveValue("");
		await expect(source.workspaceLimit).toHaveAttribute("placeholder", "4");
		await expect(source.limitSource).toHaveAttribute("data-source", "global");

		await source.globalLimit.fill("0");
		await expect(source.globalLimit).toHaveAttribute("aria-invalid", "true");
		await expect(page.getByText("Use 1–16")).toBeVisible();
		await source.globalLimit.press("Escape");
		await expect(source.globalLimit).toHaveValue("4");
		await expect(page.getByTestId("settings-dialog")).toBeVisible();
		await source.globalLimit.fill("6");
		await source.globalLimit.press("Enter");
		await expect(observer.globalLimit).toHaveValue("6");
		await expect(observer.workspaceLimit).toHaveAttribute("placeholder", "6");

		await source.workspaceLimit.fill("2");
		await source.workspaceLimit.press("Enter");
		for (const current of [source, observer]) {
			await expect(current.workspaceLimit).toHaveValue("2");
			await expect(current.limitSource).toHaveAttribute("data-source", "custom");
		}

		await observer.limitSource.click();
		for (const current of [source, observer]) {
			await expect(current.workspaceLimit).toHaveValue("");
			await expect(current.limitSource).toHaveAttribute("data-source", "global");
		}
		await observer.workspaceLimit.fill("2");
		await observer.workspaceLimit.press("Enter");
		await expect(source.workspaceLimit).toHaveValue("2");

		await page.reload();
		await expect(page.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");
		await openChatSettings(page);
		await expect(source.globalLimit).toHaveValue("6");
		await expect(source.workspaceLimit).toHaveValue("2");

		await source.workspaceLimit.fill("");
		await source.workspaceLimit.press("Enter");
		for (const current of [source, observer]) {
			await expect(current.workspaceLimit).toHaveValue("");
			await expect(current.limitSource).toHaveAttribute("data-source", "global");
		}
	} finally {
		await restoreSubagentBaseline(page).catch(() => {});
		await peer?.close();
	}
});
