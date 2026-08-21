import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { openWorkspaceChat } from "./fixtures/app";

const STAGE = process.env.ASK_SHOTS_STAGE ?? "before";
const OUT = join(process.env.ASK_SHOTS_OUT ?? process.cwd(), ".ask-shots", STAGE);
const THEMES = (
	process.env.ASK_SHOTS_THEMES ?? "dark,light,high-contrast-dark,high-contrast-light"
).split(",");

test.use({ viewport: { width: 1280, height: 1200 } });

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

async function shoot(page: Page, target: ReturnType<Page["locator"]>, name: string) {
	await target.scrollIntoViewIfNeeded();
	await page.waitForTimeout(200);
	const box = await target.boundingBox();
	if (!box) throw new Error(`no bounding box for ${name}`);
	const pad = 24;
	const viewport = page.viewportSize();
	if (!viewport) throw new Error("no viewport");
	const x = Math.max(0, box.x - pad);
	const y = Math.max(0, box.y - pad);
	await page.screenshot({
		path: join(OUT, `${name}.png`),
		clip: {
			x,
			y,
			width: Math.min(box.width + pad * 2, viewport.width - x),
			height: Math.min(box.height + pad * 2, viewport.height - y),
		},
	});
}

test("ask-user-question card screenshots across themes", { tag: "@agent" }, async ({ page }) => {
	test.setTimeout(600_000);
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

	const tabs = card.getByTestId("ask-tab");
	const options = card.getByTestId("ask-option");
	const selectedOption = card.locator('[data-testid="ask-option"][data-selected="true"]');

	for (const theme of THEMES) {
		await pickTheme(page, theme);

		await tabs.nth(0).click();
		await expect(card.getByTestId("ask-option")).toHaveCount(3);
		if ((await selectedOption.count()) === 0) await options.nth(0).click();
		await shoot(page, card, `${theme}-q1`);

		await options.nth(0).click();
		await page.keyboard.press("ArrowDown");
		await expect(options.nth(1)).toBeFocused();
		await shoot(page, card, `${theme}-q1-kbcursor`);

		await page.keyboard.press("End");
		await expect(card.getByTestId("ask-custom")).toBeFocused();
		await shoot(page, card, `${theme}-q1-other`);

		await card.getByTestId("ask-note-toggle").click();
		await expect(card.getByTestId("ask-note")).toBeFocused();
		await shoot(page, card, `${theme}-q1-note`);
		await page.keyboard.press("Escape");

		await tabs.nth(1).click();
		await expect(card.getByTestId("ask-option")).toHaveCount(3);
		if ((await selectedOption.count()) === 0) await options.nth(1).click();
		await shoot(page, card, `${theme}-q2-multi`);

		await tabs.nth(2).click();
		await expect(card.getByTestId("ask-review-title")).toBeVisible();
		await shoot(page, card, `${theme}-review`);
	}

	await card.getByTestId("ask-submit").click();
	const record = page.locator('[data-testid="ask-user-question"][data-tone="answered"]').first();
	await expect(record).toBeVisible({ timeout: 60_000 });
	for (const theme of THEMES) {
		await pickTheme(page, theme);
		await shoot(page, record, `${theme}-answered`);
	}
});
