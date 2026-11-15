import { mkdirSync, readFileSync, realpathSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Locator, Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import type { ToolCall, ToolResponsePendingDetails } from "@thinkrail/contracts";
import type { AskUserQuestionArgs } from "@thinkrail/pi-ask-user-question/core";
import {
	enterDefaultWorkspace,
	hideAuxiliaryWorkbench,
	openFixtureProject,
	openPersistedChat,
} from "./fixtures/app";
import { waitForScrollStability } from "./fixtures/chatScroll";
import { E2E_FIXTURE_REPO } from "./fixtures/paths";
import { seedWorkspaceSession } from "./fixtures/sessions";

const BASE_TS = 1_700_860_000_000;
const MOCKUPS = ".thinkrail/context/mockups";

const mockup = (title: string) =>
	`<!doctype html><html><body><main><h1>${title}</h1><p>Theme · Line width · Font</p></main></body></html>`;

function writeMockups(files: Record<string, string>): () => void {
	for (const [name, content] of Object.entries(files)) {
		const path = join(E2E_FIXTURE_REPO, MOCKUPS, name);
		mkdirSync(dirname(path), { recursive: true });
		writeFileSync(path, content);
	}
	return () => rmSync(join(E2E_FIXTURE_REPO, ".thinkrail"), { recursive: true, force: true });
}

function seedQuestionnaire(
	name: string,
	toolCallId: string,
	args: AskUserQuestionArgs & ToolCall["arguments"],
) {
	const ack: ToolResponsePendingDetails = { kind: "ack" };
	const session = seedWorkspaceSession(realpathSync(E2E_FIXTURE_REPO), {
		name,
		messages: [
			{ role: "user", text: "Ask me about the settings layout.", timestamp: BASE_TS },
			{
				role: "assistant",
				content: [
					{
						type: "toolCall",
						id: toolCallId,
						name: "ask_user_question",
						arguments: args,
					},
				],
				stopReason: "toolUse",
				timestamp: BASE_TS + 1_000,
			},
			{
				role: "toolResult",
				toolCallId,
				toolName: "ask_user_question",
				content: [{ type: "text", text: "Questions shown to the user; awaiting an answer." }],
				details: ack,
				isError: false,
				timestamp: BASE_TS + 2_000,
			},
		],
	});
	utimesSync(session.path, new Date(BASE_TS), new Date(BASE_TS));
	return session;
}

const LAYOUT_ROUND = {
	questions: [
		{
			question: "Which settings layout should replace today's page?",
			header: "Layout",
			previewFile: `${MOCKUPS}/today.html`,
			options: [
				{
					label: "Sidebar nav (Recommended)",
					description: "Sections on the left.",
					previewFile: `${MOCKUPS}/sidebar.html`,
				},
				{
					label: "Edited loader",
					description: "Change the loader in place.",
					previewFile: `${MOCKUPS}/loader.after.ts`,
					previewBefore: `${MOCKUPS}/loader.before.ts`,
				},
				{
					label: "Flow first",
					description: "Draw the flow before the layout.",
					preview: `\`\`\`mermaid\nflowchart LR\n  Settings --> Sidebar --> Section\n\`\`\`\n\n${Array.from(
						{ length: 30 },
						(_, i) => `${i + 1}. A flow note long enough to need the pane's own scroll.`,
					).join("\n")}`,
				},
				{ label: "Keep it as is", description: "No change." },
			],
		},
		{
			question: "Which checks should the layout change run?",
			header: "Checks",
			multiSelect: true,
			options: [
				{ label: "Layout lint", description: "Biome." },
				{ label: "Layout types", description: "tsc." },
			],
		},
	],
} satisfies AskUserQuestionArgs;

const MOCKUP_FILES = {
	"today.html": mockup("Settings today"),
	"sidebar.html": mockup("Settings with a sidebar"),
	"loader.before.ts": "export const loader = () => null;\n",
	"loader.after.ts": "export const loader = () => readSettings();\n",
};

async function height(locator: Locator): Promise<number> {
	const box = await locator.boundingBox();
	if (!box) throw new Error("element has no box");
	return box.height;
}

async function openRound(page: Page, name: string): Promise<Locator> {
	await enterDefaultWorkspace(page);
	await hideAuxiliaryWorkbench(page);
	await openPersistedChat(page, name);
	const card = page.locator('[data-testid="ask-user-question"][data-tone="active"]');
	await expect(card.getByTestId("ask-option").first()).toBeFocused();
	await waitForScrollStability(page.getByTestId("chat-scroll"));
	return card;
}

test("previews show the question's subject and the picked option in fixed frames, and the answer carries the file path", async ({
	page,
}) => {
	await page.setViewportSize({ width: 1400, height: 1100 });
	await openFixtureProject(page);
	const cleanup = writeMockups(MOCKUP_FILES);
	const session = seedQuestionnaire("layout previews", "ask-layout-previews", LAYOUT_ROUND);

	try {
		const card = await openRound(page, "layout previews");
		const subject = card.getByTestId("ask-question-preview");
		await expect(subject).toContainText("What this question is about");
		await expect(subject.getByTestId("ask-preview-open-tab")).toBeVisible();
		await expect(subject.getByTestId("html-frame-box")).toBeVisible();

		const pane = card.getByTestId("ask-preview");
		const options = card.getByTestId("ask-option");
		await expect(pane).toHaveAttribute("data-preview", "file");
		await expect(pane.getByTestId("html-frame-box")).toBeVisible();
		const settled = await height(card);

		await options.nth(1).click();
		await expect(pane.getByTestId("ask-preview-open-tab")).toHaveAccessibleName("Open diff in tab");
		expect(await height(card)).toBe(settled);

		await options.nth(2).click();
		await expect(pane).toHaveAttribute("data-preview", "markdown");
		await expect(pane.getByTestId("mermaid-svg").locator("svg")).toBeVisible({ timeout: 15_000 });
		expect(await height(card)).toBe(settled);
		const scroller = pane.getByTestId("ask-preview-scroll");
		await expect(options.nth(2)).toBeFocused();
		await page.keyboard.press("PageDown");
		await expect.poll(() => scroller.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
		await expect(options.nth(2)).toHaveAttribute("data-selected", "true");
		await expect(card.getByTestId("ask-shortcuts")).toContainText("PgUp/PgDn preview");

		await options.nth(3).click();
		await expect(pane.getByTestId("ask-preview-none")).toHaveText("No preview for this option");
		expect(await height(card)).toBe(settled);

		await card.getByTestId("ask-tab").nth(1).click();
		await expect(card.getByTestId("ask-preview")).toHaveCount(0);
		expect(await height(card)).toBe(settled);
		await card.getByTestId("ask-tab").first().click();

		await options.first().click();
		await expect(pane).toHaveAttribute("data-preview", "file");
		await card.getByTestId("ask-continue").click();
		await card.getByTestId("ask-option").first().click();
		await card.getByTestId("ask-submit").click();
		await expect(
			page.locator('[data-testid="ask-user-question"][data-tone="answered"]'),
		).toBeVisible();
		await expect
			.poll(() => readFileSync(session.path, "utf8"))
			.toContain(`"previewFile":"${MOCKUPS}/sidebar.html"`);
	} finally {
		rmSync(session.path, { force: true });
		cleanup();
	}
});

test("a preview opens full screen without paging or skipping, and a removed file says so in place", async ({
	page,
}) => {
	await page.setViewportSize({ width: 1400, height: 1100 });
	await openFixtureProject(page);
	const cleanup = writeMockups(MOCKUP_FILES);
	const session = seedQuestionnaire("preview keys", "ask-preview-keys", LAYOUT_ROUND);

	try {
		const card = await openRound(page, "preview keys");
		const subject = card.getByTestId("ask-question-preview");
		await expect(subject.getByTestId("html-frame-box")).toBeVisible();
		const settled = await height(card);

		await subject.getByTestId("ask-preview-fullscreen").click();
		const dialog = page.getByTestId("ask-compare");
		await expect(dialog).toBeVisible();
		await page.keyboard.press("ArrowRight");
		await page.keyboard.press("Shift+Escape");
		await expect(dialog).toBeHidden();
		await expect(card).toBeVisible();
		await expect(card.getByTestId("ask-tab").first()).toHaveAttribute("data-active", "true");

		rmSync(join(E2E_FIXTURE_REPO, MOCKUPS, "today.html"));
		await expect(subject.getByTestId("resource-preview-stale")).toContainText(
			`${MOCKUPS}/today.html`,
		);
		expect(await height(card)).toBe(settled);
	} finally {
		rmSync(session.path, { force: true });
		cleanup();
	}
});

const NAV_ITEMS = ["General", "Appearance", "Editor", "Agents", "Keys"];

const navMockup = (title: string, nav: "sidebar" | "tabs" | "none") => {
	const items = NAV_ITEMS.map(
		(item, i) =>
			`<span style="display:block;padding:8px 12px;border-radius:6px;${i === 1 ? "background:#3b6fe0;color:#fff" : "color:#444"}">${item}</span>`,
	).join("");
	const side =
		nav === "sidebar"
			? `<nav style="width:200px;padding:16px;background:#eef0f4">${items}</nav>`
			: "";
	const tabs =
		nav === "tabs"
			? `<nav style="display:flex;gap:4px;padding:8px 24px;background:#eef0f4">${items}</nav>`
			: "";
	const cards = Array.from(
		{ length: 12 },
		(_, i) =>
			`<section style="height:180px;margin-bottom:16px;border-radius:8px;background:#fff;border:1px solid #dde1e8;padding:16px">Setting ${i + 1}</section>`,
	).join("");
	return `<!doctype html><html style="scroll-behavior:smooth"><body style="margin:0;font-family:sans-serif;background:#f6f7f9"><header style="height:56px;display:flex;align-items:center;padding:0 24px;background:#1e2330;color:#fff"><h1 style="font-size:18px;margin:0">${title}</h1></header>${tabs}<div style="display:flex;min-height:3000px">${side}<main style="flex:1;padding:24px">${cards}</main></div></body></html>`;
};

const COMPARE_FILES = {
	"nav-today.html": navMockup("Navigation today", "none"),
	"nav-sidebar.html": navMockup("Navigation in a sidebar", "sidebar"),
	"nav-tabs.html": navMockup("Navigation as tabs", "tabs"),
};

const COMPARE_ROUND = {
	questions: [
		{
			question: "Which navigation should settings use?",
			header: "Navigation",
			previewFile: `${MOCKUPS}/nav-today.html`,
			options: [
				{
					label: "Sidebar nav (Recommended)",
					description: "Sections on the left.",
					previewFile: `${MOCKUPS}/nav-sidebar.html`,
				},
				{
					label: "Top tabs",
					description: "Sections as tabs.",
					previewFile: `${MOCKUPS}/nav-tabs.html`,
				},
				{
					label: "Flow first",
					description: "Draw the flow.",
					preview: "## Flow\n\nSettings → Section",
				},
				{ label: "Keep it as is", description: "No change." },
			],
		},
	],
} satisfies AskUserQuestionArgs;

function pairedScrolls(page: Page): Promise<number[]> {
	return page.evaluate(() =>
		[
			...document.querySelectorAll<HTMLIFrameElement>(
				'[data-testid="ask-compare"] [data-testid="html-diff"] iframe',
			),
		].map((frame) => frame.contentDocument?.scrollingElement?.scrollTop ?? -1),
	);
}

async function scrolledTogether(page: Page): Promise<boolean> {
	const [left, right] = await pairedScrolls(page);
	return left !== undefined && left > 0 && left === right;
}

test("the compare overlay flips through the options, scrolls a pair together and chooses without closing", async ({
	page,
}) => {
	await page.setViewportSize({ width: 1400, height: 1100 });
	await openFixtureProject(page);
	const cleanup = writeMockups(COMPARE_FILES);
	const session = seedQuestionnaire("compare options", "ask-compare-options", COMPARE_ROUND);

	try {
		const card = await openRound(page, "compare options");
		const pane = card.getByTestId("ask-preview");
		await expect(pane.getByTestId("html-frame-box")).toBeVisible();
		await pane.getByTestId("ask-preview-fullscreen").click();
		const overlay = page.getByTestId("ask-compare");
		await expect(overlay).toBeVisible();
		await expect(overlay.getByTestId("ask-compare-body")).toBeFocused();
		await expect(overlay.getByTestId("ask-compare-item")).toHaveCount(5);
		const shown = overlay.getByTestId("ask-compare-pane");
		await expect(shown).toHaveAttribute("data-item", "option:Sidebar nav (Recommended)");
		await page.screenshot({ path: test.info().outputPath("compare-single.png") });

		await page.keyboard.press("ArrowRight");
		await expect(shown).toHaveAttribute("data-item", "option:Top tabs");
		await page.keyboard.press("5");
		await expect(shown.getByTestId("ask-compare-none")).toHaveText("No preview for this option");
		await page.keyboard.press("ArrowRight");
		await expect(shown).toHaveAttribute("data-item", "current");
		await expect(shown.getByTestId("ask-compare-choose")).toHaveCount(0);

		await page.keyboard.press("2");
		await page.keyboard.press("Enter");
		await expect(shown.getByTestId("ask-compare-chosen")).toBeVisible();
		await expect(overlay).toBeVisible();

		await overlay.getByTestId("ask-compare-view-pair").click();
		await expect(overlay.getByTestId("ask-compare-left")).toHaveText(/Current/);
		await expect(overlay.getByTestId("ask-compare-right")).toContainText("Sidebar nav");
		const diff = overlay.getByTestId("html-diff");
		await expect(diff.locator("iframe")).toHaveCount(2);
		await expect.poll(() => pairedScrolls(page)).toEqual([0, 0]);
		const box = await diff.locator("iframe").nth(1).boundingBox();
		if (!box) throw new Error("the right frame has no box");
		await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
		await page.mouse.wheel(0, 600);
		await expect.poll(() => scrolledTogether(page)).toBe(true);
		await page.screenshot({ path: test.info().outputPath("compare-pair.png") });

		await overlay.getByTestId("html-diff-swipe").click();
		await expect(overlay.getByTestId("html-diff-divider")).toBeVisible();
		await expect.poll(() => scrolledTogether(page)).toBe(true);
		await page.screenshot({ path: test.info().outputPath("compare-swipe.png") });

		await overlay.getByTestId("ask-compare-view-grid").click();
		await expect(overlay.getByTestId("ask-compare-pane")).toHaveCount(5);
		await page.screenshot({ path: test.info().outputPath("compare-grid.png") });
		await overlay.getByTestId("ask-compare-pane-title").nth(2).click();
		await expect(shown).toHaveAttribute("data-item", "option:Top tabs");

		await page.keyboard.press("Escape");
		await expect(overlay).toBeHidden();
		const options = card.getByTestId("ask-option");
		await expect(options.first()).toHaveAttribute("data-selected", "true");
		await expect(options.first()).toBeFocused();

		await card.getByTestId("ask-submit").click();
		const receipt = page.locator('[data-testid="ask-user-question"][data-tone="answered"]');
		await receipt.getByTestId("ask-receipt-compare").click();
		await expect(overlay).toBeVisible();
		await expect(shown).toHaveAttribute("data-item", "option:Sidebar nav (Recommended)");
		await expect(shown.getByTestId("ask-compare-chosen")).toBeVisible();
		await expect(overlay.getByTestId("ask-compare-choose")).toHaveCount(0);
		await expect(overlay.getByTestId("ask-compare-legend")).toContainText("Esc close");
	} finally {
		rmSync(session.path, { force: true });
		cleanup();
	}
});
