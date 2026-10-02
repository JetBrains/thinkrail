import { realpathSync } from "node:fs";
import { expect, type Locator, type Page, test } from "@playwright/test";
import { enterDefaultWorkspace, openFixtureProject, openPersistedChat } from "./fixtures/app";
import { E2E_FIXTURE_REPO } from "./fixtures/paths";
import { seedWorkspaceSession } from "./fixtures/sessions";

const BASE_TS = 1_700_920_000_000;
const MALFORMED_SOURCE = "flowchart TD; Start --> --> broken";

async function openVisualization(
	page: Page,
	name: string,
	args: Record<string, unknown>,
	assistantText?: string,
): Promise<Locator> {
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
	seedWorkspaceSession(realpathSync(E2E_FIXTURE_REPO), { name, messages });
	await enterDefaultWorkspace(page);
	await openPersistedChat(page, name);
	const card = page.locator('[data-testid="tool-card"][data-tool="visualize"]');
	await expect(card).toHaveCount(1);
	await expect(card).toBeVisible();
	await expect(card).toHaveAttribute("data-status", "done");
	await expect(card).toHaveAttribute("data-expanded", "true");
	await expect(card.getByTestId("tool-visualize")).toHaveAttribute("data-status", "done");
	return card;
}

async function openAppearance(page: Page): Promise<Locator> {
	await page.getByTestId("open-settings").click();
	const dialog = page.getByTestId("settings-dialog");
	await expect(dialog).toBeVisible();
	await page.getByTestId("settings-nav-appearance").click();
	await expect(dialog).toContainText("Theme");
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
