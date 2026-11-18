import { expect, type Page, test } from "@playwright/test";
import {
	closeSettings,
	createWorkspaceViaDialog,
	enterDefaultWorkspace,
	openFixtureProject,
	openSettingsSection,
	openWorkspaceMenu,
	waitTerminalReady,
	worktreeRows,
} from "./fixtures/app";
import { installChannelHold } from "./fixtures/channelHold";

async function openSubagentSettings(page: Page): Promise<void> {
	await openSettingsSection(page, "subagents");
	await expect(page.getByTestId("settings-subagents")).toBeVisible();
}

function controls(page: Page) {
	return {
		global: page.getByTestId("subagents-global-toggle"),
		choice: page.getByTestId("subagents-workspace-toggle"),
		useGlobal: page.getByTestId("subagents-workspace-global"),
		on: page.getByTestId("subagents-workspace-on"),
		off: page.getByTestId("subagents-workspace-off"),
		overrideRow: page.getByTestId("subagents-workspace-row"),
		resetOverride: page.getByTestId("settings-reset-subagents-workspace"),
		globalLimit: page.getByTestId("subagent-limit-global-input"),
		workspaceLimit: page.getByTestId("subagent-limit-workspace-input"),
		limitRow: page.getByTestId("subagent-limit-workspace-row"),
		resetLimit: page.getByTestId("settings-reset-subagents-workspace-limit"),
	};
}

async function restoreSubagentBaseline(page: Page): Promise<void> {
	if (page.isClosed()) return;
	await closeSettings(page);
	await openSubagentSettings(page);
	const current = controls(page);
	if ((await current.global.getAttribute("data-active")) !== "true") {
		await current.global.click();
		await expect(current.global).toHaveAttribute("data-active", "true");
	}
	for (const reset of [current.resetOverride, current.resetLimit]) {
		if ((await reset.count()) > 0) {
			await reset.click();
			await expect(reset).toHaveCount(0);
		}
	}
	if ((await current.globalLimit.inputValue()) !== "4") {
		await current.globalLimit.fill("4");
		await current.globalLimit.press("Enter");
		await expect(current.workspaceLimit).toHaveAttribute("placeholder", "4");
	}
	await closeSettings(page);
}

test("available agent switches wait for authoritative pushes and persist across clients and reload", async ({
	page,
	context,
}) => {
	const channelHold = await installChannelHold(page);
	let release = () => {};
	let peer: Page | undefined;
	try {
		await openFixtureProject(page);
		await enterDefaultWorkspace(page);
		await openSubagentSettings(page);
		const catalog = page.getByTestId("settings-agent-catalog");
		await expect(catalog.getByTestId("agent-row-scout")).toContainText("Built-in");
		await expect(catalog.getByTestId("agent-row-echo")).toContainText("Personal");
		await expect(catalog.getByTestId("agent-row-echo")).toContainText("Parent model");
		const toggle = page.getByTestId("agent-toggle-scout");
		if ((await toggle.getAttribute("data-active")) !== "true") {
			await toggle.click();
			await expect(toggle).toHaveAttribute("data-active", "true");
		}
		peer = await context.newPage();
		await peer.goto(page.url());
		await expect(peer.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");
		await openSubagentSettings(peer);
		const observer = peer.getByTestId("agent-toggle-scout");

		const held = channelHold.arm("settings.changed");
		release = held.release;
		await toggle.click();
		await held.held;
		await expect(toggle).toHaveAttribute("data-active", "true");
		await expect(observer).toHaveAttribute("data-active", "false");
		release();
		await expect(toggle).toHaveAttribute("data-active", "false");

		await page.reload();
		await expect(page.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");
		await openSubagentSettings(page);
		await expect(toggle).toHaveAttribute("data-active", "false");
		await toggle.click();
		await expect(toggle).toHaveAttribute("data-active", "true");
		await expect(observer).toHaveAttribute("data-active", "true");
		await page.getByTestId("settings-nav-chat").click();
		await expect(page.getByTestId("settings-chat")).toBeVisible();
		await expect(page.getByTestId("settings-subagents")).toHaveCount(0);
	} finally {
		release();
		if (!page.isClosed()) {
			await closeSettings(page);
			await openSubagentSettings(page);
			const toggle = page.getByTestId("agent-toggle-scout");
			if ((await toggle.getAttribute("data-active")) === "false") {
				await toggle.click();
				await expect(toggle).toHaveAttribute("data-active", "true");
			}
		}
		await peer?.close();
	}
});

test("concurrent clients disabling different roles preserve both intents before either receives pushes", async ({
	page,
	context,
}) => {
	const channelHold = await installChannelHold(page);
	const releases: (() => void)[] = [];
	const baseline = new Map<string, string | null>();
	let peer: Page | undefined;
	try {
		await openFixtureProject(page);
		await openSubagentSettings(page);
		for (const name of ["scout", "worker"]) {
			const toggle = page.getByTestId(`agent-toggle-${name}`);
			baseline.set(name, await toggle.getAttribute("data-active"));
			if (baseline.get(name) !== "true") {
				await toggle.click();
				await expect(toggle).toHaveAttribute("data-active", "true");
			}
		}
		peer = await context.newPage();
		const peerChannelHold = await installChannelHold(peer);
		await peer.goto(page.url());
		await expect(peer.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");
		await openSubagentSettings(peer);
		for (const name of ["scout", "worker"]) {
			await expect(peer.getByTestId(`agent-toggle-${name}`)).toHaveAttribute("data-active", "true");
		}

		const firstPushes = [
			channelHold.arm("settings.changed"),
			peerChannelHold.arm("settings.changed"),
		];
		releases.push(...firstPushes.map((hold) => hold.release));
		await page.getByTestId("agent-toggle-scout").click();
		await Promise.all(firstPushes.map((hold) => hold.held));
		const secondPushes = [
			channelHold.arm("settings.changed"),
			peerChannelHold.arm("settings.changed"),
		];
		releases.push(...secondPushes.map((hold) => hold.release));
		await peer.getByTestId("agent-toggle-worker").click();
		await Promise.all(secondPushes.map((hold) => hold.held));
		for (const client of [page, peer]) {
			for (const name of ["scout", "worker"]) {
				await expect(client.getByTestId(`agent-toggle-${name}`)).toHaveAttribute(
					"data-active",
					"true",
				);
			}
		}
		for (const hold of firstPushes) hold.release();
		for (const client of [page, peer]) {
			await expect(client.getByTestId("agent-toggle-scout")).toHaveAttribute(
				"data-active",
				"false",
			);
		}
		for (const hold of secondPushes) hold.release();
		for (const client of [page, peer]) {
			for (const name of ["scout", "worker"]) {
				await expect(client.getByTestId(`agent-toggle-${name}`)).toHaveAttribute(
					"data-active",
					"false",
				);
			}
		}
	} finally {
		for (const release of releases) release();
		try {
			if (!page.isClosed()) {
				for (const [name, active] of baseline) {
					const toggle = page.getByTestId(`agent-toggle-${name}`);
					if ((await toggle.getAttribute("data-active")) !== active) {
						await toggle.click();
						await expect(toggle).toHaveAttribute("data-active", active ?? "true");
					}
				}
			}
		} finally {
			await peer?.close();
		}
	}
});

test("agent availability controls are inaccessible while disconnected and return after reconnect", async ({
	page,
}) => {
	let offline = false;
	let disconnect = async () => {};
	await page.routeWebSocket(/\/ws(\?|$)/, (browser) => {
		if (offline) {
			void browser.close({ code: 1012, reason: "Offline availability probe" });
			return;
		}
		const server = browser.connectToServer();
		disconnect = () => browser.close({ code: 1012, reason: "Offline availability probe" });
		browser.onMessage((message) => server.send(message));
		server.onMessage((message) => browser.send(message));
	});
	try {
		await openFixtureProject(page);
		await openSubagentSettings(page);
		const toggle = page.getByTestId("agent-toggle-scout");
		const refresh = page.getByTestId("agents-refresh");
		await expect(toggle).toBeEnabled();
		await expect(refresh).toBeEnabled();
		offline = true;
		await disconnect();
		await expect(page.getByTestId("connection-status")).not.toHaveAttribute(
			"data-status",
			"connected",
		);
		await expect(toggle).toHaveCount(0);
		await expect(refresh).toHaveCount(0);
		await expect(page.getByTestId("settings-nav-subagents")).toHaveCount(0);
	} finally {
		offline = false;
	}
	await expect(page.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");
	await expect(page.getByTestId("settings-subagents")).toBeVisible();
	await expect(page.getByTestId("agent-toggle-scout")).toBeEnabled();
	await expect(page.getByTestId("agents-refresh")).toBeEnabled();
});

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
	await openSubagentSettings(page);
	const heading = page.getByTestId("subagents-workspace-heading");
	await expect(heading).toContainText(longName);
	for (const element of [heading, page.getByTestId("settings-subagents")]) {
		expect(await element.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
	}
});

test("without a workspace only the global settings show, with a line about workspace overrides", async ({
	page,
}) => {
	await openFixtureProject(page);
	await openSubagentSettings(page);
	const current = controls(page);
	await expect(current.global).toBeVisible();
	await expect(current.globalLimit).toBeVisible();
	await expect(page.getByTestId("subagents-workspace-heading")).toHaveCount(0);
	await expect(page.getByTestId("subagents-workspace-hint")).toHaveText(
		"Workspace overrides appear when a workspace is open.",
	);
	await closeSettings(page);
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
		await openSubagentSettings(page);
		await openSubagentSettings(peer);
		const source = controls(page);
		const observer = controls(peer);
		await expect(source.global).toHaveAttribute("data-active", "true");
		await expect(source.useGlobal).toHaveAttribute("aria-selected", "true");
		await expect(source.overrideRow).not.toHaveAttribute("data-changed");
		await expect(source.overrideRow).toContainText("now on");

		const globalFrame = channelHold.arm("settings.changed");
		releaseGlobal = globalFrame.release;
		await source.global.click();
		await globalFrame.held;
		await expect(source.global).toHaveAttribute("data-active", "true");
		await expect(observer.global).toHaveAttribute("data-active", "false");
		releaseGlobal();
		await expect(source.global).toHaveAttribute("data-active", "false");
		await expect(source.useGlobal).toHaveAttribute("aria-selected", "true");
		await expect(source.overrideRow).toContainText("now off");

		const workspaceFrame = channelHold.arm("workspace.updated");
		releaseWorkspace = workspaceFrame.release;
		await source.on.click();
		await workspaceFrame.held;
		await expect(source.useGlobal).toHaveAttribute("aria-selected", "true");
		await expect(observer.on).toHaveAttribute("aria-selected", "true");
		await expect(observer.overrideRow).toHaveAttribute("data-changed", "true");
		releaseWorkspace();
		await expect(source.on).toHaveAttribute("aria-selected", "true");
		await expect(source.overrideRow).toHaveAttribute("data-changed", "true");

		await source.global.click();
		await source.off.click();
		for (const current of [source, observer]) {
			await expect(current.global).toHaveAttribute("data-active", "true");
			await expect(current.off).toHaveAttribute("aria-selected", "true");
			await expect(current.overrideRow).toHaveAttribute("data-changed", "true");
			await expect(current.workspaceLimit).toBeDisabled();
		}

		await page.reload();
		await expect(page.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");
		await openSubagentSettings(page);
		await expect(source.global).toHaveAttribute("data-active", "true");
		await expect(source.off).toHaveAttribute("aria-selected", "true");

		await source.resetOverride.click();
		for (const current of [source, observer]) {
			await expect(current.useGlobal).toHaveAttribute("aria-selected", "true");
			await expect(current.overrideRow).not.toHaveAttribute("data-changed");
			await expect(current.workspaceLimit).toBeEnabled();
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
		await openSubagentSettings(page);
		await openSubagentSettings(peer);
		const source = controls(page);
		const observer = controls(peer);

		await expect(source.globalLimit).toHaveValue("4");
		await expect(source.workspaceLimit).toHaveValue("");
		await expect(source.workspaceLimit).toHaveAttribute("placeholder", "4");
		await expect(source.limitRow).not.toHaveAttribute("data-changed");

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
			await expect(current.limitRow).toHaveAttribute("data-changed", "true");
		}

		await observer.resetLimit.click();
		for (const current of [source, observer]) {
			await expect(current.workspaceLimit).toHaveValue("");
			await expect(current.limitRow).not.toHaveAttribute("data-changed");
		}
		await observer.workspaceLimit.fill("2");
		await observer.workspaceLimit.press("Enter");
		await expect(source.workspaceLimit).toHaveValue("2");

		await page.reload();
		await expect(page.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");
		await openSubagentSettings(page);
		await expect(source.globalLimit).toHaveValue("6");
		await expect(source.workspaceLimit).toHaveValue("2");

		await source.workspaceLimit.fill("");
		await source.workspaceLimit.press("Enter");
		for (const current of [source, observer]) {
			await expect(current.workspaceLimit).toHaveValue("");
			await expect(current.limitRow).not.toHaveAttribute("data-changed");
		}
	} finally {
		await restoreSubagentBaseline(page).catch(() => {});
		await peer?.close();
	}
});
