import { mkdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { expect, type Locator, type Page, test } from "@playwright/test";
import {
	enterDefaultWorkspace,
	expandDisclosure,
	openFixtureProject,
	openPersistedChat,
} from "./fixtures/app";
import { E2E_FIXTURE_REPO } from "./fixtures/paths";
import { pierreLines } from "./fixtures/pierre";
import { seedWorkspaceSession } from "./fixtures/sessions";

const BASE_TS = 1_700_920_000_000;
const MALFORMED_SOURCE = "flowchart TD; Start --> --> broken";

async function openVisualization(
	page: Page,
	name: string,
	args: Record<string, unknown>,
	assistantText?: string,
): Promise<Locator> {
	return (await openVisualizationSession(page, name, args, assistantText)).card;
}

async function openVisualizationSession(
	page: Page,
	name: string,
	args: Record<string, unknown>,
	assistantText?: string,
): Promise<{ card: Locator; sessionId: string }> {
	await openFixtureProject(page);
	const messages: Parameters<typeof seedWorkspaceSession>[1]["messages"] = [
		{ role: "user", text: "Show the visualization.", timestamp: BASE_TS },
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
	];
	if (assistantText !== undefined) {
		messages.push({
			role: "assistant",
			text: assistantText,
			stopReason: "stop",
			timestamp: BASE_TS + 3_000,
		});
	}
	const { id: sessionId } = seedWorkspaceSession(realpathSync(E2E_FIXTURE_REPO), {
		name,
		messages,
	});
	await enterDefaultWorkspace(page);
	await openPersistedChat(page, name);
	const card = page.locator('[data-testid="tool-card"][data-tool="visualize"]');
	await expect(card).toHaveCount(1);
	await expect(card).toBeVisible();
	await expect(card).toHaveAttribute("data-status", "done");
	await expect(card).toHaveAttribute("data-expanded", "true");
	await expect(card.getByTestId("tool-visualize")).toHaveAttribute("data-status", "done");
	return { card, sessionId };
}

const MOCKUP_DIR = ".thinkrail/context/mockups";

function writeMockups(files: Record<string, string>): () => void {
	const dir = join(E2E_FIXTURE_REPO, MOCKUP_DIR);
	mkdirSync(dir, { recursive: true });
	for (const [name, content] of Object.entries(files)) {
		mkdirSync(dirname(join(dir, name)), { recursive: true });
		writeFileSync(join(dir, name), content);
	}
	return () => rmSync(join(E2E_FIXTURE_REPO, ".thinkrail"), { recursive: true, force: true });
}

const mockupHtml = (label: string) =>
	`<!doctype html><html><body><main><h1>Settings</h1><span class="cta">${label}</span></main></body></html>`;

async function openAppearance(page: Page): Promise<Locator> {
	await page.getByTestId("open-settings").click();
	const dialog = page.getByTestId("settings-dialog");
	await expect(dialog).toBeVisible();
	await page.getByTestId("settings-nav-appearance").click();
	await expect(dialog).toContainText("Theme");
	// The fixed-mode theme list sits in a collapsed disclosure.
	await expandDisclosure(dialog.getByTestId("theme-toggle"));
	return dialog;
}

async function pickTheme(page: Page, id: string): Promise<void> {
	const dialog = await openAppearance(page);
	await dialog.locator(`[data-theme-id="${id}"]`).click();
	await expect(page.locator("html")).toHaveAttribute("data-theme", id);
	await page.keyboard.press("Escape");
	await expect(dialog).toBeHidden();
}

async function nodeColors(node: Locator): Promise<{ actual: string; expected: string }> {
	return node.evaluate((element) => {
		const probe = document.createElement("div");
		probe.style.backgroundColor = "var(--container-elevated-bg)";
		document.body.append(probe);
		const expected = getComputedStyle(probe).backgroundColor;
		probe.remove();
		return { actual: getComputedStyle(element).fill, expected };
	});
}

test("completed visualize diagrams expand by default and support fullscreen zoom, pan and reset", async ({
	page,
}) => {
	const card = await openVisualization(page, "completed diagram", {
		type: "diagram",
		title: "Request path",
		mermaid: "flowchart LR; User --> Server --> Database",
	});
	const diagram = card.getByTestId("tool-visualize-diagram");
	await expect(diagram).toBeVisible();
	await expect(diagram.getByText("Request path", { exact: true })).toBeVisible();
	await expect(diagram.getByTestId("mermaid-svg").locator("svg")).toBeVisible({
		timeout: 20_000,
	});
	await diagram.getByTestId("mermaid-fullscreen").click();
	const dialog = page.getByTestId("mermaid-fullscreen-dialog");
	await expect(dialog).toBeVisible();
	await expect(dialog.getByRole("heading", { name: "Request path" })).toBeVisible();
	const viewport = dialog.getByTestId("mermaid-fullscreen-svg");
	const svg = viewport.locator("svg");
	await expect(svg).toBeVisible();
	const widthBefore = (await svg.boundingBox())?.width ?? 0;
	expect(widthBefore).toBeGreaterThan(0);
	await expect(dialog.getByTestId("mermaid-zoom-level")).toHaveText("100%");
	for (let i = 0; i < 4; i++) await dialog.getByTestId("mermaid-zoom-in").click();
	await expect(dialog.getByTestId("mermaid-zoom-level")).not.toHaveText("100%");
	await expect
		.poll(async () => (await svg.boundingBox())?.width ?? 0)
		.toBeGreaterThan(widthBefore * 1.5);
	await expect
		.poll(() => viewport.evaluate((element) => element.scrollWidth - element.clientWidth))
		.toBeGreaterThan(0);
	const box = await viewport.boundingBox();
	if (!box) throw new Error("No fullscreen viewport box");
	const cx = box.x + box.width / 2;
	const cy = box.y + box.height / 2;
	await page.mouse.move(cx, cy);
	await page.mouse.down();
	await page.mouse.move(cx - 140, cy - 90, { steps: 10 });
	await page.mouse.up();
	await expect.poll(() => viewport.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);

	await dialog.getByTestId("mermaid-zoom-reset").click();
	await expect(dialog.getByTestId("mermaid-zoom-level")).toHaveText("100%");
	await expect
		.poll(() => viewport.evaluate((element) => [element.scrollLeft, element.scrollTop]))
		.toEqual([0, 0]);
	await expect.poll(async () => (await svg.boundingBox())?.width ?? 0).toBeCloseTo(widthBefore, 0);

	const gestureClaimed = await viewport.evaluate((element) => {
		const dispatch = (type: string, scale: number) => {
			const event = new Event(type, { bubbles: true, cancelable: true });
			Object.defineProperty(event, "scale", { value: scale });
			return element.dispatchEvent(event);
		};
		return [
			dispatch("gesturestart", 1),
			dispatch("gesturechange", 1.5),
			dispatch("gestureend", 1.5),
		];
	});
	expect(gestureClaimed).toEqual([false, false, false]);
	await expect(dialog.getByTestId("mermaid-zoom-level")).toHaveText("150%");
	await page.keyboard.press("Escape");
	await expect(dialog).toBeHidden();
});

test("visualize comparisons retain exact pros, cons and the recommended option", async ({
	page,
}) => {
	const options = [
		{
			name: "REST",
			description: "Resource endpoints",
			pros: ["HTTP caching", "Simple clients"],
			cons: ["Multiple round trips"],
			recommended: true,
		},
		{
			name: "GraphQL",
			description: "Typed queries",
			pros: ["Precise fields", "Single endpoint"],
			cons: ["Resolver complexity"],
		},
	];
	const card = await openVisualization(page, "completed comparison", {
		type: "comparison",
		title: "API choices",
		options,
	});
	const comparison = card.getByTestId("tool-visualize-comparison");
	await expect(comparison).toBeVisible();
	await expect(comparison.getByText("API choices", { exact: true })).toBeVisible();
	await expect(comparison.getByRole("list")).toHaveCount(4);
	for (const option of options) {
		const optionCard = comparison
			.locator("div")
			.filter({ has: page.getByText(option.name, { exact: true }) })
			.filter({ has: page.getByRole("list") })
			.last();
		await expect(optionCard.getByText(option.description, { exact: true })).toBeVisible();
		await expect(optionCard.getByRole("list")).toHaveCount(2);
		await expect(optionCard.getByRole("list").nth(0).getByRole("listitem")).toHaveText(option.pros);
		await expect(optionCard.getByRole("list").nth(1).getByRole("listitem")).toHaveText(option.cons);
		await expect(optionCard.getByText("Recommended", { exact: true })).toHaveCount(
			option.recommended ? 1 : 0,
		);
	}
	const recommended = comparison.locator('[data-recommended="true"]');
	await expect(recommended).toHaveCount(1);
	await expect(recommended.getByText("REST", { exact: true })).toBeVisible();
});

test("tool diagrams and assistant mermaid fences rerender with the host appearance", async ({
	page,
}) => {
	const card = await openVisualization(
		page,
		"themed diagrams",
		{ type: "diagram", mermaid: "flowchart LR; Tool --> Result" },
		"```mermaid\nflowchart LR; Chat --> Reply\n```",
	);
	const assistant = page.locator('[data-testid="chat-message"][data-role="assistant"]');
	const nodes = [
		card.getByTestId("mermaid-svg").locator("svg .node rect").first(),
		assistant.getByTestId("mermaid-svg").locator("svg .node rect").first(),
	];
	const fills: string[] = [];
	for (const node of nodes) {
		await expect(node).toBeVisible({ timeout: 20_000 });
		const colors = await nodeColors(node);
		expect(colors.actual).toBe(colors.expected);
		fills.push(colors.actual);
	}

	const dialog = await openAppearance(page);
	const options = await dialog.locator('[data-testid^="theme-option-"]').evaluateAll((elements) =>
		elements.map((element) => ({
			id: element.getAttribute("data-theme-id") ?? "",
			appearance: element.getAttribute("data-appearance"),
			active: element.getAttribute("data-active") === "true",
		})),
	);
	const current = options.find((option) => option.active);
	if (!current) throw new Error("No active appearance theme");
	const opposite = options.find(
		(option) => option.appearance === (current.appearance === "dark" ? "light" : "dark"),
	);
	if (!opposite) throw new Error("No opposite appearance theme");
	await page.keyboard.press("Escape");
	await expect(dialog).toBeHidden();

	try {
		await pickTheme(page, opposite.id);
		for (const [index, node] of nodes.entries()) {
			await expect
				.poll(async () => {
					const colors = await nodeColors(node);
					return {
						changed: colors.actual !== fills[index],
						matchesHost: colors.actual === colors.expected,
					};
				})
				.toEqual({ changed: true, matchesHost: true });
		}
		await expect(page.getByTestId("mermaid-error")).toHaveCount(0);
	} finally {
		await pickTheme(page, current.id);
	}
});

test("malformed historical tool diagrams and chat fences fall back to plain source", async ({
	page,
}) => {
	const card = await openVisualization(
		page,
		"malformed diagrams",
		{ type: "diagram", mermaid: MALFORMED_SOURCE },
		`\`\`\`mermaid\n${MALFORMED_SOURCE}\n\`\`\``,
	);
	const assistant = page.locator('[data-testid="chat-message"][data-role="assistant"]');
	for (const surface of [card, assistant]) {
		const fallback = surface.getByTestId("mermaid-error");
		await expect(fallback).toBeVisible({ timeout: 20_000 });
		await expect(fallback).toContainText("Diagram failed to render:");
		await expect(fallback.locator("pre")).toHaveText(MALFORMED_SOURCE);
		await expect(fallback.locator("pre > *")).toHaveCount(0);
		await expect(fallback.locator("pre.shiki")).toHaveCount(0);
		await expect(surface.getByTestId("mermaid-svg")).toHaveCount(0);
		await expect(surface.getByTestId("mermaid-fullscreen")).toHaveCount(0);
	}
});

test("a file visualization renders the workspace file with the diff-review renderer", async ({
	page,
}) => {
	const cleanup = writeMockups({ "settings.html": mockupHtml("Save settings") });
	try {
		const card = await openVisualization(page, "file preview", {
			type: "file",
			title: "Settings mockup",
			path: `${MOCKUP_DIR}/settings.html`,
		});
		const file = card.getByTestId("tool-visualize-file");
		await expect(file).toContainText("Settings mockup");
		await expect(file.getByTestId("tool-visualize-file-link")).toHaveText(
			`${MOCKUP_DIR}/settings.html`,
		);
		const preview = file.getByTestId("resource-preview");
		await expect(preview).toBeVisible();
		await expect(preview.getByTestId("view-toggle-html")).toHaveAttribute("data-active", "true");
		await expect(preview.getByTestId("html-disabled-notice")).toContainText(
			"Scripts and external resources are disabled",
		);
		await expect(preview.frameLocator("iframe").getByText("Save settings")).toBeVisible();

		await preview.getByTestId("view-toggle-code").click();
		await expect(preview.getByTestId("view-toggle-code")).toHaveAttribute("data-active", "true");
		await expect(preview).toContainText("Save settings");
	} finally {
		cleanup();
	}
});

test("a file visualization with a before path shows the renderer's before/after diff", async ({
	page,
}) => {
	const cleanup = writeMockups({
		"before.html": mockupHtml("Save"),
		"after.html": mockupHtml("Save settings"),
	});
	try {
		const card = await openVisualization(page, "file diff", {
			type: "file",
			path: `${MOCKUP_DIR}/after.html`,
			before: `${MOCKUP_DIR}/before.html`,
		});
		await expect(card.getByTestId("tool-card-toggle")).toContainText(
			`${MOCKUP_DIR}/before.html → ${MOCKUP_DIR}/after.html`,
		);
		const diff = card.getByTestId("resource-preview-diff");
		await expect(diff).toBeVisible();
		const frames = diff.locator("iframe");
		await expect(frames).toHaveCount(2);
		await expect(frames.nth(0)).toHaveAttribute("srcdoc", /<span class="cta">Save<\/span>/);
		await expect(frames.nth(1)).toHaveAttribute(
			"srcdoc",
			/<span class="cta">Save settings<\/span>/,
		);
	} finally {
		cleanup();
	}
});

test("review comments on a visualized file are sent into the chat that shows it", async ({
	page,
}) => {
	const sends: { method: string; sessionId?: string }[] = [];
	page.on("websocket", (socket) =>
		socket.on("framesent", ({ payload }) => {
			const frame = JSON.parse(String(payload)) as {
				method?: string;
				params?: { sessionId?: string };
			};
			if (frame.method === "review.sendBatch" || frame.method === "review.sendComment") {
				sends.push({
					method: frame.method,
					...(frame.params?.sessionId ? { sessionId: frame.params.sessionId } : {}),
				});
			}
		}),
	);
	const cleanup = writeMockups({
		"shape.svg":
			'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect x="10" y="10" width="80" height="80" fill="#3b82f6"/></svg>',
	});
	try {
		const { card, sessionId } = await openVisualizationSession(page, "file comments", {
			type: "file",
			path: `${MOCKUP_DIR}/shape.svg`,
		});
		const surface = card.getByTestId("svg-region-surface");
		await expect(surface).toBeVisible();
		await surface.scrollIntoViewIfNeeded();
		const box = await surface.boundingBox();
		const view = await card.getByTestId("resource-preview").boundingBox();
		const transcript = await page.getByTestId("chat-transcript-scroll").boundingBox();
		if (!box || !view || !transcript) throw new Error("No SVG surface geometry");
		const top = Math.max(box.y, view.y, transcript.y) + 40;
		await page.mouse.move(box.x + box.width * 0.25, top);
		await page.mouse.down();
		await page.mouse.move(box.x + box.width * 0.75, top + 80, { steps: 6 });
		await page.mouse.up();
		await page.locator('[data-testid="review-add-icon"]:visible').click();
		await page.getByTestId("review-composer-input").fill("Make this square smaller.");
		await page.getByTestId("review-composer-save").click();
		await expect(card.getByTestId("review-thread-card")).toHaveCount(1);

		const send = card.getByTestId("send-review-button");
		await expect(send).toHaveText(/Send review \(1\)/);
		await send.click();
		await expect.poll(() => sends).toEqual([{ method: "review.sendBatch", sessionId }]);
	} finally {
		cleanup();
	}
});

test("a file preview fits HTML to a design width and opens full screen and in a tab", async ({
	page,
}) => {
	const cleanup = writeMockups({ "wide.html": mockupHtml("Save settings") });
	try {
		const card = await openVisualization(page, "file actions", {
			type: "file",
			path: `${MOCKUP_DIR}/wide.html`,
		});
		const preview = card.getByTestId("resource-preview");
		const frame = preview.getByTestId("html-frame-box");
		await expect(frame).toHaveAttribute("data-viewport", "desktop");
		expect(Number(await frame.getAttribute("data-scale"))).toBeLessThan(1);
		await preview.getByTestId("html-viewport-phone").click();
		await expect(frame).toHaveAttribute("data-viewport", "phone");
		await expect(frame).toHaveAttribute("data-scale", "1.000");
		await page.screenshot({ path: test.info().outputPath("card.png") });

		await preview.getByTestId("tool-visualize-fullscreen").click();
		const dialog = page.getByTestId("tool-visualize-fullscreen-dialog");
		await expect(dialog).toBeVisible();
		await expect(dialog.getByTestId("resource-preview")).toBeVisible();
		await expect(dialog.frameLocator("iframe").getByText("Save settings")).toBeVisible();
		await page.screenshot({ path: test.info().outputPath("fullscreen.png") });
		await page.keyboard.press("Escape");
		await expect(dialog).toBeHidden();

		await preview.getByTestId("tool-visualize-open-tab").click();
		await expect(
			page.locator('[data-testid="editor-tab"][data-kind="file"]').filter({ hasText: "wide.html" }),
		).toBeVisible();
		await expect(page.getByTestId("html-view").last()).toBeVisible();
	} finally {
		cleanup();
	}
});

test("closing a full-screen code preview keeps the card's editor showing the file", async ({
	page,
}) => {
	const cleanup = writeMockups({ "sample.ts": "export const cardGreeting = 1;\n" });
	try {
		const card = await openVisualization(page, "code preview", {
			type: "file",
			path: `${MOCKUP_DIR}/sample.ts`,
		});
		const lines = card.getByTestId("resource-preview").locator(".monaco-editor .view-lines");
		await expect(lines).toContainText("cardGreeting");

		await card.getByTestId("tool-visualize-fullscreen").click();
		const dialog = page.getByTestId("tool-visualize-fullscreen-dialog");
		await expect(dialog.locator(".monaco-editor .view-lines")).toContainText("cardGreeting");
		await page.keyboard.press("Escape");
		await expect(dialog).toBeHidden();

		await expect(lines).toContainText("cardGreeting");
	} finally {
		cleanup();
	}
});

test("a before/after preview opens as a diff tab over the two files that survives a reload", async ({
	page,
}) => {
	const cleanup = writeMockups({
		"before.html": mockupHtml("Save"),
		"after.html": mockupHtml("Save settings"),
	});
	try {
		const card = await openVisualization(page, "file compare tab", {
			type: "file",
			path: `${MOCKUP_DIR}/after.html`,
			before: `${MOCKUP_DIR}/before.html`,
		});
		const diff = card.getByTestId("resource-preview-diff");
		await diff.getByTestId("tool-visualize-fullscreen").click();
		const dialog = page.getByTestId("tool-visualize-fullscreen-dialog");
		await expect(dialog.getByTestId("resource-preview-diff").locator("iframe")).toHaveCount(2);
		await page.screenshot({ path: test.info().outputPath("diff-fullscreen.png") });
		await page.keyboard.press("Escape");

		await diff.getByTestId("tool-visualize-open-tab").click();
		const tab = page
			.locator('[data-testid="editor-tab"][data-kind="diff"]')
			.filter({ hasText: "before.html → after.html" });
		await expect(tab).toBeVisible();
		const pane = page.locator('[data-testid="diff-pane"][data-compare]');
		await expect(pane.getByTestId("diff-path")).toHaveText(
			`${MOCKUP_DIR}/before.html → ${MOCKUP_DIR}/after.html`,
		);
		await expect(pane.locator("iframe")).toHaveCount(2);
		await page.screenshot({ path: test.info().outputPath("diff-tab.png") });

		await page.reload();
		await expect(tab).toBeVisible();
		await tab.click();
		await expect(
			page.locator('[data-testid="diff-pane"][data-compare]').locator("iframe"),
		).toHaveCount(2);
	} finally {
		cleanup();
	}
});

test("an HTML preview width is shared by the card and its full screen and survives a comparison tab switch", async ({
	page,
}) => {
	const cleanup = writeMockups({
		"before.html": mockupHtml("Save"),
		"after.html": mockupHtml("Save settings"),
	});
	try {
		const card = await openVisualization(page, "file widths", {
			type: "file",
			path: `${MOCKUP_DIR}/after.html`,
			before: `${MOCKUP_DIR}/before.html`,
		});
		const diff = card.getByTestId("resource-preview-diff");
		await diff.getByTestId("html-viewport-phone").click();
		await diff.getByTestId("tool-visualize-fullscreen").click();
		const dialog = page.getByTestId("tool-visualize-fullscreen-dialog");
		await expect(dialog.getByTestId("html-frame-box").first()).toHaveAttribute(
			"data-viewport",
			"phone",
		);
		await dialog.getByTestId("html-viewport-tablet").click();
		await page.keyboard.press("Escape");
		await expect(dialog).toBeHidden();
		await expect(diff.getByTestId("html-frame-box").first()).toHaveAttribute(
			"data-viewport",
			"tablet",
		);

		await diff.getByTestId("tool-visualize-open-tab").click();
		const pane = page.locator('[data-testid="diff-pane"][data-compare]');
		await pane.getByTestId("html-viewport-tablet").click();
		await expect(pane.getByTestId("html-frame-box").first()).toHaveAttribute(
			"data-viewport",
			"tablet",
		);
		await page.locator('[data-testid="editor-tab"][data-kind="chat"]').first().click();
		await expect(pane).toHaveCount(0);
		await page
			.locator('[data-testid="editor-tab"][data-kind="diff"]')
			.filter({ hasText: "before.html → after.html" })
			.click();
		await expect(pane.getByTestId("html-frame-box").first()).toHaveAttribute(
			"data-viewport",
			"tablet",
		);
	} finally {
		cleanup();
	}
});

test("a huge before/after comparison waits behind the expensive-diff notice", async ({ page }) => {
	const lines = (mark: string) =>
		`${Array.from({ length: 3_000 }, (_, index) => `${mark} line ${index + 1}`).join("\n")}\n`;
	const cleanup = writeMockups({
		"huge-before.txt": lines("before"),
		"huge-after.txt": lines("after"),
	});
	try {
		const card = await openVisualization(page, "huge comparison", {
			type: "file",
			path: `${MOCKUP_DIR}/huge-after.txt`,
			before: `${MOCKUP_DIR}/huge-before.txt`,
		});
		const diff = card.getByTestId("resource-preview-diff");
		await expect(diff.getByTestId("diff-too-large")).toBeVisible();
		await diff.getByTestId("diff-show-anyway").click();
		await expect(diff.getByTestId("diff-too-large")).toHaveCount(0);
		const diffView = diff.getByTestId("diff-view");
		await expect(pierreLines(diffView, "before line 1").first()).toBeVisible({ timeout: 20_000 });
		expect(await pierreLines(diffView).count()).toBeLessThan(1_000);
	} finally {
		cleanup();
	}
});

test("a dot-relative mockup path still refreshes live when the file changes", async ({ page }) => {
	const cleanup = writeMockups({ "live.html": mockupHtml("First draft") });
	try {
		const card = await openVisualization(page, "dot path", {
			type: "file",
			path: `./${MOCKUP_DIR}/live.html`,
		});
		const frame = card.getByTestId("resource-preview").frameLocator("iframe");
		await expect(frame.getByText("First draft")).toBeVisible();
		writeFileSync(join(E2E_FIXTURE_REPO, MOCKUP_DIR, "live.html"), mockupHtml("Second draft"));
		await expect(frame.getByText("Second draft")).toBeVisible({ timeout: 15_000 });
	} finally {
		cleanup();
	}
});

test("a mockup deleted under its card keeps the last version, marked as stale", async ({
	page,
}) => {
	const cleanup = writeMockups({ "gone.html": mockupHtml("Last proposal") });
	try {
		const card = await openVisualization(page, "deleted mockup", {
			type: "file",
			path: `${MOCKUP_DIR}/gone.html`,
		});
		const preview = card.getByTestId("resource-preview");
		await expect(preview.frameLocator("iframe").getByText("Last proposal")).toBeVisible();
		rmSync(join(E2E_FIXTURE_REPO, MOCKUP_DIR, "gone.html"));
		await expect(preview.getByTestId("resource-preview-stale")).toContainText(
			`Couldn't refresh ${MOCKUP_DIR}/gone.html`,
			{ timeout: 15_000 },
		);
		await expect(preview.frameLocator("iframe").getByText("Last proposal")).toBeVisible();
	} finally {
		cleanup();
	}
});

test("a markdown comparison resolves each side's images against its own file", async ({ page }) => {
	const cleanup = writeMockups({
		"before/doc.md": "# Flow\n\n![diagram](picture.svg)\n\nOld text.\n",
		"after/doc.md": "# Flow\n\n![diagram](picture.svg)\n\nNew text.\n",
	});
	try {
		const card = await openVisualization(page, "markdown comparison", {
			type: "file",
			path: `${MOCKUP_DIR}/after/doc.md`,
			before: `${MOCKUP_DIR}/before/doc.md`,
		});
		const rendered = card.getByTestId("rendered-diff");
		await expect(rendered.locator("ins").filter({ hasText: "New" }).first()).toBeVisible();
		const sources = await rendered
			.locator("img")
			.evaluateAll((images) => images.map((image) => image.getAttribute("src") ?? ""));
		expect(sources.some((src) => src.includes("/before/picture.svg"))).toBe(true);
		expect(sources.some((src) => src.includes("/after/picture.svg"))).toBe(true);
	} finally {
		cleanup();
	}
});
