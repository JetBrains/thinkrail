import { realpathSync } from "node:fs";
import { expect, test } from "@playwright/test";
import {
	defaultWorkspaceRow,
	enterDefaultWorkspace,
	openChatFromHistory,
	openFixtureProject,
} from "./fixtures/app";
import { E2E_FIXTURE_REPO } from "./fixtures/paths";
import { seedWorkspaceSession } from "./fixtures/sessions";

const BASE_TS = 1_700_910_000_000;

// A plain user message comfortably over the 500-char collapse threshold.
const LARGE_TEXT = `Please refactor the transport layer. ${"Investigate the reconnect path and reducer ordering carefully. ".repeat(
	12,
)}`;
const SHORT_TEXT = "Quick question: does the reducer append or replace?";

test("a large user message with an agent reply collapses, and Show more re-expands it", async ({
	page,
}) => {
	expect(LARGE_TEXT.length).toBeGreaterThan(500);
	await openFixtureProject(page); // resets state — seed after
	seedWorkspaceSession(realpathSync(E2E_FIXTURE_REPO), {
		name: "large message chat",
		messages: [
			{ role: "user", text: LARGE_TEXT, timestamp: BASE_TS },
			{ role: "assistant", text: "On it — starting with the reducer.", timestamp: BASE_TS + 1_000 },
		],
	});

	await expect(defaultWorkspaceRow(page)).toBeVisible();
	await enterDefaultWorkspace(page);
	await openChatFromHistory(page, "large message chat");

	const body = page.getByTestId("user-message-body");
	const toggle = page.getByTestId("user-message-toggle");
	// Agent has replied, so the large message is collapsed by default.
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
	await openChatFromHistory(page, "unanswered large message chat");

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
	await openChatFromHistory(page, "short message chat");

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
	await openChatFromHistory(page, "intermediate vs final chat");

	const assistantMessages = page.locator('[data-testid="chat-message"][data-role="assistant"]');
	await expect(assistantMessages).toHaveCount(2);
	const intermediate = assistantMessages.filter({ hasText: "let me inspect" });
	const final = assistantMessages.filter({ hasText: "Done — I refactored" });
	// The intermediate narration has no copy affordance at all; only the concluding answer does.
	await expect(intermediate.getByTestId("chat-copy")).toHaveCount(0);
	await expect(final.getByTestId("chat-copy")).toHaveCount(1);
});

test("the copy action sits 2px below the content, consistent for agent and user messages", async ({
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
	await openChatFromHistory(page, "copy spacing chat");

	const userMessage = page.locator('[data-testid="chat-message"][data-role="user"]');
	const assistantMessage = page.locator('[data-testid="chat-message"][data-role="assistant"]');
	await expect(assistantMessage).toBeVisible();

	// The shared copy-action gap is exactly 2px on both roles (single source of truth in MessageWithCopy).
	const gapOf = (loc: import("@playwright/test").Locator) =>
		loc.evaluate((el) => getComputedStyle(el).rowGap);
	await expect.poll(() => gapOf(userMessage)).toBe("2px");
	await expect.poll(() => gapOf(assistantMessage)).toBe("2px");

	// The agent answer ends flush: its last markdown block carries no trailing bottom margin, so the copy
	// action is not pushed farther away than on a user bubble.
	const lastBlockMb = await assistantMessage
		.locator("[data-testid='chat-copy']")
		.evaluate((copy) => {
			const content = copy.previousElementSibling;
			const block = content?.firstElementChild?.lastElementChild;
			return block ? getComputedStyle(block).marginBottom : null;
		});
	expect(lastBlockMb).toBe("0px");
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
	await openChatFromHistory(page, "copy chat");

	// User copy — full source, not the collapsed preview.
	const userMessage = page.locator('[data-testid="chat-message"][data-role="user"]');
	await userMessage.hover();
	await userMessage.getByTestId("chat-copy").click();
	await expect(async () => {
		expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(LARGE_TEXT);
	}).toPass();

	// Agent copy — the markdown source.
	const assistantMessage = page.locator('[data-testid="chat-message"][data-role="assistant"]');
	await assistantMessage.hover();
	await assistantMessage.getByTestId("chat-copy").click();
	await expect(async () => {
		expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
			"Here is the **plan** with `code`.",
		);
	}).toPass();
});
