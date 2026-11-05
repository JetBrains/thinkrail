import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import {
	createWorkspaceViaDialog,
	enterDefaultWorkspace,
	openFixtureProject,
	revealWorkbenchTool,
} from "./fixtures/app";
import { E2E_DATA_DIR } from "./fixtures/paths";

const PAST_SETTLE_WINDOW_MS = 300;

async function setPreviewTabs(page: import("@playwright/test").Page, enabled: boolean) {
	await page.getByTestId("open-settings").click();
	await page.getByTestId("settings-nav-layout").click();
	const toggle = page.getByTestId("layout-preview-tabs");
	await expect(toggle).toHaveAttribute("aria-checked", String(!enabled));
	await toggle.click();
	await expect(toggle).toHaveAttribute("aria-checked", String(enabled));
	await page.keyboard.press("Escape");
}

test("preview tabs can be disabled for files, specs, and changes and persist across reload", async ({
	page,
}) => {
	await page.setViewportSize({ width: 1440, height: 1000 });
	await openWorkspaceFiles(page);
	await setPreviewTabs(page, false);
	const tabs = page.locator('[data-testid="editor-tab"]:not([data-kind="chat"])');
	await page.getByTestId("file-node").filter({ hasText: "README.md" }).click();
	await page.getByTestId("file-node").filter({ hasText: "notes.txt" }).click();
	await expect(tabs).toHaveCount(2);
	await expect(page.locator('[data-testid="editor-tab"][data-preview="true"]')).toHaveCount(0);
	await page.screenshot({ path: test.info().outputPath("preview-tabs-disabled.png") });

	await revealWorkbenchTool(page, "specs");
	await page.locator('[data-testid="spec-node"][data-spec-id="sample-root"]').click();
	await expect(tabs).toHaveCount(3);
	await expect(page.locator('[data-testid="editor-tab"][data-preview="true"]')).toHaveCount(0);

	writeFileSync(
		join(E2E_DATA_DIR, "worktrees", "sample-project", "workspace-1", "README.md"),
		"# sample-project\n\npreview preference change\n",
	);
	await revealWorkbenchTool(page, "changes");
	await page.getByTestId("change-item").filter({ hasText: "README.md" }).click();
	await expect(tabs).toHaveCount(4);
	await expect(page.locator('[data-testid="editor-tab"][data-kind="changes"]')).toHaveAttribute(
		"data-preview",
		"false",
	);

	await page.reload();
	await expect(tabs).toHaveCount(4);
	await setPreviewTabs(page, true);
	await revealWorkbenchTool(page, "files");
	await page.getByTestId("file-node").filter({ hasText: "LINKS.md" }).click();
	await expect(tabs).toHaveCount(5);
	await expect(tabs.last()).toHaveAttribute("data-preview", "true");
	await page.getByTestId("file-node").filter({ hasText: "ALERTS.md" }).click();
	await expect(tabs).toHaveCount(5);
	await expect(tabs.last()).toContainText("ALERTS.md");
	await expect(tabs.last()).toHaveAttribute("data-preview", "true");
});

async function freezePageTimers(page: import("@playwright/test").Page): Promise<void> {
	await page.clock.pauseAt(Date.now() + 1_000);
}

async function openWorkspaceFiles(page: import("@playwright/test").Page): Promise<void> {
	await openFixtureProject(page);
	await createWorkspaceViaDialog(page);
	const chatTab = page.locator('[data-testid="editor-tab"][data-kind="chat"]');
	await chatTab.hover();
	await chatTab.getByTestId("editor-tab-close").click();
	await expect(chatTab).toHaveCount(0);
	await revealWorkbenchTool(page, "files");
	await expect(page.getByTestId("file-node").first()).toBeVisible();
}

test("a single click previews into one reusable slot, a double click keeps the tab", async ({
	page,
}) => {
	await openWorkspaceFiles(page);

	const tabs = page.getByTestId("editor-tab");
	const readme = page.getByTestId("file-node").filter({ hasText: "README.md" });
	const notes = page.getByTestId("file-node").filter({ hasText: "notes.txt" });
	await expect(readme).toBeVisible();

	await readme.click();
	await expect(tabs).toHaveCount(1);
	await expect(tabs.first()).toHaveAttribute("data-preview", "true");
	await expect(tabs.first().getByText("README.md")).toHaveCSS("font-style", "italic");

	await notes.click();
	await expect(tabs).toHaveCount(1);
	await expect(tabs.first()).toContainText("notes.txt");
	await expect(tabs.first()).toHaveAttribute("data-preview", "true");

	await notes.dblclick();
	await expect(tabs).toHaveCount(1);
	await expect(tabs.first()).toHaveAttribute("data-preview", "false");
	await expect(tabs.first().getByText("notes.txt")).toHaveCSS("font-style", "normal");

	await readme.click();
	await expect(tabs).toHaveCount(2);
	await expect(tabs.nth(1)).toHaveAttribute("data-preview", "true");

	await tabs.nth(1).getByText("README.md").click();
	await expect(tabs.nth(1)).toHaveAttribute("data-preview", "false");
	await expect(tabs).toHaveCount(2);

	await notes.click();
	await expect(tabs).toHaveCount(2);
	await expect(tabs.first()).toHaveAttribute("data-preview", "false");
	await expect(tabs.first()).toHaveAttribute("data-active", "true");
});

test("Enter and Space on a file row open its preview", async ({ page }) => {
	await openWorkspaceFiles(page);
	const tabs = page.getByTestId("editor-tab");

	await page.getByTestId("file-node").filter({ hasText: "README.md" }).focus();
	await page.keyboard.press("Enter");
	await expect(tabs).toHaveCount(1);
	await expect(tabs.first()).toContainText("README.md");
	await expect(tabs.first()).toHaveAttribute("data-preview", "true");
	await expect(tabs.first()).toHaveAttribute("data-active", "true");

	await page.getByTestId("file-node").filter({ hasText: "notes.txt" }).focus();
	await page.keyboard.press("Space");
	await expect(tabs).toHaveCount(1);
	await expect(tabs.first()).toContainText("notes.txt");
	await expect(tabs.first()).toHaveAttribute("data-preview", "true");
});

test("a double click claims the slot on its way to keeping the tab, at any latency", async ({
	page,
}) => {
	await openWorkspaceFiles(page);
	const tabs = page.getByTestId("editor-tab");

	await page.getByTestId("file-node").filter({ hasText: "README.md" }).dblclick();
	await page.getByTestId("file-node").filter({ hasText: "notes.txt" }).click();
	await expect(tabs).toHaveCount(2);
	await expect(tabs.nth(1)).toHaveAttribute("data-preview", "true");

	await page.getByTestId("file-node").filter({ hasText: "LINKS.md" }).dblclick();
	await expect(tabs).toHaveCount(2);
	await expect(tabs.first()).toContainText("README.md");
	await expect(tabs.nth(1)).toContainText("LINKS.md");
	await expect(tabs.nth(1)).toHaveAttribute("data-preview", "false");
});

test("a double click on an unopened file sends exactly one fs.readFile", async ({ page }) => {
	const reads: string[] = [];
	page.on("websocket", (ws) =>
		ws.on("framesent", ({ payload }) => {
			const frame = typeof payload === "string" ? payload : payload.toString();
			if (frame.includes('"method":"fs.readFile"')) reads.push(frame);
		}),
	);

	await openWorkspaceFiles(page);
	await page.getByTestId("file-node").filter({ hasText: "README.md" }).dblclick();
	await expect(page.getByTestId("editor-tab")).toHaveCount(1);
	await expect(page.getByTestId("editor-tab")).toHaveAttribute("data-preview", "false");

	expect(reads.filter((frame) => frame.includes("README.md"))).toHaveLength(1);
});

function frameId(raw: string): unknown {
	try {
		return (JSON.parse(raw) as { id?: unknown }).id;
	} catch {
		return undefined;
	}
}

async function holdFileReads(page: import("@playwright/test").Page, path: string) {
	const held: { id: unknown; send: () => void }[] = [];
	const released = new Set<unknown>();
	let answered = 0;
	await page.routeWebSocket(/\/ws(\?|$)/, (ws) => {
		const server = ws.connectToServer();
		ws.onMessage((message) => {
			const raw = typeof message === "string" ? message : message.toString();
			if (raw.includes('"method":"fs.readFile"') && raw.includes(path)) {
				held.push({ id: frameId(raw), send: () => server.send(message) });
				return;
			}
			server.send(message);
		});
		server.onMessage((message) => {
			ws.send(message);
			const raw = typeof message === "string" ? message : message.toString();
			if (released.has(frameId(raw))) answered += 1;
		});
	});
	return {
		heldCount: () => held.length,
		answeredCount: () => answered,
		release: () => {
			for (const read of held.splice(0)) {
				released.add(read.id);
				read.send();
			}
		},
	};
}

test("a file read finishing after preview tabs are disabled opens a kept tab", async ({ page }) => {
	const reads = await holdFileReads(page, "notes.txt");
	await openWorkspaceFiles(page);
	await page.getByTestId("file-node").filter({ hasText: "README.md" }).dblclick();
	await page.getByTestId("file-node").filter({ hasText: "notes.txt" }).click();
	await expect.poll(reads.heldCount).toBe(1);
	await setPreviewTabs(page, false);
	reads.release();
	await expect(page.getByTestId("editor-tab")).toHaveCount(2);
	await expect(page.locator('[data-testid="editor-tab"][data-preview="true"]')).toHaveCount(0);
});

test("disabled previews keep a slower earlier file without stealing the newer file's focus", async ({
	page,
}) => {
	const reads = await holdFileReads(page, "notes.txt");
	await openWorkspaceFiles(page);
	await setPreviewTabs(page, false);
	await page.getByTestId("file-node").filter({ hasText: "notes.txt" }).click();
	await expect.poll(reads.heldCount).toBe(1);
	await page.getByTestId("file-node").filter({ hasText: "README.md" }).click();
	const tabs = page.locator('[data-testid="editor-tab"]:not([data-kind="chat"])');
	await expect(tabs).toHaveCount(1);
	await expect(tabs.first()).toContainText("README.md");
	reads.release();
	await expect(tabs).toHaveCount(2);
	await expect(tabs.filter({ hasText: "README.md" })).toHaveAttribute("data-active", "true");
	await expect(page.locator('[data-testid="editor-tab"][data-preview="true"]')).toHaveCount(0);
});

async function nextFrames(page: import("@playwright/test").Page): Promise<void> {
	await page.evaluate(
		() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
	);
}

test("a browse the user has navigated away from is dropped, not activated on arrival", async ({
	page,
}) => {
	const reads = await holdFileReads(page, "notes.txt");
	await openWorkspaceFiles(page);
	const tabs = page.getByTestId("editor-tab");

	await page.getByTestId("file-node").filter({ hasText: "README.md" }).dblclick();
	await expect(tabs).toHaveCount(1);
	await expect(tabs.first()).toHaveAttribute("data-preview", "false");

	await page.getByTestId("file-node").filter({ hasText: "notes.txt" }).click();
	await expect.poll(reads.heldCount).toBe(1);
	await tabs.first().getByText("README.md").click();
	reads.release();
	await expect.poll(reads.answeredCount).toBe(1);
	await nextFrames(page);

	await expect(tabs).toHaveCount(1);
	await expect(tabs.first()).toContainText("README.md");
	await expect(tabs.first()).toHaveAttribute("data-active", "true");
	await expect(page.getByTestId("editor-tab").filter({ hasText: "notes.txt" })).toHaveCount(0);
});

test("of two browse clicks in flight at once, the later one wins", async ({ page }) => {
	await openWorkspaceFiles(page);
	const tabs = page.getByTestId("editor-tab");

	await page.evaluate(() => {
		const row = (text: string): HTMLElement => {
			const hit = [...document.querySelectorAll('[data-testid="file-node"]')].find((el) =>
				el.textContent?.includes(text),
			);
			if (!hit) throw new Error(`no file-node containing ${text}`);
			return hit as HTMLElement;
		};
		row("README.md").click();
		row("notes.txt").click();
	});

	await expect(tabs).toHaveCount(1);
	await expect(tabs.first()).toContainText("notes.txt");
	await expect(tabs.first()).toHaveAttribute("data-preview", "true");
	await expect(page.getByTestId("editor-tab").filter({ hasText: "README.md" })).toHaveCount(0);
});

test("a keep that lands first does not invalidate a browse requested after it", async ({
	page,
}) => {
	await openWorkspaceFiles(page);
	const tabs = page.getByTestId("editor-tab");

	await page.evaluate(() => {
		const row = (text: string): HTMLElement => {
			const hit = [...document.querySelectorAll('[data-testid="file-node"]')].find((el) =>
				el.textContent?.includes(text),
			);
			if (!hit) throw new Error(`no file-node containing ${text}`);
			return hit as HTMLElement;
		};
		row("README.md").click();
		row("README.md").click();
		row("README.md").dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
		row("notes.txt").click();
	});

	await expect(tabs).toHaveCount(2);
	await expect(tabs.first()).toContainText("README.md");
	await expect(tabs.first()).toHaveAttribute("data-preview", "false");
	await expect(tabs.nth(1)).toContainText("notes.txt");
	await expect(tabs.nth(1)).toHaveAttribute("data-preview", "true");
});

test("a single click on an open file selects it without a settle wait", async ({ page }) => {
	await page.clock.install();
	await openWorkspaceFiles(page);
	const tabs = page.getByTestId("editor-tab");
	const readme = page.getByTestId("file-node").filter({ hasText: "README.md" });
	const notes = page.getByTestId("file-node").filter({ hasText: "notes.txt" });

	await readme.dblclick();
	await notes.click();
	await expect(tabs.filter({ hasText: "notes.txt" })).toHaveAttribute("data-active", "true");
	await freezePageTimers(page);
	await readme.click();
	await expect(tabs.filter({ hasText: "README.md" })).toHaveAttribute("data-active", "true");
});

test("a double click after a landed preview keeps that same tab", async ({ page }) => {
	await openWorkspaceFiles(page);
	const tabs = page.getByTestId("editor-tab");
	const notes = page.getByTestId("file-node").filter({ hasText: "notes.txt" });

	await notes.click();
	await expect(tabs.first().getByText("notes.txt")).toHaveCSS("font-style", "italic");
	const tabButton = tabs.first().locator("[data-layout-tab-id]");
	const previewId = await tabButton.getAttribute("data-layout-tab-id");
	await notes.dblclick();
	await expect(tabs).toHaveCount(1);
	await expect(tabs.first()).toHaveAttribute("data-preview", "false");
	await expect(tabButton).toHaveAttribute("data-layout-tab-id", previewId ?? "");
});

test("clicking an inactive preview tab selects it at once without keeping it", async ({ page }) => {
	await page.clock.install();
	await openWorkspaceFiles(page);
	const tabs = page.getByTestId("editor-tab");
	await page.getByTestId("file-node").filter({ hasText: "notes.txt" }).dblclick();
	await page.getByTestId("file-node").filter({ hasText: "README.md" }).click();
	const notesTab = tabs.filter({ hasText: "notes.txt" });
	const readmeTab = tabs.filter({ hasText: "README.md" });
	await expect(readmeTab).toHaveAttribute("data-preview", "true");

	await notesTab.click();
	await expect(notesTab).toHaveAttribute("data-active", "true");
	await freezePageTimers(page);
	await readmeTab.click();
	await expect(readmeTab).toHaveAttribute("data-active", "true");
	await page.clock.runFor(PAST_SETTLE_WINDOW_MS);
	await expect(readmeTab).toHaveAttribute("data-preview", "true");
});

test("a newer tab click cancels an older preview-tab settle timer", async ({ page }) => {
	await page.clock.install();
	await openFixtureProject(page);
	await enterDefaultWorkspace(page);
	await revealWorkbenchTool(page, "files");
	await page.getByTestId("file-node").filter({ hasText: "notes.txt" }).dblclick();
	await page.getByTestId("file-node").filter({ hasText: "README.md" }).click();

	const notes = page.getByTestId("editor-tab").filter({ hasText: "notes.txt" });
	const readme = page.getByTestId("editor-tab").filter({ hasText: "README.md" });
	await expect(readme).toHaveAttribute("data-preview", "true");
	await freezePageTimers(page);
	await readme.click();
	await notes.click();
	await page.clock.runFor(PAST_SETTLE_WINDOW_MS);

	await expect(notes).toHaveAttribute("data-active", "true");
	await expect(readme).toHaveAttribute("data-preview", "true");
});

test("the Specs panel shares the one slot, and closing the preview tab releases it", async ({
	page,
}) => {
	await openWorkspaceFiles(page);
	const tabs = page.getByTestId("editor-tab");

	await page.getByTestId("file-node").filter({ hasText: "README.md" }).dblclick();
	await page.getByTestId("file-node").filter({ hasText: "notes.txt" }).click();
	await expect(tabs).toHaveCount(2);
	await expect(tabs.nth(1)).toContainText("notes.txt");

	await revealWorkbenchTool(page, "specs");
	await page.locator('[data-testid="spec-node"][data-spec-id="sample-root"]').click();
	await expect(tabs).toHaveCount(2);
	await expect(tabs.first()).toContainText("README.md");
	await expect(tabs.nth(1)).toContainText("SPEC.md");
	await expect(tabs.nth(1)).toHaveAttribute("data-preview", "true");

	await tabs.nth(1).hover();
	await tabs.nth(1).getByTestId("editor-tab-close").click();
	await expect(tabs).toHaveCount(1);
	await revealWorkbenchTool(page, "files");
	await page.getByTestId("file-node").filter({ hasText: "notes.txt" }).click();
	await expect(tabs).toHaveCount(2);
	await expect(tabs.nth(1)).toContainText("notes.txt");
	await expect(tabs.nth(1)).toHaveAttribute("data-preview", "true");
});
