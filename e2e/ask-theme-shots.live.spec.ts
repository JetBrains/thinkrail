import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { openWorkspaceChat } from "./fixtures/app";

const STAGE = process.env.ASK_SHOTS_STAGE ?? "before";
const OUT = join(process.cwd(), ".thinkrail", "context", "ask-shots", STAGE);
const THEMES = ["dark", "light", "high-contrast-dark", "high-contrast-light"] as const;

async function pickTheme(page: Page, theme: string): Promise<void> {
	await page.getByTestId("open-settings").click();
	const dialog = page.getByTestId("settings-dialog");
	await expect(dialog).toBeVisible();
	await page.getByTestId("settings-nav-appearance").click();
	await dialog.locator(`[data-theme-id="${theme}"]`).click();
	await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
	await page.keyboard.press("Escape");
	await expect(dialog).toBeHidden();
}

async function shootCard(page: Page, name: string): Promise<void> {
	const card = page.locator('[data-testid="ask-user-question"][data-tone="active"]').first();
	const box = await card.boundingBox();
	if (!box) throw new Error("card has no bounding box");
	const pad = 28;
	await page.screenshot({
		path: join(OUT, `${name}.png`),
		clip: {
			x: Math.max(0, box.x - pad),
			y: Math.max(0, box.y - pad),
			width: box.width + pad * 2,
			height: box.height + pad * 2,
		},
	});
}

test("ask-user-question card screenshots across themes", { tag: "@agent" }, async ({ page }) => {
	test.setTimeout(420_000);
	mkdirSync(OUT, { recursive: true });
	await openWorkspaceChat(page);
	await page
		.getByTestId("chat-input")
		.fill(
			[
				"Call the ask_user_question tool with EXACTLY TWO questions.",
				'Question 1: header "Auth method", question "Which auth method should we use?", multiSelect false, options: "JWT tokens (Recommended)" with description "Stateless, works offline" and recommendedReason "Best fit for the mobile client", "Session cookies" with description "Server-side sessions", "OAuth only" with description "Delegate to a provider". No previews.',
				'Question 2: header "Platforms", question "Which platforms do we target?", multiSelect true, options: "Desktop" with description "Electron shell", "Mobile web" with description "PWA", "Native iOS" with description "Swift app". No previews.',
				"Call no other tool, and do nothing else besides asking. After I answer, reply with one short sentence.",
			].join(" "),
		);
	await page.getByTestId("chat-send").click();

	const card = page.locator('[data-testid="ask-user-question"][data-tone="active"]').first();
	await expect(card).toBeVisible({ timeout: 120_000 });
	await expect(card.getByTestId("ask-option")).toHaveCount(3);

	await card.getByTestId("ask-option").nth(0).click();

	for (const theme of THEMES) {
		await pickTheme(page, theme);
		await page.waitForTimeout(400);
		await shootCard(page, theme);
	}
});
