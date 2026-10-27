// Capture the TRUE first-run experience by driving a FRESH ThinkRail instance
// launched with isolated HOME / data dirs on a non-default port.
// Prerequisite: start the fresh instance in a side shell:
//
//   rm -rf /tmp/tr-fresh && mkdir -p /tmp/tr-fresh/home /tmp/tr-fresh/data
//   HOME=/tmp/tr-fresh/home \
//     THINKRAIL_DATA_DIR=/tmp/tr-fresh/data \
//     THINKRAIL_PORT=28242 \
//     bun run dev
//
// Then:  bun scripts/capture-fresh-shots.ts
// Output: .github/readme-assets/onboarding/fresh-*.png

import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "../node_modules/.bun/playwright@1.61.0/node_modules/playwright/index.mjs";

const WEB_URL = process.env.THINKRAIL_FRESH_URL ?? "http://localhost:24271";
const OUT_DIR = join(process.cwd(), ".github/readme-assets/onboarding");

mkdirSync(OUT_DIR, { recursive: true });

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
	viewport: { width: 1280, height: 800 },
	deviceScaleFactor: 2,
	colorScheme: "dark",
});
const page = await context.newPage();

async function shot(name: string, label: string) {
	const file = join(OUT_DIR, `fresh-${name}.png`);
	await page.screenshot({ path: file, fullPage: false });
	console.log(`✓ ${label} → ${file}`);
}

try {
	await page.goto(WEB_URL, { waitUntil: "networkidle", timeout: 20_000 });
	await page.waitForTimeout(1500);
	await shot("01-first-launch", "01 First launch (no projects, no provider)");

	// If the "Connect a provider" banner is visible — click it.
	const connect = page.getByTestId("welcome-connect-provider");
	if (await connect.isVisible().catch(() => false)) {
		await shot("01b-with-banner-focus", "01b banner is visible");
		await connect.click();
		await page.waitForTimeout(900);
		await shot("02-settings-providers", "02 Settings → Providers (opened from banner)");

		// Click any provider's Connect / Sign in to trigger LoginDialog.
		const anyAction = page.getByRole("button", { name: /^(connect|sign in|api key)$/i }).first();
		if (await anyAction.isVisible().catch(() => false)) {
			await anyAction.click();
			await page.waitForTimeout(2500);
			await shot("03-login-dialog", "03 LoginDialog (modal on top of Settings)");
			const cancel = page.getByTestId("login-cancel").first();
			if (await cancel.isVisible().catch(() => false)) await cancel.click();
			await page.waitForTimeout(400);
		}
		await page.keyboard.press("Escape");
		await page.waitForTimeout(500);
	}

	// Welcome again after dismissing modals — shows the "Open project" CTA.
	await shot("04-welcome-again", "04 Welcome (what the user is left with)");

	// Click "Open project" to see the add-project menu.
	const openCta = page.getByTestId("welcome-cta").first();
	if (await openCta.isVisible().catch(() => false)) {
		await openCta.click();
		await page.waitForTimeout(600);
		await shot("05-open-project-menu", "05 Add project menu");
	}
} finally {
	await browser.close();
}
