// Render each HTML mockup under .github/readme-assets/onboarding/mockups-src/*.html
// to a PNG next to it (named `proposed-<slug>.png` at the onboarding root).
//
// Usage: bun scripts/render-mockups.ts
import { readdirSync } from "node:fs";
import { basename, join } from "node:path";
import { chromium } from "../node_modules/.bun/playwright@1.61.0/node_modules/playwright/index.mjs";

const SRC = join(process.cwd(), ".github/readme-assets/onboarding/mockups-src");
const OUT = join(process.cwd(), ".github/readme-assets/onboarding");

const files = readdirSync(SRC).filter((f) => f.endsWith(".html"));

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
	viewport: { width: 1280, height: 800 },
	deviceScaleFactor: 2,
	colorScheme: "dark",
});
const page = await context.newPage();

for (const f of files) {
	const url = `file://${join(SRC, f)}`;
	const outName = `proposed-${basename(f, ".html")}.png`;
	const outPath = join(OUT, outName);
	await page.goto(url, { waitUntil: "networkidle", timeout: 10_000 });
	await page.waitForTimeout(300);
	await page.screenshot({ path: outPath, fullPage: false });
	console.log(`✓ ${f} → ${outPath}`);
}

await browser.close();
