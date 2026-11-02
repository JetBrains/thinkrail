import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import {
	WORKSPACE_ITEM_REVEAL_PROTOCOL_VERSION,
	type WsClientMessage,
	type WsParams,
} from "@thinkrail/contracts";
import { createWorkspaceViaDialog, openFixtureProject, revealWorkbenchTool } from "./fixtures/app";

async function observeRevealWire(
	page: Page,
	options: { hostPlatform?: string; protocolVersion?: number; error?: string } = {},
) {
	const requests: WsParams<"workspace.reveal">[] = [];
	let protocolVersion = options.protocolVersion;
	let holdWelcome = false;
	let heldWelcome: (() => void) | undefined;
	let disconnect: (() => Promise<void>) | undefined;
	await page.routeWebSocket(/\/ws(?:\?|$)/, (browser) => {
		const server = browser.connectToServer();
		disconnect = () => browser.close({ code: 1012, reason: "Reveal reconnect probe" });
		browser.onMessage((message) => {
			const frame = JSON.parse(message.toString()) as WsClientMessage;
			if ("method" in frame && frame.method === "workspace.reveal") {
				requests.push(frame.params as WsParams<"workspace.reveal">);
				browser.send(
					JSON.stringify(
						options.error
							? { id: frame.id, ok: false, error: options.error, errorCode: "FILE_REVEAL_FAILED" }
							: { id: frame.id, ok: true, result: { ok: true } },
					),
				);
				return;
			}
			server.send(message);
		});
		server.onMessage((message) => {
			const frame = JSON.parse(message.toString()) as {
				channel?: string;
				data?: Record<string, unknown>;
			};
			if (frame.channel !== "server.welcome") {
				browser.send(message);
				return;
			}
			const welcome = JSON.stringify({
				...frame,
				data: {
					...frame.data,
					...(options.hostPlatform ? { hostPlatform: options.hostPlatform } : {}),
					...(protocolVersion !== undefined ? { protocolVersion } : {}),
				},
			});
			if (holdWelcome) heldWelcome = () => browser.send(welcome);
			else browser.send(welcome);
		});
	});
	return {
		requests,
		setProtocolVersion: (version: number) => {
			protocolVersion = version;
		},
		disconnect: async () => {
			holdWelcome = true;
			await disconnect?.();
		},
		get reconnectWaiting() {
			return heldWelcome !== undefined;
		},
		resume: () => {
			holdWelcome = false;
			heldWelcome?.();
			heldWelcome = undefined;
		},
	};
}

async function openFiles(page: Page) {
	await openFixtureProject(page);
	const workspace = await createWorkspaceViaDialog(page);
	const chat = page.locator('[data-testid="editor-tab"][data-kind="chat"]');
	await chat.hover();
	await chat.getByTestId("editor-tab-close").click();
	await expect(chat).toHaveCount(0);
	await revealWorkbenchTool(page, "files");
	await expect(page.getByTestId("file-node").filter({ hasText: "README.md" })).toBeVisible();
	return workspace;
}

test("Files reveal targets the clicked file, folder and deepest compact folder without opening them", async ({
	page,
}) => {
	const wire = await observeRevealWire(page);
	const workspace = await openFiles(page);
	mkdirSync(join(workspace.worktreePath, "compact", "only", "here"), { recursive: true });
	writeFileSync(join(workspace.worktreePath, "compact", "only", "here", "leaf.txt"), "leaf\n");
	const targets = [
		{ label: /README\.md/, path: "README.md" },
		{ label: /^styles$/, path: "styles" },
		{ label: /^compact\/only\/here$/, path: "compact/only/here" },
	];
	for (const target of targets) {
		const row = page.getByTestId("file-node").filter({ hasText: target.label });
		await expect(row).toBeVisible();
		await row.click({ button: "right" });
		await expect(page.getByTestId("file-copy-path")).toBeVisible();
		await expect(page.getByTestId("file-copy-relative-path")).toBeVisible();
		await page.getByTestId("file-reveal").click();
		await expect.poll(() => wire.requests.at(-1)).toEqual({ id: workspace.id, path: target.path });
		await expect(page.getByTestId("editor-tab")).toHaveCount(0);
	}
	await expect(page.getByTestId("file-node").filter({ hasText: "leaf.txt" })).toHaveCount(0);
	await expect(page.getByTestId("file-node").filter({ hasText: "COLOR.md" })).toHaveCount(0);
	expect(wire.requests).toHaveLength(3);
});

test("file-tab reveal preserves active and preview tabs and supports keyboard menus", async ({
	page,
}) => {
	const wire = await observeRevealWire(page);
	const workspace = await openFiles(page);
	await page.getByTestId("file-node").filter({ hasText: "README.md" }).dblclick();
	await page.getByTestId("file-node").filter({ hasText: "notes.txt" }).click();
	const readme = page.getByTestId("editor-tab").filter({ hasText: "README.md" });
	const notes = page.getByTestId("editor-tab").filter({ hasText: "notes.txt" });
	await readme.click({ button: "right" });
	await page.getByTestId("file-reveal").click();
	await expect(readme).toHaveAttribute("data-active", "false");
	await expect(notes).toHaveAttribute("data-active", "true");
	await expect(notes).toHaveAttribute("data-preview", "true");
	await expect.poll(() => wire.requests).toEqual([{ id: workspace.id, path: "README.md" }]);
	await readme.click();
	const notesButton = notes.getByRole("tab");
	for (const key of ["Shift+F10", "ContextMenu"]) {
		await notesButton.focus();
		await page.keyboard.press(key);
		await expect(page.getByTestId("file-reveal")).toBeVisible();
		await page.keyboard.press("Escape");
		await expect(notesButton).toBeFocused();
	}
	await notes.click({ button: "right" });
	await page.getByTestId("file-reveal").click();
	await expect(readme).toHaveAttribute("data-active", "true");
	await expect(notes).toHaveAttribute("data-active", "false");
	await expect(notes).toHaveAttribute("data-preview", "true");
	await expect.poll(() => wire.requests.at(-1)).toEqual({ id: workspace.id, path: "notes.txt" });
});

test("an inactive diff tab reveals its current worktree path", async ({ page }) => {
	const wire = await observeRevealWire(page);
	const workspace = await openFiles(page);
	writeFileSync(join(workspace.worktreePath, "README.md"), "# Changed for reveal\n");
	await page.getByTestId("files-mode-changed").click();
	await page.getByTestId("change-item").filter({ hasText: "README.md" }).dblclick();
	const diff = page.locator('[data-testid="editor-tab"][data-kind="diff"]');
	await expect(diff).toHaveCount(1);
	await page.getByTestId("files-mode-all").click();
	await page.getByTestId("file-node").filter({ hasText: "notes.txt" }).click();
	await expect(diff).toHaveAttribute("data-active", "false");
	await diff.click({ button: "right" });
	await page.getByTestId("file-reveal").click();
	await expect.poll(() => wire.requests).toEqual([{ id: workspace.id, path: "README.md" }]);
	await expect(diff).toHaveAttribute("data-active", "false");
	await expect(page.getByTestId("editor-tab").filter({ hasText: "notes.txt" })).toHaveAttribute(
		"data-active",
		"true",
	);
});

test("tree keyboard menus restore focus without opening a file", async ({ page }) => {
	const wire = await observeRevealWire(page);
	await openFiles(page);
	const row = page.getByTestId("file-node").filter({ hasText: "README.md" });
	for (const key of ["Shift+F10", "ContextMenu"]) {
		await row.focus();
		await page.keyboard.press(key);
		await expect(page.getByTestId("file-reveal")).toBeVisible();
		await page.keyboard.press("Escape");
		await expect(row).toBeFocused();
	}
	await expect(page.getByTestId("editor-tab")).toHaveCount(0);
	expect(wire.requests).toHaveLength(0);
});

test("chat tabs omit file reveal", async ({ page }) => {
	await observeRevealWire(page);
	await openFixtureProject(page);
	await createWorkspaceViaDialog(page);
	await page.locator('[data-testid="editor-tab"][data-kind="chat"]').click({ button: "right" });
	await expect(page.getByRole("menuitem", { name: "Focus tab" })).toBeVisible();
	await expect(page.getByTestId("file-reveal")).toHaveCount(0);
});

for (const [hostPlatform, label] of [
	["darwin", "Reveal in Finder"],
	["win32", "Show in Explorer"],
	["linux", "Reveal in file manager"],
] as const) {
	test(`reveal uses the ${hostPlatform} host label`, async ({ page }) => {
		await observeRevealWire(page, { hostPlatform });
		await openFiles(page);
		await page.getByTestId("file-node").filter({ hasText: "README.md" }).click({ button: "right" });
		await expect(page.getByTestId("file-reveal")).toHaveText(label);
	});
}

test("old hosts and disconnected menus cannot queue reveal for reconnect", async ({ page }) => {
	const wire = await observeRevealWire(page, {
		protocolVersion: WORKSPACE_ITEM_REVEAL_PROTOCOL_VERSION - 1,
	});
	await openFiles(page);
	const row = page.getByTestId("file-node").filter({ hasText: "README.md" });
	await row.click({ button: "right" });
	await expect(page.getByTestId("file-reveal")).toHaveAttribute("aria-disabled", "true");
	await page.keyboard.press("Escape");
	wire.setProtocolVersion(WORKSPACE_ITEM_REVEAL_PROTOCOL_VERSION);
	await page.reload();
	await row.click({ button: "right" });
	await expect(page.getByTestId("file-reveal")).not.toHaveAttribute("aria-disabled", "true");
	await wire.disconnect();
	await expect(page.getByTestId("file-reveal")).toHaveAttribute("aria-disabled", "true");
	await page.getByTestId("file-reveal").click({ force: true });
	await expect.poll(() => wire.reconnectWaiting).toBe(true);
	wire.resume();
	await expect(page.getByTestId("file-reveal")).not.toHaveAttribute("aria-disabled", "true");
	expect(wire.requests).toHaveLength(0);
});

test("a reveal rejection reports one error without opening or activating a file", async ({
	page,
}) => {
	const error = "The selected item no longer exists";
	const wire = await observeRevealWire(page, { error });
	await openFiles(page);
	await page.getByTestId("file-node").filter({ hasText: "README.md" }).click({ button: "right" });
	await page.getByTestId("file-reveal").click();
	await expect(page.getByText(error, { exact: true })).toHaveCount(1);
	await expect(page.getByTestId("editor-tab")).toHaveCount(0);
	expect(wire.requests).toHaveLength(1);
});
