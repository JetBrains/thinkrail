import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type Locator, type Page, test } from "@playwright/test";
import { openWorkspaceChat } from "./fixtures/app";
import { E2E_PI_AGENT_DIR } from "./fixtures/paths";

async function readSelection(
	input: Locator,
): Promise<{ start: number; end: number; value: string }> {
	return input.evaluate((el) => {
		const t = el as HTMLTextAreaElement;
		return { start: t.selectionStart ?? 0, end: t.selectionEnd ?? 0, value: t.value };
	});
}

const sentPromptTexts = new WeakMap<Page, string[]>();

function readPromptText(payload: string | Buffer): string | null {
	try {
		const frame = JSON.parse(typeof payload === "string" ? payload : payload.toString()) as {
			method?: unknown;
			params?: { text?: unknown };
		};
		return frame.method === "session.prompt" && typeof frame.params?.text === "string"
			? frame.params.text
			: null;
	} catch {
		return null;
	}
}

async function expectPromptSent(page: Page, expected: string): Promise<void> {
	const prompts = sentPromptTexts.get(page);
	if (!prompts) throw new Error("prompt frame capture was not initialized");
	await expect.poll(() => prompts.at(-1)).toBe(expected);
}

test.beforeEach(({ page }) => {
	const prompts: string[] = [];
	sentPromptTexts.set(page, prompts);
	page.on("websocket", (socket) => {
		socket.on("framesent", ({ payload }) => {
			const text = readPromptText(payload);
			if (text !== null) prompts.push(text);
		});
	});
});

test.describe("prompt templates in the composer", () => {
	test("full lifecycle: filter, pick, fill, tab to the default, and send strips no markers", async ({
		page,
	}) => {
		await openWorkspaceChat(page);
		const input = page.getByTestId("chat-input");

		await input.fill("/rev");
		const rows = page.locator('[data-testid="slash-command"][data-source="prompt"]');
		await expect(rows).toHaveCount(1);
		await expect(rows.first()).toContainText("/review");
		await expect(page.getByTestId("slash-templates-empty")).toHaveCount(0);

		await rows.first().click();
		await expect(input).toHaveValue(/^Review ⟨file⟩ for issues, focusing on src\/\.\s*$/);

		const hint = page.getByTestId("slot-hint");
		await expect(hint).toBeVisible();
		await expect(hint).toContainText("slot 1/2");

		const sel1 = await readSelection(input);
		expect(sel1.value.slice(sel1.start, sel1.end)).toBe("⟨file⟩");

		await page.keyboard.type("watcher.ts");
		await expect(input).toHaveValue(/^Review watcher\.ts for issues, focusing on src\/\.\s*$/);

		await input.press("Tab");
		await expect(hint).toContainText("slot 2/2");
		const sel2 = await readSelection(input);
		expect(sel2.value.slice(sel2.start, sel2.end)).toBe("src/");

		await page.getByTestId("chat-send").click();
		await expectPromptSent(page, "Review watcher.ts for issues, focusing on src/.");
		await expect(hint).not.toBeVisible();
	});

	test("a template file added outside the app appears on the next menu open", async ({ page }) => {
		await openWorkspaceChat(page);
		const input = page.getByTestId("chat-input");
		const rows = page.locator('[data-testid="slash-command"][data-source="prompt"]');
		const freshFile = join(E2E_PI_AGENT_DIR, "prompts", "freshly-added.md");

		try {
			await input.fill("/rev");
			await expect(rows.filter({ hasText: "/review" })).toBeVisible();
			await input.fill("/freshly");
			await expect(rows).toHaveCount(0);

			writeFileSync(freshFile, "---\ndescription: Added outside the app\n---\nFresh body $1\n");

			await input.fill("");
			await input.fill("/freshly");
			await expect(rows.filter({ hasText: "/freshly-added" })).toBeVisible();
		} finally {
			rmSync(freshFile, { force: true });
		}
	});

	test("typing after ArrowRight-collapsing the marker selection is never deleted by the send", async ({
		page,
	}) => {
		await openWorkspaceChat(page);
		const input = page.getByTestId("chat-input");

		await input.fill("/rev");
		const rows = page.locator('[data-testid="slash-command"][data-source="prompt"]');
		await rows.first().click();
		await expect(input).toHaveValue(/^Review ⟨file⟩ for issues, focusing on src\/\.\s*$/);
		await expect(page.getByTestId("slot-hint")).toContainText("slot 1/2");

		await input.press("ArrowRight");
		const sel = await readSelection(input);
		expect(sel.start).toBe(sel.end);
		expect(sel.value.slice(0, sel.start).endsWith("⟨file⟩")).toBe(true);

		await page.keyboard.type("server.ts");
		await page.getByTestId("chat-send").click();

		await expectPromptSent(page, "Review ⟨file⟩server.ts for issues, focusing on src/.");
	});

	test("tabbing out of a filled slot mirrors its text into a sibling sharing its group", async ({
		page,
	}) => {
		await openWorkspaceChat(page);
		const input = page.getByTestId("chat-input");

		await input.fill("/rena");
		const rows = page.locator('[data-testid="slash-command"][data-source="prompt"]');
		await expect(rows).toHaveCount(1);
		await expect(rows.first()).toContainText("/rename");

		await rows.first().click();
		await expect(input).toHaveValue(/^Rename ⟨name⟩ and update every ⟨name⟩ reference\.\s*$/);

		const hint = page.getByTestId("slot-hint");
		await expect(hint).toContainText("slot 1/2");
		const sel1 = await readSelection(input);
		expect(sel1.value.slice(sel1.start, sel1.end)).toBe("⟨name⟩");

		await page.keyboard.type("Widget");
		await expect(input).toHaveValue(/^Rename Widget and update every ⟨name⟩ reference\.\s*$/);

		await input.press("Tab");
		await expect(hint).toContainText("slot 2/2");
		await expect(input).toHaveValue(/^Rename Widget and update every Widget reference\.\s*$/);
		const sel2 = await readSelection(input);
		expect(sel2.value.slice(sel2.start, sel2.end)).toBe("Widget");

		await page.getByTestId("chat-send").click();
		await expectPromptSent(page, "Rename Widget and update every Widget reference.");
	});

	test("the highlight backdrop tints each gap and tracks the active slot as Tab steps through", async ({
		page,
	}) => {
		await openWorkspaceChat(page);
		const input = page.getByTestId("chat-input");

		await input.fill("/rena");
		await page.locator('[data-testid="slash-command"][data-source="prompt"]').first().click();
		await expect(input).toHaveValue(/^Rename ⟨name⟩ and update every ⟨name⟩ reference\.\s*$/);

		const backdrop = page.getByTestId("slot-backdrop");
		await expect(backdrop).toBeVisible();
		const highlights = page.getByTestId("slot-highlight");
		await expect(highlights).toHaveCount(2);
		await expect(highlights.nth(0)).toHaveAttribute("data-slot-state", "active");
		await expect(highlights.nth(1)).toHaveAttribute("data-slot-state", "unfilled");

		await page.keyboard.type("Widget");
		await input.press("Tab");
		await expect(highlights.nth(0)).toHaveAttribute("data-slot-state", "filled");
		await expect(highlights.nth(1)).toHaveAttribute("data-slot-state", "active");

		await page.getByTestId("chat-send").click();
		await expect(backdrop).not.toBeVisible();
	});

	test("sending directly (no Tab) still mirrors a filled slot's text into its same-group sibling", async ({
		page,
	}) => {
		await openWorkspaceChat(page);
		const input = page.getByTestId("chat-input");

		await input.fill("/rena");
		await page.locator('[data-testid="slash-command"][data-source="prompt"]').first().click();
		await expect(input).toHaveValue(/^Rename ⟨name⟩ and update every ⟨name⟩ reference\.\s*$/);

		await page.keyboard.type("Widget");
		await expect(input).toHaveValue(/^Rename Widget and update every ⟨name⟩ reference\.\s*$/);

		await page.getByTestId("chat-send").click();
		await expectPromptSent(page, "Rename Widget and update every Widget reference.");
	});

	test("differing per-occurrence defaults stay independent through Tab and a direct Send (no edit)", async ({
		page,
	}) => {
		await openWorkspaceChat(page);
		const input = page.getByTestId("chat-input");

		await input.fill("/def");
		const rows = page.locator('[data-testid="slash-command"][data-source="prompt"]');
		await expect(rows).toHaveCount(1);
		await expect(rows.first()).toContainText("/defaults");

		await rows.first().click();
		await expect(input).toHaveValue(/^foo versus bar\s*$/);
		const hint = page.getByTestId("slot-hint");
		await expect(hint).toContainText("slot 1/2");

		await input.press("Tab");
		await expect(hint).toContainText("slot 2/2");
		await expect(input).toHaveValue(/^foo versus bar\s*$/);

		await page.getByTestId("chat-send").click();
		await expectPromptSent(page, "foo versus bar");
	});

	test("editing one default occurrence provides the argument and mirrors it into the group-mate on Tab", async ({
		page,
	}) => {
		await openWorkspaceChat(page);
		const input = page.getByTestId("chat-input");

		await input.fill("/def");
		await page.locator('[data-testid="slash-command"][data-source="prompt"]').first().click();
		await expect(input).toHaveValue(/^foo versus bar\s*$/);

		const sel = await readSelection(input);
		expect(sel.value.slice(sel.start, sel.end)).toBe("foo");
		await page.keyboard.type("cats");
		await expect(input).toHaveValue(/^cats versus bar\s*$/);

		await input.press("Tab");
		await expect(input).toHaveValue(/^cats versus cats\s*$/);

		await page.getByTestId("chat-send").click();
		await expectPromptSent(page, "cats versus cats");
	});

	test("Escape ends the session and leaves the text as-is", async ({ page }) => {
		await openWorkspaceChat(page);
		const input = page.getByTestId("chat-input");
		await input.fill("/rev");
		await page.locator('[data-testid="slash-command"][data-source="prompt"]').first().click();

		const hint = page.getByTestId("slot-hint");
		await expect(hint).toBeVisible();
		const before = await input.inputValue();

		await input.press("Escape");
		await expect(hint).not.toBeVisible();
		expect(await input.inputValue()).toBe(before);
	});

	test("a wholesale replacement of the draft ends the session instead of tracking a meaningless range", async ({
		page,
	}) => {
		await openWorkspaceChat(page);
		const input = page.getByTestId("chat-input");
		await input.fill("/rev");
		await page.locator('[data-testid="slash-command"][data-source="prompt"]').first().click();
		await expect(page.getByTestId("slot-hint")).toBeVisible();

		await input.fill("something completely different");
		await expect(page.getByTestId("slot-hint")).not.toBeVisible();
		await expect(input).toHaveValue("something completely different");
	});

	test("picking a template replaces whatever draft was already there", async ({ page }) => {
		await openWorkspaceChat(page);
		const input = page.getByTestId("chat-input");
		await input.fill("leftover draft text");
		await input.fill("/rev");
		await page.locator('[data-testid="slash-command"][data-source="prompt"]').first().click();

		await expect(input).toHaveValue(/^Review/);
		expect(await input.inputValue()).not.toContain("leftover draft text");
	});

	test("the merged menu still shows non-template commands", async ({ page }) => {
		await openWorkspaceChat(page);
		const input = page.getByTestId("chat-input");
		await input.fill("/skill:spec-graph");
		const row = page.locator('[data-testid="slash-command"][data-source="skill"]');
		await expect(row).toHaveCount(1);
		await expect(row).toContainText("skill:spec-graph");
	});

	test("filling an unfilled slot across several keystrokes never steals characters from a zero-gap sibling", async ({
		page,
	}) => {
		await openWorkspaceChat(page);
		const input = page.getByTestId("chat-input");

		await input.fill("/adj");
		const rows = page.locator('[data-testid="slash-command"][data-source="prompt"]');
		await expect(rows).toHaveCount(1);
		await expect(rows.first()).toContainText("/adjacent");

		await rows.first().click();
		await expect(input).toHaveValue(/^⟨arg1⟩⟨arg2⟩\s*$/);

		const hint = page.getByTestId("slot-hint");
		await expect(hint).toContainText("slot 1/2");
		const sel1 = await readSelection(input);
		expect(sel1.value.slice(sel1.start, sel1.end)).toBe("⟨arg1⟩");

		await page.keyboard.type("hello");
		await expect(input).toHaveValue(/^hello⟨arg2⟩\s*$/);

		await input.press("Tab");
		await expect(hint).toContainText("slot 2/2");
		const sel2 = await readSelection(input);
		expect(sel2.value.slice(sel2.start, sel2.end)).toBe("⟨arg2⟩");

		await page.getByTestId("chat-send").click();
		await expectPromptSent(page, "hello");
	});

	test("sending with a live unfilled marker strips it and collapses the doubled space to exactly one", async ({
		page,
	}) => {
		await openWorkspaceChat(page);
		const input = page.getByTestId("chat-input");

		await input.fill("/rev");
		await page.locator('[data-testid="slash-command"][data-source="prompt"]').first().click();
		await expect(input).toHaveValue(/^Review ⟨file⟩ for issues, focusing on src\/\.\s*$/);

		await page.getByTestId("chat-send").click();
		await expectPromptSent(page, "Review for issues, focusing on src/.");
	});

	test("Escape closes the history overlay without ending an active slot session", async ({
		page,
	}) => {
		await openWorkspaceChat(page);
		const input = page.getByTestId("chat-input");

		await input.fill("/rev");
		await page.locator('[data-testid="slash-command"][data-source="prompt"]').first().click();
		const hint = page.getByTestId("slot-hint");
		await expect(hint).toContainText("slot 1/2");
		const draft = await input.inputValue();

		await page.keyboard.press("Control+r");
		const overlay = page.getByTestId("history-overlay");
		await expect(overlay).toBeVisible();
		await page.keyboard.press("Escape");
		await expect(overlay).toBeHidden();

		await expect(input).toHaveValue(draft);
		await expect(hint).toContainText("slot 1/2");
		await expect(input).toBeFocused();
		const restored = await readSelection(input);
		expect(restored.value.slice(restored.start, restored.end)).toBe("⟨file⟩");
		await page.keyboard.type("watcher.ts");
		await expect(input).toHaveValue(/^Review watcher\.ts for issues, focusing on src\/\.\s*$/);

		await input.press("Tab");
		await expect(hint).toContainText("slot 2/2");

		await input.press("Escape");
		await expect(hint).toHaveCount(0);
		await input.fill("");
	});
});
