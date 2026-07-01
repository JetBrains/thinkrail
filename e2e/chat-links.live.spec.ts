import { expect, test } from "@playwright/test";
import { openWorkspaceChat } from "./fixtures/app";

// Tagged @agent (see agent.live.spec.ts): a markdown link only renders from REAL assistant output, so we
// drive a real pi agent to emit one exact link, then prove our `Markdown` anchor renderer opens it in a
// new tab (target=_blank + rel=noopener) instead of navigating away from the app.
test("markdown links in an assistant reply open in a new tab", { tag: "@agent" }, async ({
	page,
}) => {
	test.setTimeout(90_000); // real provider latency varies — don't fail on a slow turn

	await openWorkspaceChat(page);

	const url = "https://example.com/thinkrail-link-test";
	await page
		.getByTestId("chat-input")
		.fill(`Reply with exactly this markdown and nothing else: [Example](${url})`);
	await page.getByTestId("chat-send").click();

	// Scope to the rendered anchor inside the assistant message (not the composer echo).
	const link = page
		.locator('[data-testid="chat-message"][data-role="assistant"]')
		.locator(`a[href="${url}"]`)
		.first();
	await expect(link).toBeVisible({ timeout: 60_000 });

	// The whole point: new tab, with the safe rel for target=_blank.
	await expect(link).toHaveAttribute("target", "_blank");
	await expect(link).toHaveAttribute("rel", /noopener/);
});
