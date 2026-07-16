import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import { openFixtureProject } from "./fixtures/app";

// Tagged @agent (see agent.live.spec.ts): drives a REAL pi agent. Proves the error-handling headline — a
// kick-off that names a bad model surfaces a *visible* failure instead of looking like nothing happened
// (the "pick a bad model → nothing happens" bug). We rewrite the kick-off's `session.create` model id to a
// nonexistent tag *on the wire* (keeping provider/baseUrl real); the host re-resolves the ref against its
// model registry and rejects `session.create` before any session/chat exists — so the New-Workspace dialog
// has nowhere to host an in-chat error turn and surfaces the reason as an error *toast* instead. Rewriting
// the wire (not picking a model in the UI) is deliberate: `session.create({ model })` never calls
// `setModel`, so nothing persists — this can't corrupt the pinned default other @agent tests depend on.

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

test("a bad model surfaces a visible error toast, not a false ✓ Done", {
	tag: "@agent",
}, async ({ page }) => {
	await forceBadModelOnCreate(page);
	await openFixtureProject(page);

	// Kick off a workspace with a prompt: cuts a worktree and sends a turn — whose `session.create` carries
	// the rewritten bogus model.
	await page.getByTestId("add-workspace").first().click();
	const dialog = page.getByTestId("new-workspace-dialog");
	await expect(dialog).toBeVisible();
	// Wait for the default model to resolve into the picker; only then does `session.create` carry a
	// `model` for the wire rewrite to bite (an unresolved picker omits it → the real default → no error).
	await expect(dialog.getByTestId("model-selector")).not.toContainText("Select model");
	await page.getByTestId("ws-prompt").fill("Reply with the single word: pong");
	await page.getByTestId("create-workspace").click();
	await expect(dialog).toBeHidden();

	// The host rejects `session.create` (the bogus model isn't in its registry) before a session/chat
	// exists, so no chat tab opens — there's nowhere to host an in-chat error turn…
	const toast = page.locator('[data-testid="toast"][data-variant="error"]');
	// …instead the failure surfaces as a visible error toast — not swallowed, not a false "✓ Done".
	await expect(toast).toBeVisible({ timeout: 15_000 });
	await expect(toast).toContainText("Couldn't start the chat");
	// The toast carries the host's real reason (the rejected bogus model id), so it's the bad model's
	// failure surfacing — not an unrelated error nor an empty placeholder.
	await expect(toast).toContainText(BOGUS_MODEL_ID);
	await expect(page.locator('[data-testid="editor-tab"][data-kind="chat"]')).toHaveCount(0);
	await expect(
		page.locator('[data-testid="chat-message"][data-role="system"]').filter({ hasText: "Done" }),
	).toHaveCount(0);
});
