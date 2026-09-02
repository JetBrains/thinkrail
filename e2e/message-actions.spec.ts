import { realpathSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { defaultWorkspaceRow, enterDefaultWorkspace, openFixtureProject } from "./fixtures/app";
import { E2E_FIXTURE_REPO } from "./fixtures/paths";
import { seedWorkspaceSession } from "./fixtures/sessions";

const BASE_TS = 1_700_910_000_000;

const LARGE_TEXT = `Please refactor the transport layer. ${"Investigate the reconnect path and reducer ordering carefully. ".repeat(
	12,
)}`;
const SHORT_TEXT = "Quick question: does the reducer append or replace?";

type Box = { x: number; y: number; width: number; height: number };

function boxBottom(box: Box): number {
	return box.y + box.height;
}

function expectContained(inner: Box, outer: Box): void {
	expect(inner.x).toBeGreaterThanOrEqual(outer.x - 1);
	expect(inner.y).toBeGreaterThanOrEqual(outer.y - 1);
	expect(inner.x + inner.width).toBeLessThanOrEqual(outer.x + outer.width + 1);
	expect(boxBottom(inner)).toBeLessThanOrEqual(boxBottom(outer) + 1);
}

test("a large user message with an agent reply collapses, and Show more re-expands it", async ({
	page,
}) => {
	expect(LARGE_TEXT.length).toBeGreaterThan(500);
	await openFixtureProject(page);
	seedWorkspaceSession(realpathSync(E2E_FIXTURE_REPO), {
		name: "large message chat",
		messages: [
			{ role: "user", text: LARGE_TEXT, timestamp: BASE_TS },
			{ role: "assistant", text: "On it — starting with the reducer.", timestamp: BASE_TS + 1_000 },
		],
	});

	await expect(defaultWorkspaceRow(page)).toBeVisible();
	await enterDefaultWorkspace(page);
	await expect(page.locator('[data-testid="editor-tab"][data-kind="chat"]')).toHaveCount(1);

	const body = page.getByTestId("user-message-body");
	const toggle = page.getByTestId("user-message-toggle");
	await expect(body).toHaveAttribute("data-collapsed", "true");
	await expect(toggle).toHaveText("Show more");

	await toggle.click();
	await expect(body).not.toHaveAttribute("data-collapsed", "true");
	await expect(toggle).toHaveText("Show less");
	await expect(body).toContainText("Please refactor the transport layer.");

	await toggle.click();
	await expect(body).toHaveAttribute("data-collapsed", "true");
});

test("a large user message with no agent reply stays expanded", async ({ page }) => {
	await openFixtureProject(page);
	seedWorkspaceSession(realpathSync(E2E_FIXTURE_REPO), {
		name: "unanswered large message chat",
		messages: [{ role: "user", text: LARGE_TEXT, timestamp: BASE_TS }],
	});

	await expect(defaultWorkspaceRow(page)).toBeVisible();
	await enterDefaultWorkspace(page);
	await expect(page.locator('[data-testid="editor-tab"][data-kind="chat"]')).toHaveCount(1);

	const body = page.getByTestId("user-message-body");
	await expect(body).toBeVisible();
	await expect(body).not.toHaveAttribute("data-collapsed", "true");
	await expect(page.getByTestId("user-message-toggle")).toHaveText("Show less");
});

test("a short user message has no collapse controls", async ({ page }) => {
	await openFixtureProject(page);
	seedWorkspaceSession(realpathSync(E2E_FIXTURE_REPO), {
		name: "short message chat",
		messages: [
			{ role: "user", text: SHORT_TEXT, timestamp: BASE_TS },
			{ role: "assistant", text: "It appends.", timestamp: BASE_TS + 1_000 },
		],
	});

	await expect(defaultWorkspaceRow(page)).toBeVisible();
	await enterDefaultWorkspace(page);
	await expect(page.locator('[data-testid="editor-tab"][data-kind="chat"]')).toHaveCount(1);

	const body = page.getByTestId("user-message-body");
	await expect(body).toBeVisible();
	await expect(body).not.toHaveAttribute("data-collapsed", "true");
	await expect(page.getByTestId("user-message-toggle")).toHaveCount(0);
});

test("only the round's final agent answer carries a copy action, not intermediate narration", async ({
	page,
}) => {
	await openFixtureProject(page);
	seedWorkspaceSession(realpathSync(E2E_FIXTURE_REPO), {
		name: "intermediate vs final chat",
		messages: [
			{ role: "user", text: "refactor the module", timestamp: BASE_TS },
			{ role: "assistant", text: "First, let me inspect the files.", timestamp: BASE_TS + 1_000 },
			{
				role: "assistant",
				text: "Done — I refactored the module and updated its tests.",
				timestamp: BASE_TS + 2_000,
			},
		],
	});

	await expect(defaultWorkspaceRow(page)).toBeVisible();
	await enterDefaultWorkspace(page);
	await expect(page.locator('[data-testid="editor-tab"][data-kind="chat"]')).toHaveCount(1);

	const assistantMessages = page.locator('[data-testid="chat-message"][data-role="assistant"]');
	await expect(assistantMessages).toHaveCount(2);
	const intermediate = assistantMessages.filter({ hasText: "let me inspect" });
	const final = assistantMessages.filter({ hasText: "Done — I refactored" });
	await expect(intermediate.getByTestId("chat-copy")).toHaveCount(0);
	await expect(final.getByTestId("chat-copy")).toHaveCount(1);
});

test("copy actions share the content line at the assistant left and user right without overlap", async ({
	page,
}) => {
	await openFixtureProject(page);
	seedWorkspaceSession(realpathSync(E2E_FIXTURE_REPO), {
		name: "copy spacing chat",
		messages: [
			{ role: "user", text: "Summarize the transport module.", timestamp: BASE_TS },
			{
				role: "assistant",
				text: "Reworked reconnect and made ordering deterministic.",
				timestamp: BASE_TS + 1_000,
			},
		],
	});

	await expect(defaultWorkspaceRow(page)).toBeVisible();
	await enterDefaultWorkspace(page);
	await expect(page.locator('[data-testid="editor-tab"][data-kind="chat"]')).toHaveCount(1);

	const userMessage = page.locator('[data-testid="chat-message"][data-role="user"]');
	const assistantMessage = page.locator('[data-testid="chat-message"][data-role="assistant"]');
	await expect(assistantMessage).toBeVisible();

	const [
		userBox,
		userCopyBox,
		userContentBox,
		assistantBox,
		assistantCopyBox,
		assistantContentBox,
	] = await Promise.all([
		userMessage.boundingBox(),
		userMessage.getByTestId("chat-copy").boundingBox(),
		userMessage.getByTestId("user-message-body").boundingBox(),
		assistantMessage.boundingBox(),
		assistantMessage.getByTestId("chat-copy").boundingBox(),
		assistantMessage.locator("p").last().boundingBox(),
	]);
	if (
		!userBox ||
		!userCopyBox ||
		!userContentBox ||
		!assistantBox ||
		!assistantCopyBox ||
		!assistantContentBox
	) {
		throw new Error("expected message, content, and copy-action boxes to be visible");
	}

	expectContained(assistantCopyBox, assistantBox);
	expectContained(userCopyBox, userBox);
	expect(Math.abs(assistantCopyBox.x - assistantBox.x)).toBeLessThan(2);
	expect(Math.abs(userBox.x + userBox.width - (userCopyBox.x + userCopyBox.width))).toBeLessThan(2);
	expect(assistantCopyBox.x + assistantCopyBox.width).toBeLessThanOrEqual(
		assistantContentBox.x + 1,
	);
	expect(userContentBox.x + userContentBox.width).toBeLessThanOrEqual(userCopyBox.x + 1);
	expect(Math.abs(boxBottom(assistantCopyBox) - boxBottom(assistantContentBox))).toBeLessThan(2);
	expect(Math.abs(boxBottom(userCopyBox) - boxBottom(userContentBox))).toBeLessThan(2);
});

test("copy actions copy the full source of both user and agent messages", async ({ page }) => {
	await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
	await openFixtureProject(page);
	seedWorkspaceSession(realpathSync(E2E_FIXTURE_REPO), {
		name: "copy chat",
		messages: [
			{ role: "user", text: LARGE_TEXT, timestamp: BASE_TS },
			{
				role: "assistant",
				text: "Here is the **plan** with `code`.",
				timestamp: BASE_TS + 1_000,
			},
		],
	});

	await expect(defaultWorkspaceRow(page)).toBeVisible();
	await enterDefaultWorkspace(page);
	await expect(page.locator('[data-testid="editor-tab"][data-kind="chat"]')).toHaveCount(1);

	const userMessage = page.locator('[data-testid="chat-message"][data-role="user"]');
	await userMessage.hover();
	await userMessage.getByTestId("chat-copy").click();
	await expect(async () => {
		expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(LARGE_TEXT);
	}).toPass();

	const assistantMessage = page.locator('[data-testid="chat-message"][data-role="assistant"]');
	await assistantMessage.hover();
	await assistantMessage.getByTestId("chat-copy").click();
	await expect(async () => {
		expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
			"Here is the **plan** with `code`.",
		);
	}).toPass();
});
