import { realpathSync } from "node:fs";
import { expect, type Locator, type Page, test } from "@playwright/test";
import {
	enterDefaultWorkspace,
	expandDisclosure,
	openFixtureProject,
	openPersistedChat,
} from "./fixtures/app";
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

const LOGIN_MOCKUP = `<!doctype html><html><head><style>
body{margin:0;font-family:sans-serif;background:#f4f4f5}
.card{margin:40px auto;width:320px;padding:24px;background:white;border-radius:12px}
.card button:hover{background:#4338ca}
</style></head><body><div class="card"><img src="logo.png" width="24" height="24" alt="fixture-logo">
<h1>Sign in</h1><form><input autofocus placeholder="Email"><button type="submit">Continue</button></form>
<a href="https://attacker.invalid">Forgot password?</a><script>document.body.dataset.ran = "yes"</script></div></body></html>`;

test("a mockup renders static HTML with workspace assets, viewport and source toggles, and fullscreen", async ({
	page,
}) => {
	const card = await openVisualization(page, "single mockup", {
		type: "mockup",
		title: "Sign-in screen",
		html: LOGIN_MOCKUP,
		viewport: "phone",
	});
	const mockup = card.getByTestId("tool-visualize-mockup");
	await expect(mockup.getByText("Sign-in screen", { exact: true })).toBeVisible();
	const box = mockup.getByTestId("mockup-frame-box");
	await expect(box).toHaveAttribute("data-viewport", "phone");
	const frame = mockup.frameLocator("iframe");
	await expect(frame.getByRole("heading", { name: "Sign in" })).toBeVisible();
	await expect(frame.getByPlaceholder("Email")).toBeVisible();
	await expect(frame.getByRole("button", { name: "Continue" })).toBeVisible();
	const logo = frame.getByAltText("fixture-logo");
	await expect(logo).toHaveAttribute("src", /^data:image\/png;base64,/);
	await expect.poll(() => logo.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(1);
	expect(await frame.locator("body").getAttribute("data-ran")).toBeNull();
	expect(await frame.locator("script").count()).toBe(0);
	expect(await frame.locator("[autofocus]").count()).toBe(0);
	await expect(mockup.locator("iframe")).toHaveAttribute("sandbox", "allow-same-origin");

	const frameWidth = () =>
		mockup.locator("iframe").evaluate((element) => element.getBoundingClientRect().width);
	const phoneWidth = await frameWidth();
	await mockup.getByTestId("mockup-viewport").locator('[data-value="desktop"]').click();
	await expect(box).toHaveAttribute("data-viewport", "desktop");
	await expect
		.poll(async () => (await frameWidth()) <= ((await box.boundingBox())?.width ?? 0) + 1)
		.toBe(true);
	expect(phoneWidth).toBeLessThanOrEqual(391);

	await mockup.getByTestId("mockup-source-toggle").click();
	await expect(mockup.getByTestId("mockup-source")).toContainText("<h1>Sign in</h1>");
	await expect(mockup.locator("iframe")).toHaveCount(0);
	await mockup.getByTestId("mockup-source-toggle").click();
	await expect(mockup.locator("iframe")).toHaveCount(1);

	await mockup.getByTestId("mockup-fullscreen").click();
	const dialog = page.getByTestId("mockup-fullscreen-dialog");
	await expect(dialog.getByRole("heading", { name: "Sign-in screen" })).toBeVisible();
	await expect(
		dialog.frameLocator("iframe").getByRole("heading", { name: "Sign in" }),
	).toBeVisible();
	await page.keyboard.press("Escape");
	await expect(dialog).toBeHidden();
});

test("a before/after mockup defaults to After, switches inline, and goes side by side when wide", async ({
	page,
}) => {
	const card = await openVisualization(page, "before after mockup", {
		type: "mockup",
		title: "Toolbar",
		before: "<nav><b>OLD_TOOLBAR</b></nav>",
		after: "<nav><b>NEW_TOOLBAR</b></nav>",
	});
	const mockup = card.getByTestId("tool-visualize-mockup");
	const version = mockup.getByTestId("mockup-version");
	await expect(version.locator('[aria-pressed="true"]')).toHaveText("After");
	await expect(mockup.frameLocator("iframe").getByText("NEW_TOOLBAR")).toBeVisible();
	await version.getByText("Before", { exact: true }).click();
	await expect(mockup.frameLocator("iframe").getByText("OLD_TOOLBAR")).toBeVisible();

	await page.setViewportSize({ width: 1440, height: 900 });
	await mockup.getByTestId("mockup-fullscreen").click();
	const dialog = page.getByTestId("mockup-fullscreen-dialog");
	const body = dialog.getByTestId("mockup-fullscreen-body");
	await expect(body).toHaveAttribute("data-layout", "side-by-side");
	await expect(body.locator("iframe")).toHaveCount(2);
	await expect(dialog.getByTestId("mockup-version")).toHaveCount(0);
	await page.keyboard.press("Escape");

	await page.setViewportSize({ width: 820, height: 900 });
	await mockup.getByTestId("mockup-fullscreen").click();
	await expect(body).toHaveAttribute("data-layout", "single");
	await expect(body.locator("iframe")).toHaveCount(1);
	await expect(dialog.getByTestId("mockup-version")).toBeVisible();
	await page.keyboard.press("Escape");
});

test("comparison options carry their own mockups and assistant mockup fences render", async ({
	page,
}) => {
	const card = await openVisualization(
		page,
		"comparison mockups",
		{
			type: "comparison",
			title: "Header layout",
			options: [
				{ name: "Tabs", html: "<div>OPTION_TABS</div>", recommended: true },
				{ name: "Menu", html: "<div>OPTION_MENU</div>" },
			],
		},
		"Here is the empty state:\n\n```mockup\n<section><h2>FENCE_EMPTY_STATE</h2><button>Create</button></section>\n```",
	);
	const comparison = card.getByTestId("tool-visualize-comparison");
	const views = comparison.getByTestId("mockup-view");
	await expect(views).toHaveCount(2);
	await expect(views.nth(0).frameLocator("iframe").getByText("OPTION_TABS")).toBeVisible();
	await expect(views.nth(1).frameLocator("iframe").getByText("OPTION_MENU")).toBeVisible();

	const assistant = page.locator('[data-testid="chat-message"][data-role="assistant"]').last();
	const fence = assistant.getByTestId("markdown-mockup");
	await expect(fence).toBeVisible({ timeout: 10_000 });
	await expect(
		fence.frameLocator("iframe").getByRole("heading", { name: "FENCE_EMPTY_STATE" }),
	).toBeVisible();
	await expect(fence.frameLocator("iframe").getByRole("button", { name: "Create" })).toBeVisible();
});

test("a mockup's HTML source stays inside a comparison card and wraps long lines", async ({
	page,
}) => {
	const oneLine = `<style>.e{display:flex;flex-direction:column;align-items:center;padding:48px;font-family:system-ui;color:#3f3f46}</style><div class="e"><h2>No projects yet</h2><p>${"Open a local folder or clone a repository to start. ".repeat(12)}</p><button>Open project</button></div>`;
	const card = await openVisualization(page, "comparison source width", {
		type: "comparison",
		title: "Empty state",
		options: [
			{ name: "Centered", html: oneLine },
			{ name: "Split", html: oneLine.replace("No projects yet", "Split") },
		],
	});
	const comparison = card.getByTestId("tool-visualize-comparison");
	const option = comparison.getByTestId("mockup-view").first();
	const cardWidth = async () => (await comparison.boundingBox())?.width ?? 0;
	const before = await cardWidth();
	await option.getByTestId("mockup-source-toggle").click();
	const source = option.getByTestId("mockup-source");
	await expect(source).toContainText("No projects yet");
	expect(await cardWidth()).toBeLessThanOrEqual(before + 1);
	expect((await source.boundingBox())?.width ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(
		before,
	);
	expect(await source.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
});
