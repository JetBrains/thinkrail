import { expect, test } from "@playwright/test";
import { createWorkspaceViaDialog, openFixtureProject } from "./fixtures/app";

// Tagged @agent (see agent.live.spec.ts): excluded from the default `bun run e2e`; run via
// `bun run e2e:agent`. These exercise the Composer + cheap wins against a REAL pi agent + pi's
// default auth, since the model list and a session both need a working provider.

/** Create a workspace, open a chat tab in it, and wait for the composer to mount. */
async function openChat(page: import("@playwright/test").Page): Promise<void> {
	await openFixtureProject(page);
	await createWorkspaceViaDialog(page);
	await expect(page.getByTestId("workspace-item").first()).toHaveAttribute("data-active", "true");
	await page.getByTestId("start-chat").click();
	await expect(page.locator('[data-testid="editor-tab"][data-kind="chat"]')).toHaveCount(1);
	await expect(page.getByTestId("chat-input")).toBeVisible();
}

test("composer prompt is moderately tall with model and effort controls underneath", {
	tag: "@agent",
}, async ({ page }) => {
	await openChat(page);

	const input = page.getByTestId("chat-input");
	const modelSelector = page.getByTestId("model-selector");
	const effortSelector = page.getByTestId("thinking-selector");
	const send = page.getByTestId("chat-send");

	await expect(input).toBeVisible();
	await expect(modelSelector).toBeVisible();
	await expect(effortSelector).toBeVisible();
	await expect(send).toBeVisible();

	const inputBox = await input.boundingBox();
	const modelBox = await modelSelector.boundingBox();
	const effortBox = await effortSelector.boundingBox();
	const sendBox = await send.boundingBox();
	if (!inputBox || !modelBox || !effortBox || !sendBox) {
		throw new Error("Composer layout boxes were not measurable");
	}

	// Four rows is intentionally ~2/3 of the New-Workspace prompt height — roomy, but not as tall as the dialog hero.
	expect(inputBox.height).toBeGreaterThanOrEqual(100);
	expect(inputBox.height).toBeLessThanOrEqual(130);
	const belowInputY = inputBox.y + inputBox.height;
	expect(modelBox.y).toBeGreaterThanOrEqual(belowInputY);
	expect(effortBox.y).toBeGreaterThanOrEqual(belowInputY);
	expect(sendBox.y).toBeGreaterThanOrEqual(belowInputY);
});

test("model picker plus file and portable-skill completion use the live session catalog", {
	tag: "@agent",
}, async ({ page }) => {
	await openChat(page);

	// Cheap win #1 — the model selector populates from `model.list` once auth-backed models load.
	const modelSelector = page.getByTestId("model-selector");
	await expect(modelSelector).toBeEnabled();
	await modelSelector.click();
	await expect(page.getByTestId("model-option").first()).toBeVisible();
	expect(await page.getByTestId("model-option").count()).toBeGreaterThan(0);
	// Close WITHOUT selecting: a real pick calls `session.setModel`, which pi persists as the *default*
	// model — pinning the first-listed (possibly deprecated) model would break later turns this run.
	await page.keyboard.press("Escape");
	await expect(page.getByTestId("model-option")).toHaveCount(0);

	// The thinking-level picker is the honest effort knob.
	await expect(page.getByTestId("thinking-selector")).toBeVisible();

	// Cheap win #3 — the stats bar renders (token/cost) as soon as the session reports stats.
	await expect(page.getByTestId("session-stats")).toBeVisible();
	await expect(page.getByTestId("session-stats")).toContainText(/tok/);

	// The worktree session is authoritative and discovers the fixture's Claude-compatible project alias.
	const input = page.getByTestId("chat-input");
	await input.fill("/e2e");
	const portableSkill = page
		.getByTestId("slash-command")
		.filter({ hasText: "/skill:e2e-portable" });
	await expect(portableSkill).toBeVisible();
	await expect(portableSkill).toContainText("skill/project");
	await input.press("Tab");
	await expect(input).toHaveValue("/skill:e2e-portable ");
	// Selection restores focus/caret on the next animation frame; let that settle before replacing the value.
	await input.evaluate(
		() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
	);

	// Composer @-mention: typing `@RE` lists the worktree's README.md and picking it inserts the path.
	await input.fill("@RE");
	const mention = page.getByTestId("mention-item").filter({ hasText: "README.md" });
	await expect(mention).toBeVisible();
	await mention.click();
	await expect(input).toHaveValue(/@README\.md/);
});

test("stats refresh after a turn completes (cheap win #3)", { tag: "@agent" }, async ({ page }) => {
	test.setTimeout(90_000);
	await openChat(page);

	await page.getByTestId("chat-input").fill("Reply with the single word: pong");
	await page.getByTestId("chat-send").click();

	// Key off turn *completion* (the agent_end notice), not model output — the stats refresh hangs off
	// `agent_end`, and the env's default model may vary. The stats bar stays mounted with token/cost.
	await expect(
		page.locator('[data-testid="chat-message"][data-role="system"]').filter({ hasText: "Done" }),
	).toBeVisible({ timeout: 80_000 });
	await expect(page.getByTestId("session-stats")).toBeVisible();
	await expect(page.getByTestId("session-stats")).toContainText(/tok/);
});
