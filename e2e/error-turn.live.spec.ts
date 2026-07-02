import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import { openFixtureProject } from "./fixtures/app";

// Tagged @agent (see agent.live.spec.ts): drives a REAL pi agent. Proves the error-handling headline — a
// turn that hits a bad model surfaces a *visible* error turn in the chat instead of looking like nothing
// happened (the "pick a bad model → nothing happens" bug). The failure is genuinely the provider's: we
// rewrite the kick-off's `session.create` model id to a nonexistent tag *on the wire*, so pi's real
// provider 404s and reports a terminal `agent_end` error — the exact event the chat renders as an error
// turn. Rewriting the wire (not picking a model in the UI) is deliberate: `session.create({ model })`
// never calls `setModel`, so nothing persists — this can't corrupt the pinned default other @agent tests
// depend on.

const BOGUS_MODEL_ID = "definitely-not-a-real-model-9x";

/** A `session.create` frame — the only one we rewrite; everything else is relayed untouched. */
interface WireFrame {
	method?: string;
	params?: { model?: Record<string, unknown> };
}

/**
 * Intercept the host WebSocket and rewrite the model id of any `session.create` request to a nonexistent
 * tag, keeping the rest of the model (provider/baseUrl/…) real so it still routes to the real provider —
 * which then 404s the tag. Every other frame, both directions, is relayed verbatim.
 */
async function forceBadModelOnCreate(page: Page): Promise<void> {
	await page.routeWebSocket("**/ws", (ws) => {
		const server = ws.connectToServer();
		ws.onMessage((message) => {
			const raw = typeof message === "string" ? message : message.toString();
			let frame: WireFrame;
			try {
				frame = JSON.parse(raw) as WireFrame;
			} catch {
				server.send(message);
				return;
			}
			if (frame.method === "session.create" && frame.params?.model) {
				frame.params.model = { ...frame.params.model, id: BOGUS_MODEL_ID, name: "Bogus 9x" };
				server.send(JSON.stringify(frame));
				return;
			}
			server.send(message);
		});
		server.onMessage((message) => ws.send(message));
	});
}

test("a bad model surfaces a visible error turn, not a false ✓ Done", {
	tag: "@agent",
}, async ({ page }) => {
	test.setTimeout(90_000); // a real provider round-trip (even a 404) can outlast the 30s default
	await forceBadModelOnCreate(page);
	await openFixtureProject(page);

	// Kick off a workspace with a prompt: cuts a worktree, opens a chat, and sends the turn — whose session
	// was created with the rewritten bogus model.
	await page.getByTestId("add-workspace").first().click();
	const dialog = page.getByTestId("new-workspace-dialog");
	await expect(dialog).toBeVisible();
	// Wait for the default model to resolve into the picker; only then does `session.create` carry a
	// `model` for the wire rewrite to bite (an unresolved picker omits it → the real default → no error).
	await expect(dialog.getByTestId("model-selector")).not.toContainText("Select model");
	await page.getByTestId("ws-prompt").fill("Reply with the single word: pong");
	await page.getByTestId("create-workspace").click();
	await expect(dialog).toBeHidden();

	// A chat opened for the new workspace…
	await expect(page.locator('[data-testid="editor-tab"][data-kind="chat"]')).toHaveCount(1);

	// …and the bad model's failure is shown as an error turn — not swallowed, not a false "✓ Done".
	const errorTurn = page.locator('[data-testid="chat-message"][data-role="error"]');
	await expect(errorTurn).toBeVisible({ timeout: 60_000 });
	// The turn carries the provider's real message (a model-not-found 404), so it's the bad model's
	// failure surfacing — not an unrelated error nor an empty placeholder.
	await expect(errorTurn).toContainText(/not found|404/i);
	await expect(
		page.locator('[data-testid="chat-message"][data-role="system"]').filter({ hasText: "Done" }),
	).toHaveCount(0);
});
