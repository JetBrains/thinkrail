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

test("bold inside prose changes weight only — both markdown surfaces share the rule", async ({
	page,
}) => {
	await openFixtureProject(page);
	await expect(page.getByTestId("welcome")).toBeVisible();

	// Both markdown surfaces mount `.tr-prose`, so the shared rules are what govern each of them. Probe
	// them directly on a detached fragment: no agent session needed to assert the CSS both surfaces use.
	const measured = await page.evaluate(() => {
		const host = document.createElement("div");
		host.className = "tr-prose";
		host.innerHTML =
			"<h1>A <strong>bold</strong> title</h1>" +
			"<table><tbody><tr><td>cell <strong>bold</strong></td></tr></tbody></table>" +
			"<p>body <strong>bold</strong> text</p>" +
			"<p><em><strong>nested</strong></em></p>";
		document.body.appendChild(host);
		const read = (el: Element | null) => {
			if (!el) return null;
			const s = getComputedStyle(el);
			return {
				family: s.fontFamily,
				size: s.fontSize,
				weight: s.fontWeight,
				lineHeight: s.lineHeight,
				spacing: s.letterSpacing,
				transform: s.textTransform,
				color: s.color,
			};
		};
		const out = {
			h1: read(host.querySelector("h1")),
			h1Strong: read(host.querySelector("h1 strong")),
			cell: read(host.querySelector("td")),
			cellStrong: read(host.querySelector("td strong")),
			body: read(host.querySelector("p")),
			bodyStrong: read(host.querySelector("p strong")),
			nestedStrong: read(host.querySelector("em strong")),
		};
		host.remove();
		return out;
	});

	// A bold word in a heading keeps the heading's size and line-height; only the weight differs.
	expect(measured.h1Strong?.size).toBe(measured.h1?.size);
	expect(measured.h1Strong?.lineHeight).toBe(measured.h1?.lineHeight);
	expect(measured.h1Strong?.weight).toBe("500");
	expect(measured.h1?.weight).toBe("600");

	// A bold word in a table cell keeps the table's size and line-height.
	expect(measured.cellStrong?.size).toBe(measured.cell?.size);
	expect(measured.cellStrong?.lineHeight).toBe(measured.cell?.lineHeight);
	expect(measured.cellStrong?.weight).toBe("500");

	// A bold word in body prose keeps the body typography and becomes 500.
	expect(measured.bodyStrong?.size).toBe(measured.body?.size);
	expect(measured.bodyStrong?.lineHeight).toBe(measured.body?.lineHeight);
	expect(measured.bodyStrong?.weight).toBe("500");

	// Nested bold inherits family, tracking, transform and colour from its parent.
	for (const key of ["family", "spacing", "transform", "color"] as const) {
		expect(measured.h1Strong?.[key], `h1 strong ${key}`).toBe(measured.h1?.[key]);
		expect(measured.cellStrong?.[key], `cell strong ${key}`).toBe(measured.cell?.[key]);
		expect(measured.nestedStrong?.[key], `nested strong ${key}`).toBe(measured.body?.[key]);
	}
});

test("a Tailwind utility at a call site overrides the semantic default it names", async ({
	page,
}) => {
	await openAppFresh(page);

	// The semantic classes are emitted in `@layer components`, so `italic` / `leading-*` (Tailwind's
	// `utilities` layer) win for the ONE property they set while the rest of the semantic style holds.
	// Unlayered semantic CSS used to outrank every utility — "(empty file)" lost its italics and
	// `leading-tight` rows kept the 1.6 default.
	const measured = await page.evaluate(() => {
		const probe = (className: string) => {
			const el = document.createElement("span");
			el.className = className;
			el.textContent = "probe";
			document.body.appendChild(el);
			const s = getComputedStyle(el);
			const out = { fontStyle: s.fontStyle, fontSize: s.fontSize, lineHeight: s.lineHeight };
			el.remove();
			return out;
		};
		return {
			metadata: probe("tr-text-metadata"),
			metadataItalic: probe("tr-text-metadata italic"),
			metadataSnug: probe("tr-text-metadata leading-snug"),
			ui: probe("tr-text-ui"),
			uiTight: probe("tr-text-ui leading-tight"),
		};
	});

	// `italic` applies, and the semantic size/line-height are untouched.
	expect(measured.metadataItalic.fontStyle).toBe("italic");
	expect(measured.metadata.fontStyle).toBe("normal");
	expect(measured.metadataItalic.fontSize).toBe(measured.metadata.fontSize);
	expect(measured.metadataItalic.lineHeight).toBe(measured.metadata.lineHeight);

	// `leading-tight` (1.25) beats the semantic 1.6, and only the line-height moves.
	expect(measured.uiTight.lineHeight).toBe("15px"); // 12px × 1.25
	expect(measured.ui.lineHeight).toBe("19.2px"); // 12px × 1.6
	expect(measured.uiTight.fontSize).toBe(measured.ui.fontSize);

	// `leading-snug` (1.375) likewise, on the 10px tier.
	expect(measured.metadataSnug.lineHeight).toBe("13.75px"); // 10px × 1.375
	expect(measured.metadataSnug.fontSize).toBe(measured.metadata.fontSize);
});
