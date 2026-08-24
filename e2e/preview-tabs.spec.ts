import { expect, test } from "@playwright/test";
import {
	createWorkspaceViaDialog,
	enterDefaultWorkspace,
	openFixtureProject,
} from "./fixtures/app";

async function openWorkspaceFiles(page: import("@playwright/test").Page): Promise<void> {
	await openFixtureProject(page);
	await createWorkspaceViaDialog(page);
	const chatTab = page.locator('[data-testid="editor-tab"][data-kind="chat"]');
	await chatTab.hover();
	await chatTab.getByTestId("editor-tab-close").click();
	await expect(chatTab).toHaveCount(0);
	await page.getByTestId("tab-files").click();
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

test("a browse the user has navigated away from is dropped, not activated on arrival", async ({
	page,
}) => {
	await openWorkspaceFiles(page);
	const tabs = page.getByTestId("editor-tab");

	await page.getByTestId("file-node").filter({ hasText: "README.md" }).dblclick();
	await expect(tabs).toHaveCount(1);
	await expect(tabs.first()).toHaveAttribute("data-preview", "false");

	await page.evaluate(() => {
		const byText = <T extends Element>(sel: string, text: string): T => {
			const hit = [...document.querySelectorAll(sel)].find((el) => el.textContent?.includes(text));
			if (!hit) throw new Error(`no ${sel} containing ${text}`);
			return hit as unknown as T;
		};
		byText<HTMLElement>('[data-testid="file-node"]', "notes.txt").click();
		byText<HTMLElement>('[data-testid="editor-tab"]', "README.md")
			.querySelector<HTMLElement>("button")
			?.click();
	});

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

test("a newer tab click cancels an older preview-tab settle timer", async ({ page }) => {
	await openFixtureProject(page);
	await enterDefaultWorkspace(page);
	await page.getByTestId("tab-files").click();
	await page.getByTestId("file-node").filter({ hasText: "notes.txt" }).dblclick();
	await page.getByTestId("file-node").filter({ hasText: "README.md" }).click();

	const notes = page.getByTestId("editor-tab").filter({ hasText: "notes.txt" });
	const readme = page.getByTestId("editor-tab").filter({ hasText: "README.md" });
	await expect(readme).toHaveAttribute("data-preview", "true");
	await readme.click();
	await notes.click();
	await page.waitForTimeout(300);

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

	await page.getByTestId("tab-specs").click();
	await page.locator('[data-testid="spec-node"][data-spec-id="sample-root"]').click();
	await expect(tabs).toHaveCount(2);
	await expect(tabs.first()).toContainText("README.md");
	await expect(tabs.nth(1)).toContainText("SPEC.md");
	await expect(tabs.nth(1)).toHaveAttribute("data-preview", "true");

	await tabs.nth(1).hover();
	await tabs.nth(1).getByTestId("editor-tab-close").click();
	await expect(tabs).toHaveCount(1);
	await page.getByTestId("tab-files").click();
	await page.getByTestId("file-node").filter({ hasText: "notes.txt" }).click();
	await expect(tabs).toHaveCount(2);
	await expect(tabs.nth(1)).toContainText("notes.txt");
	await expect(tabs.nth(1)).toHaveAttribute("data-preview", "true");
});
