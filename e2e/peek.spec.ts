import { mkdirSync, realpathSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Locator, Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import type { AskUserQuestionArgs } from "@thinkrail/pi-ask-user-question/core";
import { enterDefaultWorkspace, openFixtureProject, openPersistedChat } from "./fixtures/app";
import { seedQuestionnaire } from "./fixtures/ask";
import { clickTranscriptControl, waitForScrollStability } from "./fixtures/chatScroll";
import { E2E_FIXTURE_REPO } from "./fixtures/paths";
import { seedWorkspaceSession } from "./fixtures/sessions";

const BASE_TS = 1_700_990_000_000;
const MOCKUPS = ".thinkrail/context/mockups";

const openPeek = (page: Page) => page.locator('[data-region-kind="peek"][data-open]');
const crumbs = (page: Page) => openPeek(page).getByTestId("peek-crumb");
const currentCrumb = (page: Page) =>
	openPeek(page).locator('[data-testid="peek-crumb"][data-current]');
const fileTabs = (page: Page) => page.locator('[data-testid="editor-tab"][data-kind="file"]');

function writeMockups(files: Record<string, string>): () => void {
	for (const [name, content] of Object.entries(files)) {
		const path = join(E2E_FIXTURE_REPO, MOCKUPS, name);
		mkdirSync(dirname(path), { recursive: true });
		writeFileSync(path, content);
	}
	return () => rmSync(join(E2E_FIXTURE_REPO, ".thinkrail"), { recursive: true, force: true });
}

const mockup = (title: string) =>
	`<!doctype html><html><body><main><h1>${title}</h1></main></body></html>`;

const read = (id: string, path: string, text: string) => ({ id, path, text });
const READS = [
	read("read-readme", "README.md", "# sample-project"),
	read("read-spec", "module-a/SPEC.md", "## Responsibility"),
];

async function openReadChat(page: Page): Promise<void> {
	await openFixtureProject(page);
	const session = seedWorkspaceSession(realpathSync(E2E_FIXTURE_REPO), {
		name: "peek links",
		messages: [
			{ role: "user", text: "Read the guide and its spec.", timestamp: BASE_TS },
			{
				role: "assistant",
				content: READS.map((call) => ({
					type: "toolCall" as const,
					id: call.id,
					name: "read",
					arguments: { path: call.path },
				})),
				stopReason: "toolUse",
				timestamp: BASE_TS + 1_000,
			},
			...READS.map((call, index) => ({
				role: "toolResult" as const,
				toolCallId: call.id,
				toolName: "read",
				content: [{ type: "text" as const, text: call.text }],
				isError: false,
				timestamp: BASE_TS + 2_000 + index,
			})),
			{
				role: "assistant",
				text: "Start with [the readme](README.md), then [the spec](module-a/SPEC.md).",
				stopReason: "stop",
				timestamp: BASE_TS + 3_000,
			},
		],
	});
	utimesSync(session.path, new Date(BASE_TS + 50_000), new Date(BASE_TS + 50_000));
	await enterDefaultWorkspace(page);
	await expect(page.locator('[data-testid="editor-tab"][data-kind="chat"]')).toHaveCount(1);
	await expect(markdownLink(page, "the spec")).toBeVisible();
}

const markdownLink = (page: Page, name: string) =>
	page
		.locator('[data-testid="chat-message"][data-role="assistant"]')
		.last()
		.getByRole("button", { name });

async function readLink(page: Page, index: number): Promise<Locator> {
	const activity = page.getByTestId("activity-group").first();
	if ((await activity.getAttribute("data-expanded")) !== "true") {
		await clickTranscriptControl(activity.getByTestId("activity-group-toggle"));
		await expect(activity).toHaveAttribute("data-expanded", "true");
	}
	const step = activity.locator('[data-testid="activity-step"][data-tool="read"]').nth(index);
	await expect(step).toBeVisible();
	if ((await step.getAttribute("data-expanded")) !== "true") {
		await clickTranscriptControl(step.getByTestId("activity-step-toggle"));
		await expect(step).toHaveAttribute("data-expanded", "true");
	}
	return step.getByTestId("tool-file-link");
}

async function width(locator: Locator): Promise<number> {
	const box = await locator.boundingBox();
	if (!box) throw new Error("element has no box");
	return box.width;
}

test("a tool file link opens Peek beside the chat, which folds the right tool side until Peek closes", async ({
	page,
}) => {
	await openReadChat(page);
	const rightStack = page.getByTestId("right-stack");
	await expect(rightStack).toBeVisible();
	await expect(page.getByTestId("right-layout-rail")).toBeVisible();
	const rightWidth = await width(rightStack);

	const link = await readLink(page, 0);
	await clickTranscriptControl(link);
	await expect(crumbs(page)).toHaveText(["README.md"]);
	await expect(openPeek(page).getByTestId("resource-preview")).toBeVisible();
	await expect(link).toBeFocused();
	await expect(fileTabs(page)).toHaveCount(0);
	await expect(rightStack).toHaveCount(0);
	await expect(page.getByTestId("right-layout-rail")).toHaveCount(0);

	await openPeek(page).getByTestId("peek-close").click();
	await expect(openPeek(page)).toHaveCount(0);
	await expect(page.getByTestId("peek")).toBeHidden();
	await expect(rightStack).toBeVisible();
	await expect(page.getByTestId("right-layout-rail")).toBeVisible();
	await expect.poll(() => width(rightStack)).toBeCloseTo(rightWidth, 0);
});

test("Peek keeps a back-stack, and Open in tab promotes the shown entry to a kept center tab", async ({
	page,
}) => {
	await openReadChat(page);
	await clickTranscriptControl(markdownLink(page, "the readme"));
	await clickTranscriptControl(markdownLink(page, "the spec"));
	await expect(crumbs(page)).toHaveText(["README.md", "SPEC.md"]);
	await expect(currentCrumb(page)).toHaveText("SPEC.md");

	const back = openPeek(page).getByTestId("peek-back");
	const forward = openPeek(page).getByTestId("peek-forward");
	await expect(forward).toBeDisabled();
	await back.click();
	await expect(currentCrumb(page)).toHaveText("README.md");
	await expect(back).toBeDisabled();
	await forward.click();
	await expect(currentCrumb(page)).toHaveText("SPEC.md");

	await clickTranscriptControl(markdownLink(page, "the readme"));
	await expect(crumbs(page)).toHaveText(["README.md", "SPEC.md"]);
	await expect(currentCrumb(page)).toHaveText("README.md");

	await openPeek(page).getByTestId("peek-open-tab").click();
	await expect(fileTabs(page)).toHaveText(["README.md"]);
	await expect(fileTabs(page)).not.toHaveAttribute("data-preview", "true");
	await expect(crumbs(page)).toHaveText(["SPEC.md"]);

	await openPeek(page).getByTestId("peek-open-tab").click();
	await expect(openPeek(page)).toHaveCount(0);
	await expect(fileTabs(page)).toHaveCount(2);
	await expect(fileTabs(page).filter({ hasText: "SPEC.md" })).toHaveAttribute(
		"data-active",
		"true",
	);
});

test("the composer keeps focus when Peek opens, and Esc closes Peek only while it is unpinned", async ({
	page,
}) => {
	await openReadChat(page);
	const input = page.getByTestId("chat-input");
	await input.click();
	await expect(input).toBeFocused();
	await markdownLink(page, "the readme").dispatchEvent("click");
	await expect(crumbs(page)).toHaveText(["README.md"]);
	await expect(input).toBeFocused();

	await page.keyboard.press("Escape");
	await expect(input).not.toBeFocused();
	await expect(openPeek(page)).toBeVisible();
	await page.keyboard.press("Escape");
	await expect(openPeek(page)).toHaveCount(0);

	await markdownLink(page, "the readme").dispatchEvent("click");
	await expect(crumbs(page)).toHaveText(["README.md"]);
	const pin = openPeek(page).getByTestId("peek-pin");
	await pin.click();
	await expect(pin).toHaveAttribute("aria-pressed", "true");
	await page.keyboard.press("Escape");
	await expect(openPeek(page)).toBeVisible();

	await pin.click();
	await expect(pin).toHaveAttribute("aria-pressed", "false");
	await page.keyboard.press("Escape");
	await expect(openPeek(page)).toHaveCount(0);
	await expect(page.locator('[data-region-kind="peek"]:focus-within')).toHaveCount(0);
});

test("Peek's width survives a reload", async ({ page }) => {
	await openReadChat(page);
	await clickTranscriptControl(markdownLink(page, "the readme"));
	const peek = openPeek(page);
	await expect(peek).toBeVisible();
	const initial = await width(peek);
	const handle = page.getByTestId("resize-peek");
	const box = await handle.boundingBox();
	if (!box) throw new Error("resize handle has no box");
	await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
	await page.mouse.down();
	await page.mouse.move(box.x + box.width / 2 + 150, box.y + box.height / 2, { steps: 12 });
	await page.mouse.up();
	await expect.poll(() => width(peek)).toBeLessThan(initial - 100);
	const resized = await width(peek);

	await page.reload();
	await expect(page.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");
	await expect(markdownLink(page, "the readme")).toBeVisible();
	await expect(openPeek(page)).toHaveCount(0);
	await clickTranscriptControl(markdownLink(page, "the readme"));
	await expect(openPeek(page)).toBeVisible();
	await expect.poll(async () => Math.abs((await width(openPeek(page))) - resized)).toBeLessThan(3);
});

const PREVIEW_ROUND = {
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
				{ label: "Keep it as is", description: "No change." },
			],
		},
	],
} satisfies AskUserQuestionArgs;

test("a question preview's Peek action opens it, and Peek follows the option under the cursor", async ({
	page,
}) => {
	await page.setViewportSize({ width: 1400, height: 1100 });
	await openFixtureProject(page);
	const cleanup = writeMockups({
		"today.html": mockup("Settings today"),
		"sidebar.html": mockup("Settings with a sidebar"),
		"loader.before.ts": "export const loader = () => null;\n",
		"loader.after.ts": "export const loader = () => readSettings();\n",
	});
	const session = seedQuestionnaire("peek previews", "ask-peek", PREVIEW_ROUND, BASE_TS);
	try {
		await enterDefaultWorkspace(page);
		await openPersistedChat(page, "peek previews");
		const card = page.locator('[data-testid="ask-user-question"][data-tone="active"]');
		const options = card.getByTestId("ask-option");
		await expect(options.first()).toBeFocused();
		await waitForScrollStability(page.getByTestId("chat-scroll"));
		const pane = card.getByTestId("ask-preview");
		await expect(pane.getByTestId("html-frame-box")).toBeVisible();

		await pane.getByTestId("ask-preview-peek").click();
		await expect(crumbs(page)).toHaveText(["sidebar.html"]);
		await expect(openPeek(page).getByTestId("html-view")).toBeVisible();

		await options.nth(1).click();
		await expect(pane.getByTestId("ask-preview-peek")).toHaveAccessibleName("Open diff in Peek");
		await expect(crumbs(page)).toHaveText(["loader.before.ts → loader.after.ts"]);
		await options.nth(2).click();
		await expect(pane.getByTestId("ask-preview-none")).toBeVisible();
		await expect(crumbs(page)).toHaveText(["loader.before.ts → loader.after.ts"]);
		await options.first().click();
		await expect(crumbs(page)).toHaveText(["sidebar.html"]);

		await card.getByTestId("ask-question-preview").getByTestId("ask-preview-peek").click();
		await expect(crumbs(page)).toHaveText(["sidebar.html", "today.html"]);
		await options.nth(1).click();
		await expect(crumbs(page)).toHaveText(["sidebar.html", "today.html"]);
	} finally {
		rmSync(session.path, { force: true });
		cleanup();
	}
});

test("a visualize card peeks its file from the frame's Peek action and from its links", async ({
	page,
}) => {
	await openFixtureProject(page);
	const cleanup = writeMockups({ "a.html": mockup("Before"), "b.html": mockup("After") });
	const args = { type: "file", path: `${MOCKUPS}/b.html`, before: `${MOCKUPS}/a.html` };
	seedWorkspaceSession(realpathSync(E2E_FIXTURE_REPO), {
		name: "peek visualize",
		messages: [
			{ role: "user", text: "Show the change.", timestamp: BASE_TS },
			{
				role: "assistant",
				content: [{ type: "toolCall", id: "visualize-1", name: "visualize", arguments: args }],
				stopReason: "toolUse",
				timestamp: BASE_TS + 1_000,
			},
			{
				role: "toolResult",
				toolCallId: "visualize-1",
				toolName: "visualize",
				content: [{ type: "text", text: "Visualization complete." }],
				details: args,
				isError: false,
				timestamp: BASE_TS + 2_000,
			},
		],
	});
	try {
		await enterDefaultWorkspace(page);
		await openPersistedChat(page, "peek visualize");
		const file = page.getByTestId("tool-visualize-file");
		await expect(file.getByTestId("resource-preview-diff").locator("iframe")).toHaveCount(2);

		await clickTranscriptControl(file.getByTestId("tool-visualize-peek"));
		await expect(crumbs(page)).toHaveText(["a.html → b.html"]);
		await expect(fileTabs(page)).toHaveCount(0);

		await clickTranscriptControl(
			file.getByTestId("tool-visualize-file-link").filter({ hasText: "a.html" }),
		);
		await expect(crumbs(page)).toHaveText(["a.html → b.html", "a.html"]);
		await expect(currentCrumb(page)).toHaveText("a.html");
		await expect(fileTabs(page)).toHaveCount(0);
	} finally {
		cleanup();
	}
});
