import { realpathSync } from "node:fs";
import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import { enterDefaultWorkspace, openFixtureProject } from "./fixtures/app";
import { E2E_FIXTURE_REPO } from "./fixtures/paths";
import { seedWorkspaceSession } from "./fixtures/sessions";

const BASE_TS = 1_700_700_000_000;

interface ClientFrame {
	id?: string;
	method?: string;
	params?: { sessionId?: string; text?: string; images?: unknown[] };
}

async function interceptTryAgain(page: Page, prompts: ClientFrame[]): Promise<void> {
	await page.routeWebSocket(/\/ws(\?|$)/, (ws) => {
		const server = ws.connectToServer();
		ws.onMessage((message) => {
			const raw = typeof message === "string" ? message : message.toString();
			let frame: ClientFrame;
			try {
				frame = JSON.parse(raw) as ClientFrame;
			} catch {
				server.send(message);
				return;
			}
			if (frame.id && frame.method === "session.prompt" && frame.params?.text === "Try again.") {
				prompts.push(frame);
				ws.send(JSON.stringify({ id: frame.id, ok: true, result: { ok: true } }));
				return;
			}
			server.send(message);
		});
		server.onMessage((message) => ws.send(message));
	});
}

test("a final agent failure offers Try again as an ordinary visible prompt", async ({ page }) => {
	const prompts: ClientFrame[] = [];
	await interceptTryAgain(page, prompts);
	await openFixtureProject(page);

	const chat = seedWorkspaceSession(realpathSync(E2E_FIXTURE_REPO), {
		name: "network failure chat",
		messages: [
			{ role: "user", text: "finish the task", timestamp: BASE_TS },
			{
				role: "assistant",
				text: "I was checking the final step",
				timestamp: BASE_TS + 1_000,
				stopReason: "error",
				errorMessage: "fetch failed",
			},
		],
	});

	await enterDefaultWorkspace(page);
	await expect(page.locator('[data-testid="editor-tab"][data-kind="chat"]')).toHaveCount(1);

	const failure = page
		.locator('[data-testid="chat-message"][data-role="error"]')
		.filter({ hasText: "fetch failed" });
	await expect(failure).toBeVisible();
	const tryAgain = failure.getByTestId("agent-try-again");
	await expect(tryAgain).toHaveText("Try again");

	await tryAgain.click();

	await expect(page.getByTestId("agent-try-again")).toHaveCount(0);
	await expect(
		page
			.locator('[data-testid="chat-message"][data-role="user"]')
			.filter({ hasText: "Try again." }),
	).toHaveCount(1);
	await expect
		.poll(() => prompts.at(-1)?.params)
		.toEqual({ sessionId: chat.id, text: "Try again." });
	expect(prompts).toHaveLength(1);
});

test("a subscription-limit failure offers the usage page and provider settings instead of Try again", async ({
	page,
}) => {
	await openFixtureProject(page);
	const errorMessage =
		'400 {"type":"error","error":{"type":"invalid_request_error","message":"Third-party apps now draw from your extra usage, not your plan limits. Add more at claude.ai/settings/usage and keep going."}}';
	seedWorkspaceSession(realpathSync(E2E_FIXTURE_REPO), {
		name: "extra usage chat",
		messages: [
			{ role: "user", text: "finish the task", timestamp: BASE_TS },
			{
				role: "assistant",
				text: "",
				timestamp: BASE_TS + 1_000,
				stopReason: "error",
				errorMessage,
			},
		],
	});

	await enterDefaultWorkspace(page);
	const failure = page
		.locator('[data-testid="chat-message"][data-role="error"]')
		.filter({ hasText: "Third-party apps now draw from your extra usage" });
	await expect(failure).toBeVisible();
	await expect(failure.getByTestId("agent-try-again")).toHaveCount(0);
	await expect(failure.getByRole("link", { name: "Manage extra usage" })).toHaveAttribute(
		"href",
		"https://claude.ai/settings/usage",
	);

	await failure.getByTestId("agent-open-provider-settings").click();
	await expect(page.getByTestId("settings-providers")).toBeVisible();
});

async function interceptFallbackRepair(
	page: Page,
	frames: ClientFrame[],
	repair: "ok" | "fail" | "not-used",
): Promise<void> {
	await page.routeWebSocket(/\/ws(\?|$)/, (ws) => {
		const server = ws.connectToServer();
		ws.onMessage((message) => {
			const raw = typeof message === "string" ? message : message.toString();
			let frame: ClientFrame;
			try {
				frame = JSON.parse(raw) as ClientFrame;
			} catch {
				server.send(message);
				return;
			}
			if (frame.id && frame.method === "session.disableServerFallback") {
				frames.push(frame);
				ws.send(
					JSON.stringify(
						repair === "ok"
							? {
									id: frame.id,
									ok: true,
									result: { provider: "anthropic", id: "claude-fable-5", name: "Claude Fable 5" },
								}
							: repair === "not-used"
								? {
										id: frame.id,
										ok: false,
										error: "The chat's model sends no fallbacks",
										errorCode: "SERVER_FALLBACK_NOT_USED",
									}
								: { id: frame.id, ok: false, error: "Couldn't save pi's models.json." },
					),
				);
				return;
			}
			if (frame.id && frame.method === "session.prompt" && frame.params?.text === "Try again.") {
				frames.push(frame);
				ws.send(JSON.stringify({ id: frame.id, ok: true, result: { ok: true } }));
				return;
			}
			server.send(message);
		});
		server.onMessage((message) => ws.send(message));
	});
}

function seedFallbackFailure(): { id: string } {
	return seedWorkspaceSession(realpathSync(E2E_FIXTURE_REPO), {
		name: "proxy fallback chat",
		messages: [
			{ role: "user", text: "finish the task", timestamp: BASE_TS },
			{
				role: "assistant",
				text: "",
				timestamp: BASE_TS + 1_000,
				stopReason: "error",
				errorMessage: "400 Anthropic proxy does not support fallback field",
			},
		],
	});
}

test("a proxy rejecting fallbacks offers one click that turns fallback off and retries", async ({
	page,
}) => {
	const frames: ClientFrame[] = [];
	await interceptFallbackRepair(page, frames, "ok");
	await openFixtureProject(page);
	const chat = seedFallbackFailure();

	await enterDefaultWorkspace(page);
	const failure = page
		.locator('[data-testid="chat-message"][data-role="error"]')
		.filter({ hasText: "does not support fallback field" });
	await expect(failure).toContainText("server-side fallback");
	await expect(failure.getByTestId("agent-try-again")).toHaveCount(0);

	await failure.getByTestId("agent-disable-fallback").click();

	await expect
		.poll(() => frames.map((frame) => frame.method))
		.toEqual(["session.disableServerFallback", "session.prompt"]);
	expect(frames[0]?.params).toEqual({ sessionId: chat.id });
	expect(frames[1]?.params).toEqual({ sessionId: chat.id, text: "Try again." });
	await expect(page.getByTestId("agent-disable-fallback")).toHaveCount(0);
	await expect(
		page
			.locator('[data-testid="chat-message"][data-role="user"]')
			.filter({ hasText: "Try again." }),
	).toHaveCount(1);
});

test("a failed fallback repair says so and keeps the button without retrying", async ({ page }) => {
	const frames: ClientFrame[] = [];
	await interceptFallbackRepair(page, frames, "fail");
	await openFixtureProject(page);
	seedFallbackFailure();

	await enterDefaultWorkspace(page);
	const failure = page
		.locator('[data-testid="chat-message"][data-role="error"]')
		.filter({ hasText: "does not support fallback field" });
	await failure.getByTestId("agent-disable-fallback").click();

	await expect(failure.getByRole("alert")).toHaveText(
		"Couldn't turn off fallback. Check pi's models.json, then try again.",
	);
	await expect(failure.getByTestId("agent-disable-fallback")).toBeEnabled();
	expect(frames.map((frame) => frame.method)).toEqual(["session.disableServerFallback"]);
});

test("a chat whose model already sends no fallbacks just retries", async ({ page }) => {
	const frames: ClientFrame[] = [];
	await interceptFallbackRepair(page, frames, "not-used");
	await openFixtureProject(page);
	const chat = seedFallbackFailure();

	await enterDefaultWorkspace(page);
	const failure = page
		.locator('[data-testid="chat-message"][data-role="error"]')
		.filter({ hasText: "does not support fallback field" });
	await failure.getByTestId("agent-disable-fallback").click();

	await expect
		.poll(() => frames.map((frame) => frame.method))
		.toEqual(["session.disableServerFallback", "session.prompt"]);
	expect(frames[1]?.params).toEqual({ sessionId: chat.id, text: "Try again." });
	await expect(failure.getByRole("alert")).toHaveCount(0);
});
