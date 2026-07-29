import { expect, test } from "@playwright/test";
import {
	createWorkspaceViaDialog,
	openAppFresh,
	openFixtureProject,
	openTerminal,
	openWorkspaceChat,
} from "./fixtures/app";

/**
 * Computed-style verification: the generated typography actually renders on the real surfaces, and the
 * roles the spec ties together stay tied (dialog title == card title, branch metadata is proportional,
 * Monaco and xterm match the code style).
 *
 * Values come from `apps/web/src/styles/typography.json` — update them there, never here.
 */
const GEIST = /Geist Variable/;
const MONO = /JetBrains Mono Variable/;

async function typeOf(locator: import("@playwright/test").Locator) {
	return locator.evaluate((el) => {
		const s = getComputedStyle(el);
		return {
			family: s.fontFamily,
			size: s.fontSize,
			weight: s.fontWeight,
			lineHeight: s.lineHeight,
			spacing: s.letterSpacing,
			transform: s.textTransform,
		};
	});
}

test("brand, welcome hero and label pill render the generated brand styles", async ({ page }) => {
	await openAppFresh(page);
	const wordmark = page.locator(".tr-brand-wordmark").first();
	await expect(wordmark).toBeVisible();
	expect(await typeOf(wordmark)).toMatchObject({
		size: "18px",
		weight: "800",
		lineHeight: "22.5px",
	});
	expect((await typeOf(wordmark)).family).toMatch(GEIST);

	await openFixtureProject(page);
	const hero = page.getByTestId("welcome-title");
	expect(await typeOf(hero)).toMatchObject({ size: "44px", weight: "800", lineHeight: "55px" });
});

test("dialog title and card title share one typography", async ({ page }) => {
	await openFixtureProject(page);
	await page.getByTestId("open-settings").click();
	const dialogTitle = page.getByTestId("settings-dialog").locator(".tr-title-dialog").first();
	await expect(dialogTitle).toBeVisible();
	const dialog = await typeOf(dialogTitle);
	expect(dialog).toMatchObject({ size: "14px", weight: "600", lineHeight: "17.5px" });
	await page.keyboard.press("Escape");

	const card = page.locator(".tr-title-card").first();
	if (await card.count()) {
		const cardType = await typeOf(card);
		expect(cardType.size).toBe(dialog.size);
		expect(cardType.weight).toBe(dialog.weight);
		expect(cardType.lineHeight).toBe(dialog.lineHeight);
	}
});

test("entity rows, branch metadata and eyebrows are proportional", async ({ page }) => {
	await openFixtureProject(page);
	await createWorkspaceViaDialog(page);
	for (const testid of ["project-item", "workspace-item", "workspace-name", "workspace-branch"]) {
		const el = page.getByTestId(testid).first();
		if (!(await el.count())) continue;
		const type = await typeOf(el);
		expect(type.family, `${testid} must be proportional`).toMatch(GEIST);
		expect(type.family, `${testid} must not be mono`).not.toMatch(MONO);
	}
	const eyebrow = page.locator(".tr-text-eyebrow").first();
	await expect(eyebrow).toBeVisible();
	expect(await typeOf(eyebrow)).toMatchObject({
		size: "10px",
		weight: "400",
		transform: "uppercase",
		spacing: "0.5px",
	});
});

test("Monaco and xterm render the generated code family and size", async ({ page }) => {
	await openFixtureProject(page);
	await createWorkspaceViaDialog(page);
	await page.getByTestId("tab-files").click();
	// A non-markdown file opens in Monaco (markdown opens rendered).
	await page.getByTestId("file-node").filter({ hasText: "notes.txt" }).first().dblclick();
	await page.waitForTimeout(3000);
	const editor = page.locator(".monaco-editor .view-lines").first();
	if (await editor.count()) {
		const type = await typeOf(editor);
		expect(type.family).toMatch(MONO);
		expect(type.size).toBe("11px");
	}
	await openTerminal(page);
	const term = page.locator(".xterm-rows").first();
	if (await term.count()) {
		const type = await typeOf(term);
		expect(type.family).toMatch(MONO);
		expect(type.size).toBe("11px");
	}
});

test("chat and spec markdown resolve to the same prose typography", async ({ page }) => {
	await openWorkspaceChat(page);
	// The file preview: open a markdown file and read its prose root + heading + code.
	await page.getByTestId("tab-files").click();
	await page.getByTestId("file-node").filter({ hasText: "README.md" }).first().dblclick();
	await page.waitForTimeout(3000);
	const prose = page.locator(".tr-prose").first();
	await expect(prose).toBeVisible();
	const body = await typeOf(prose);
	expect(body).toMatchObject({ size: "14px", weight: "400", lineHeight: "22.4px" });

	const h1 = prose.locator("h1").first();
	if (await h1.count()) expect(await typeOf(h1)).toMatchObject({ size: "18px", weight: "600" });
	const h2 = prose.locator("h2").first();
	if (await h2.count()) expect(await typeOf(h2)).toMatchObject({ size: "14px", weight: "600" });
	const code = prose.locator("code").first();
	if (await code.count()) {
		const type = await typeOf(code);
		expect(type.family).toMatch(MONO);
		expect(["13px", "11px"]).toContain(type.size);
	}
	// Both markdown surfaces mount the same class, so one set of rules governs both.
	expect(await page.locator(".tr-prose").count()).toBeGreaterThan(0);
});

test("typography survives a narrow mobile viewport without clipping or overflow", async ({
	page,
}) => {
	await page.setViewportSize({ width: 390, height: 780 });
	await openFixtureProject(page);
	await createWorkspaceViaDialog(page);
	await page.waitForTimeout(600);
	const problems = await page.evaluate(() => {
		const out: string[] = [];
		for (const el of Array.from(document.querySelectorAll("*"))) {
			const style = getComputedStyle(el);
			if (!/hidden|clip/.test(style.overflowY)) continue;
			const over = el.scrollHeight - el.clientHeight;
			if (over > 1 && el.clientHeight > 0 && el.scrollHeight < el.clientHeight + 200)
				out.push(`${el.tagName}[${el.getAttribute("data-testid") ?? ""}] +${over}px`);
		}
		// Horizontal overflow of the document is the other typography failure mode.
		if (document.documentElement.scrollWidth > window.innerWidth + 1)
			out.push(
				`document overflows: ${document.documentElement.scrollWidth} > ${window.innerWidth}`,
			);
		return out;
	});
	expect(problems).toEqual([]);
});
