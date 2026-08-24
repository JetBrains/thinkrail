import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type Locator, type Page, test } from "@playwright/test";
import {
	defaultWorkspaceRow,
	enterDefaultWorkspace,
	openFixtureProject,
	pressPlatformShortcut,
	revealFirstProjectWorkspaces,
	runInTerminal,
	visibleTerminal,
	visibleTerminalScreen,
	waitTerminalReady,
} from "./fixtures/app";
import { E2E_DATA_DIR } from "./fixtures/paths";

async function openDefaultWorkbench(page: Page): Promise<void> {
	await openFixtureProject(page);
	await enterDefaultWorkspace(page);
	await waitTerminalReady(page);
	await expect(page.getByTestId("workspace-workbench")).toHaveAttribute(
		"data-layout-status",
		"settled",
	);
}

async function reloadDefaultWorkbench(page: Page): Promise<void> {
	await page.reload();
	await expect(page.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");
	await expect(page.getByTestId("center-tabs")).toBeVisible();
}

async function waitForLayoutSettled(page: Page): Promise<void> {
	await expect(page.getByTestId("workspace-workbench")).toHaveAttribute(
		"data-layout-status",
		"settled",
	);
}

async function size(locator: Locator, axis: "height" | "width"): Promise<number> {
	const box = await locator.boundingBox();
	if (!box) throw new Error("element has no bounding box");
	return box[axis];
}

async function expectBottomSpan(page: Page, start: Locator, end: Locator): Promise<void> {
	await expect
		.poll(async () => {
			const [bottomBox, startBox, endBox] = await Promise.all([
				page.getByTestId("bottom-panel").boundingBox(),
				start.boundingBox(),
				end.boundingBox(),
			]);
			if (!bottomBox || !startBox || !endBox) return Number.POSITIVE_INFINITY;
			return Math.max(
				Math.abs(bottomBox.x - startBox.x),
				Math.abs(bottomBox.x + bottomBox.width - (endBox.x + endBox.width)),
			);
		})
		.toBeLessThan(4);
}

async function dragHandle(page: Page, handle: Locator, x: number, y: number): Promise<void> {
	const box = await handle.boundingBox();
	if (!box) throw new Error("resize handle has no bounding box");
	await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
	await page.mouse.down();
	await page.mouse.move(x, y, { steps: 12 });
	await page.mouse.up();
}

function bottomGroups(page: Page): Locator {
	return page.getByTestId("bottom-group");
}

async function setBottomAlignment(page: Page, name: string): Promise<void> {
	await page.getByRole("button", { name: "Bottom panel alignment" }).click();
	await page.getByRole("menuitemradio", { name, exact: true }).click();
}

async function requestOverWire<T>(
	page: Page,
	method: string,
	params: Record<string, unknown>,
): Promise<T> {
	return page.evaluate(
		async ({ requestMethod, requestParams }) => {
			const protocol = location.protocol === "https:" ? "wss:" : "ws:";
			const socket = new WebSocket(`${protocol}//${location.host}/ws`);
			await new Promise<void>((resolve) => {
				socket.onopen = () => resolve();
			});
			const id = `bottom_${Math.random()}`;
			const result = await new Promise<unknown>((resolve, reject) => {
				socket.addEventListener("message", (event: MessageEvent<string>) => {
					const message = JSON.parse(event.data) as {
						id?: string;
						result?: unknown;
						error?: { message?: string };
					};
					if (message.id !== id) return;
					if (message.error) reject(new Error(message.error.message ?? "request failed"));
					else resolve(message.result);
				});
				socket.send(JSON.stringify({ id, method: requestMethod, params: requestParams }));
			});
			socket.close();
			return result;
		},
		{ requestMethod: method, requestParams: params },
	) as Promise<T>;
}

async function createWorkspaceWithoutOpening(page: Page): Promise<{ id: string; name: string }> {
	return page.evaluate(async () => {
		const protocol = location.protocol === "https:" ? "wss:" : "ws:";
		const socket = new WebSocket(`${protocol}//${location.host}/ws`);
		await new Promise<void>((resolve) => {
			socket.onopen = () => resolve();
		});
		const request = <T>(method: string, params: unknown) =>
			new Promise<T>((resolve, reject) => {
				const id = `bottom_${Math.random()}`;
				const listener = (event: MessageEvent<string>) => {
					const message = JSON.parse(event.data) as {
						id?: string;
						result?: T;
						error?: { message?: string };
					};
					if (message.id !== id) return;
					socket.removeEventListener("message", listener);
					if (message.error) reject(new Error(message.error.message ?? "request failed"));
					else resolve(message.result as T);
				};
				socket.addEventListener("message", listener);
				socket.send(JSON.stringify({ id, method, params }));
			});
		const projects = await request<{ id: string }[]>("project.list", {});
		const project = projects[0];
		if (!project) throw new Error("fixture project is not open");
		const workspace = await request<{ id: string; name: string }>("workspace.create", {
			projectId: project.id,
			name: `legacy-layout-${Date.now()}`,
		});
		socket.close();
		return workspace;
	});
}

test("a new workspace starts with one accessible terminal group in a 30% bottom panel", async ({
	page,
}) => {
	await openDefaultWorkbench(page);

	const workbench = page.getByTestId("workbench");
	const bottom = page.getByTestId("bottom-panel");
	await expect(page.getByTestId("bottom-aligned-row")).toHaveAttribute("data-alignment", "center");
	await expect(bottomGroups(page)).toHaveCount(1);
	await expect(bottomGroups(page).getByTestId("terminal-tab")).toHaveCount(1);
	await expect(bottom.getByRole("tablist")).toHaveCount(1);
	const terminalTab = bottom.getByRole("tab", { name: /Terminal 1/ });
	await expect(terminalTab).toHaveAttribute("aria-selected", "true");
	const terminalTabId = await terminalTab.getAttribute("id");
	if (!terminalTabId) throw new Error("bottom terminal tab has no id");
	await expect(bottom.getByRole("tabpanel")).toHaveAttribute("aria-labelledby", terminalTabId);
	await expect(page.getByTestId("resize-bottom")).toHaveAttribute("role", "separator");
	await expect(page.getByTestId("resize-bottom")).toHaveAttribute("aria-orientation", "horizontal");
	await expect
		.poll(async () => (await size(bottom, "height")) / (await size(workbench, "height")))
		.toBeCloseTo(0.3, 1);

	await page.getByTestId("tab-changes").getByRole("tab").focus();
	await page.keyboard.press("Control+F6");
	await expect(bottom.getByRole("tab", { name: /Terminal 1/ })).toBeFocused();
	await page.keyboard.press("Control+Shift+F6");
	await expect(page.getByTestId("tab-changes").getByRole("tab")).toBeFocused();
});

test("Mod+Shift+J works from xterm, preserves its PTY through hide and reload, and is modal-aware", async ({
	page,
}) => {
	await openDefaultWorkbench(page);
	const marker = "bottom-panel-running-marker";
	await runInTerminal(page, `printf '${marker}\\n'`);
	await expect(visibleTerminalScreen(page)).toContainText(marker);

	await visibleTerminal(page).locator(".xterm-helper-textarea").focus();
	await pressPlatformShortcut(page, "Shift+j");
	await expect(page.getByTestId("bottom-layout-rail")).toBeVisible();
	await expect(page.getByTestId("terminal-instance")).toHaveCount(0);

	await reloadDefaultWorkbench(page);
	await expect(page.getByTestId("bottom-layout-rail")).toBeVisible();
	await pressPlatformShortcut(page, "Shift+j");
	await waitTerminalReady(page);
	await expect(visibleTerminalScreen(page)).toContainText(marker);

	await page.getByTestId("open-settings").click();
	await expect(page.getByRole("dialog")).toBeVisible();
	await pressPlatformShortcut(page, "Shift+j");
	await expect(page.getByTestId("bottom-panel")).toBeVisible();
	await page.getByRole("dialog").getByRole("button", { name: "Close" }).click();
	await pressPlatformShortcut(page, "Shift+j");
	await expect(page.getByTestId("bottom-layout-rail")).toBeVisible();
});

test("bottom height, all alignments, and keyboard resizing persist across reload", async ({
	page,
}) => {
	await openDefaultWorkbench(page);
	const bottom = page.getByTestId("bottom-panel");
	const center = page.getByTestId("center-tabs");
	const left = page.getByTestId("left-stack");
	const right = page.getByTestId("right-stack");
	await expectBottomSpan(page, center, center);
	const before = await size(bottom, "height");
	const handle = page.getByTestId("resize-bottom");
	const handleBox = await handle.boundingBox();
	if (!handleBox) throw new Error("bottom resize handle has no bounding box");
	await dragHandle(page, handle, handleBox.x, handleBox.y - 90);
	await expect.poll(() => size(bottom, "height")).toBeGreaterThan(before + 55);
	const resized = await size(bottom, "height");

	await setBottomAlignment(page, "Below center and left");
	await expect(page.getByTestId("bottom-aligned-row")).toHaveAttribute(
		"data-alignment",
		"center-left",
	);
	await expectBottomSpan(page, left, center);
	await setBottomAlignment(page, "Below center and right");
	await expect(page.getByTestId("bottom-aligned-row")).toHaveAttribute(
		"data-alignment",
		"center-right",
	);
	await expectBottomSpan(page, center, right);
	await setBottomAlignment(page, "Full width");
	await expect(page.getByTestId("bottom-aligned-row")).toHaveAttribute("data-alignment", "full");
	await expectBottomSpan(page, left, right);
	await setBottomAlignment(page, "Below center and left");

	await reloadDefaultWorkbench(page);
	await expect(page.getByTestId("bottom-aligned-row")).toHaveAttribute(
		"data-alignment",
		"center-left",
	);
	await expect
		.poll(async () => Math.abs((await size(page.getByTestId("bottom-panel"), "height")) - resized))
		.toBeLessThan(24);

	const persistedHandle = page.getByTestId("resize-bottom");
	const keyboardBefore = await size(page.getByTestId("bottom-panel"), "height");
	await persistedHandle.focus();
	await page.keyboard.press("ArrowUp");
	await expect
		.poll(() => size(page.getByTestId("bottom-panel"), "height"))
		.toBeGreaterThan(keyboardBefore);
});

test("bottom groups arrange left-to-right, resize, fold to 27px, restore, and enforce their own limit", async ({
	page,
}) => {
	await openDefaultWorkbench(page);
	await page.getByTestId("tab-changes").click({ button: "right" });
	await page.getByRole("menuitem", { name: "New bottom group at right", exact: true }).click();
	await expect(bottomGroups(page)).toHaveCount(2);
	await expect(bottomGroups(page).nth(0)).toContainText("Terminal 1");
	await expect(bottomGroups(page).nth(1)).toContainText("Changes");

	const first = bottomGroups(page).nth(0);
	const firstBefore = await size(first, "width");
	const groupHandle = page.getByTestId("bottom-group-resize");
	await expect(groupHandle).toHaveAttribute("aria-orientation", "vertical");
	const groupHandleBox = await groupHandle.boundingBox();
	if (!groupHandleBox) throw new Error("bottom group resize handle has no bounding box");
	await dragHandle(page, groupHandle, groupHandleBox.x + 90, groupHandleBox.y);
	await expect.poll(() => size(first, "width")).toBeGreaterThan(firstBefore + 50);

	await first.getByTestId("bottom-group-fold").click();
	await expect(first).toHaveAttribute("data-folded", "true");
	expect(await size(first, "width")).toBeCloseTo(27, 0);
	await expect(page.getByTestId("terminal-instance")).toHaveCount(0);
	await first.getByTestId("bottom-group-restore").focus();
	await page.keyboard.press("Space");
	await expect(first).toHaveAttribute("data-folded", "false");
	await waitTerminalReady(page);

	await page.getByTestId("tab-files").click({ button: "right" });
	await page.getByRole("menuitem", { name: "New bottom group at left", exact: true }).click();
	await expect(bottomGroups(page)).toHaveCount(3);
	await expect(bottomGroups(page).nth(0)).toContainText("All files");
	await page.getByTestId("tab-specs").click({ button: "right" });
	await expect(
		page.getByRole("menuitem", { name: /New bottom group at left — limited to 3/ }),
	).toBeDisabled();
	await expect(
		page.getByRole("menuitem", { name: /New bottom group at right — limited to 3/ }),
	).toBeDisabled();
});

test("a narrow viewport locally compresses bottom groups without rewriting their topology", async ({
	page,
}) => {
	await openDefaultWorkbench(page);
	await page.getByTestId("tab-changes").click({ button: "right" });
	await page.getByRole("menuitem", { name: "New bottom group at right", exact: true }).click();
	await waitForLayoutSettled(page);
	await page.getByTestId("tab-files").click({ button: "right" });
	await page.getByRole("menuitem", { name: "New bottom group at right", exact: true }).click();
	await waitForLayoutSettled(page);
	await expect(bottomGroups(page)).toHaveCount(3);
	const groupIds = await bottomGroups(page).evaluateAll((groups) =>
		groups.map((group) => group.getAttribute("data-group-id")),
	);
	await setBottomAlignment(page, "Full width");
	await waitForLayoutSettled(page);

	await page.setViewportSize({ width: 390, height: 844 });
	await expect(bottomGroups(page)).toHaveCount(3);
	await expect(page.getByTestId("bottom-aligned-row")).toHaveAttribute("data-alignment", "full");
	const rowBox = await page.getByTestId("bottom-aligned-row").boundingBox();
	if (!rowBox) throw new Error("bottom row has no bounding box");
	for (const group of await bottomGroups(page).all()) {
		const groupBox = await group.boundingBox();
		if (!groupBox) throw new Error("bottom group has no bounding box");
		expect(groupBox.width).toBeGreaterThan(0);
		expect(groupBox.x).toBeGreaterThanOrEqual(rowBox.x - 1);
		expect(groupBox.x + groupBox.width).toBeLessThanOrEqual(rowBox.x + rowBox.width + 1);
	}
	expect(
		await bottomGroups(page).evaluateAll((groups) => groups.map((group) => group.dataset.folded)),
	).toEqual(["false", "false", "false"]);
	await expect
		.poll(() =>
			bottomGroups(page).evaluateAll((groups) =>
				groups.map((group) => group.getAttribute("data-group-id")),
			),
		)
		.toEqual(groupIds);

	await reloadDefaultWorkbench(page);
	await expect(bottomGroups(page)).toHaveCount(3);
	await expect(page.getByTestId("bottom-aligned-row")).toHaveAttribute("data-alignment", "full");
	await expect
		.poll(() =>
			bottomGroups(page).evaluateAll((groups) =>
				groups.map((group) => group.getAttribute("data-group-id")),
			),
		)
		.toEqual(groupIds);
});

test("bottom visibility and alignment synchronize across clients while reload keeps the topology", async ({
	page,
	context,
}) => {
	await openDefaultWorkbench(page);
	const peer = await context.newPage();
	await peer.goto("/");
	await expect(peer.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");
	await revealFirstProjectWorkspaces(peer);
	await defaultWorkspaceRow(peer).getByRole("button").first().click();
	await expect(peer.getByTestId("bottom-panel")).toBeVisible();

	await setBottomAlignment(page, "Full width");
	await expect(peer.getByTestId("bottom-aligned-row")).toHaveAttribute("data-alignment", "full");
	await pressPlatformShortcut(page, "Shift+j");
	await expect(page.getByTestId("bottom-layout-rail")).toBeVisible();
	await expect(peer.getByTestId("bottom-layout-rail")).toBeVisible();

	await pressPlatformShortcut(peer, "Shift+j");
	await expect(page.getByTestId("bottom-aligned-row")).toHaveAttribute("data-alignment", "full");
	await expect(peer.getByTestId("bottom-panel")).toBeVisible();
	await peer.reload();
	await expect(peer.getByTestId("bottom-aligned-row")).toHaveAttribute("data-alignment", "full");
	await peer.close();
});

test("a stored version-1 layout migrates with its tools untouched and no terminal process started", async ({
	page,
}) => {
	await openFixtureProject(page);
	const workspace = await createWorkspaceWithoutOpening(page);
	const fileId = /^[A-Za-z0-9_-]+$/.test(workspace.id)
		? workspace.id
		: `~${Buffer.from(workspace.id).toString("base64url")}`;
	const directory = join(E2E_DATA_DIR, "layouts");
	mkdirSync(directory, { recursive: true });
	writeFileSync(
		join(directory, `${fileId}.json`),
		`${JSON.stringify({
			workspaceId: workspace.id,
			revision: 7,
			document: {
				version: 1,
				center: { kind: "group", id: "legacy-center", tabs: [] },
				left: {
					visible: true,
					width: 0.18,
					groups: [
						{
							id: "legacy-left",
							weight: 1,
							folded: false,
							tabs: [
								{
									kind: "tool",
									id: "tool:projects",
									name: "Projects",
									tool: "projects",
								},
							],
						},
					],
				},
				right: {
					visible: true,
					width: 0.28,
					groups: [
						{
							id: "legacy-right-top",
							weight: 0.5,
							folded: false,
							tabs: [
								{ kind: "tool", id: "tool:specs", name: "Specs", tool: "specs" },
								{ kind: "tool", id: "tool:files", name: "All files", tool: "files" },
							],
						},
						{
							id: "legacy-right-bottom",
							weight: 0.5,
							folded: false,
							tabs: [
								{ kind: "tool", id: "tool:changes", name: "Changes", tool: "changes" },
								{ kind: "tool", id: "tool:review", name: "Review", tool: "review" },
							],
						},
					],
				},
				toolRestoreTargets: { changes: { side: "right", index: 1 } },
			},
		})}\n`,
	);
	const migrated = await requestOverWire<{
		revision: number;
		document: { version: number; bottom: { visible: boolean; groups: unknown[] } };
	}>(page, "layout.get", { workspaceId: workspace.id });
	expect(migrated.revision).toBe(7);
	expect(migrated.document.version).toBe(2);
	expect(migrated.document.bottom).toMatchObject({ visible: false, groups: [] });

	const workspaceRow = page.getByTestId("workspace-item").filter({ hasText: workspace.name });
	await expect(workspaceRow).toBeVisible();
	await workspaceRow.getByRole("button").first().click();
	const installed = await requestOverWire<{
		revision: number;
		document: { bottom: { visible: boolean; groups: unknown[] } };
	}>(page, "layout.get", { workspaceId: workspace.id });
	expect(installed.revision).toBeGreaterThanOrEqual(7);
	expect(installed.document.bottom).toMatchObject({ visible: false, groups: [] });
	await expect(page.getByTestId("left-nav")).toContainText("Projects");
	await expect(page.getByTestId("right-stack")).toContainText("Specs");
	await expect(page.getByTestId("right-stack")).toContainText("Changes");
	await expect(page.getByTestId("bottom-layout-rail")).toBeVisible();
	await expect(page.getByTestId("terminal-tab")).toHaveCount(0);
	await expect(page.getByTestId("terminal-instance")).toHaveCount(0);

	await page.getByRole("button", { name: "Show bottom panel" }).click();
	await expect(bottomGroups(page)).toHaveCount(1);
	await waitTerminalReady(page);
	await expect(page.getByTestId("terminal-tab")).toHaveCount(1);
});
