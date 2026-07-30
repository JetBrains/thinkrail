import { expect, test } from "@playwright/test";
import {
	createWorkspaceViaDialog,
	openAppFresh,
	openFixtureProject,
	openWorkspaceChat,
	visibleTerminalScreen,
	waitTerminalReady,
} from "./fixtures/app";

/**
 * Computed-style verification: the generated typography actually renders on the real surfaces, and the
 * roles the spec ties together stay tied (dialog title == card title, branch metadata is proportional,
 * Monaco and xterm match the code style, the document markdown scale outranks its own body copy).
 *
 * Every assertion here is UNCONDITIONAL on purpose. An earlier version wrapped each measurement in
 * `if (await locator.count())`, which meant a renamed selector or a surface that failed to mount turned
 * the whole spec into a silent no-op — green while measuring nothing. If an element this spec names
 * stops existing, that is the failure, not a reason to skip.
 *
 * Values come from `apps/web/src/styles/typography.json` — update them there, never here.
 */
const GEIST = /Geist Variable/;
const MONO = /JetBrains Mono Variable/;

type TypeInfo = {
	family: string;
	size: string;
	weight: string;
	lineHeight: string;
	spacing: string;
	transform: string;
};

async function typeOf(locator: import("@playwright/test").Locator): Promise<TypeInfo> {
	await expect(locator).toBeVisible();
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
	const wordmark = await typeOf(page.locator(".tr-brand-wordmark").first());
	expect(wordmark).toMatchObject({ size: "18px", weight: "800", lineHeight: "22.5px" });
	expect(wordmark.family).toMatch(GEIST);

	await openFixtureProject(page);
	expect(await typeOf(page.getByTestId("welcome-title"))).toMatchObject({
		size: "44px",
		weight: "800",
		lineHeight: "55px",
	});
});

test("dialog title and card title share one typography", async ({ page }) => {
	await openFixtureProject(page);

	// The Welcome fork cards are the `title.card` surface; assert it before opening the dialog so both
	// halves of the pair are measured in the same run.
	const card = await typeOf(page.locator(".tr-title-card").first());

	await page.getByTestId("open-settings").click();
	const dialog = await typeOf(
		page.getByTestId("settings-dialog").locator(".tr-title-dialog").first(),
	);
	expect(dialog).toMatchObject({ size: "14px", weight: "600", lineHeight: "17.5px" });

	// `title.card` is a `$ref` to `title.dialog`, so the two must be indistinguishable.
	expect(card.size).toBe(dialog.size);
	expect(card.weight).toBe(dialog.weight);
	expect(card.lineHeight).toBe(dialog.lineHeight);
	expect(card.family).toBe(dialog.family);
});

test("entity rows, branch metadata and eyebrows are proportional", async ({ page }) => {
	await openFixtureProject(page);
	await createWorkspaceViaDialog(page);
	for (const testid of ["project-item", "workspace-item", "workspace-name", "workspace-branch"]) {
		const type = await typeOf(page.getByTestId(testid).first());
		expect(type.family, `${testid} must be proportional`).toMatch(GEIST);
		expect(type.family, `${testid} must not be mono`).not.toMatch(MONO);
	}
	expect(await typeOf(page.locator(".tr-text-eyebrow").first())).toMatchObject({
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
	const editor = page.locator(".monaco-editor .view-lines").first();
	await expect(editor).toBeVisible({ timeout: 30_000 });
	const editorType = await typeOf(editor);
	expect(editorType.family).toMatch(MONO);
	expect(editorType.size).toBe("11px");

	// A terminal opens with the workspace. Measure the VISIBLE instance: several stay mounted at once
	// and only one is `data-visible="true"`, so a bare `.xterm-rows` locator resolves to a hidden layer
	// with no box — which is what let the old `if (await count())` version skip xterm entirely.
	await waitTerminalReady(page);
	const termType = await typeOf(visibleTerminalScreen(page));
	expect(termType.family).toMatch(MONO);
	expect(termType.size).toBe("11px");
});

test("the chat and document markdown surfaces each wear their own prose system", async ({
	page,
}) => {
	await openWorkspaceChat(page);
	await page.getByTestId("tab-files").click();
	await page.getByTestId("file-node").filter({ hasText: "README.md" }).first().dblclick();
	await expect(page.getByTestId("markdown-preview")).toContainText("sample-project");

	// The document surface: `tr-prose-doc`, body copy at the reading size, h1 at the document scale —
	// 24px, which is the whole point of a separate system (the chat h1 is 18px).
	const doc = page.locator(".tr-prose-doc").first();
	expect(await typeOf(doc)).toMatchObject({ size: "14px", weight: "400", lineHeight: "22.4px" });
	expect(await typeOf(doc.locator("h1").first())).toMatchObject({ size: "24px", weight: "600" });

	// One system per surface: the rendered file must not also carry the bubble scale, or which of the two
	// wins comes down to emission order inside `@layer components`.
	expect(await doc.evaluate((el) => el.classList.contains("tr-prose-chat"))).toBe(false);
	expect(await page.locator(".tr-prose-doc.tr-prose-chat").count()).toBe(0);
});

/**
 * The reason the `doc` system exists: a rendered document has to read as one. Probed on a detached
 * fragment so the assertion covers the CSS itself rather than whatever headings a fixture happens to
 * contain — every level is measured, not just the ones a README uses.
 */
test("document headings are larger than document body text", async ({ page }) => {
	await openFixtureProject(page);
	await expect(page.getByTestId("welcome")).toBeVisible();

	const measured = await page.evaluate(() => {
		const host = document.createElement("div");
		host.className = "tr-prose-doc";
		host.innerHTML =
			"<h1>h1</h1><h2>h2</h2><h3>h3</h3><h4>h4</h4><h5>h5</h5><h6>h6</h6>" +
			"<p>body</p><pre><code>code</code></pre><p><code>inline</code></p>";
		document.body.appendChild(host);
		const size = (sel: string) =>
			Number.parseFloat(getComputedStyle(host.querySelector(sel) as Element).fontSize);
		const weight = (sel: string) => getComputedStyle(host.querySelector(sel) as Element).fontWeight;
		const out = {
			body: size("p"),
			h: [1, 2, 3, 4, 5, 6].map((n) => size(`h${n}`)),
			hWeight: [1, 2, 3, 4, 5, 6].map((n) => weight(`h${n}`)),
			pre: size("pre"),
			inline: size(":not(pre) > code"),
		};
		host.remove();
		return out;
	});

	expect(measured.body).toBe(14);
	expect(measured.h).toEqual([24, 20, 18, 16, 14, 12]);
	// h1–h4 strictly larger than body copy — the hierarchy the chat scale cannot give a document.
	for (const [i, size] of measured.h.slice(0, 4).entries())
		expect(size, `h${i + 1} > body`).toBeGreaterThan(measured.body);
	// The ladder never inverts, and every level is a heading weight.
	for (let i = 1; i < measured.h.length; i++)
		expect(measured.h[i], `h${i + 1} <= h${i}`).toBeLessThanOrEqual(measured.h[i - 1] as number);
	for (const [i, w] of measured.hWeight.entries())
		expect(Number(w), `h${i + 1} weight`).toBeGreaterThanOrEqual(600);
	// Document code tracks document body copy, not the compact chat sizes.
	expect(measured.pre).toBe(13);
	expect(measured.inline).toBe(13);
});

test("the chat prose system stays compact", async ({ page }) => {
	await openFixtureProject(page);
	await expect(page.getByTestId("welcome")).toBeVisible();

	const measured = await page.evaluate(() => {
		const host = document.createElement("div");
		host.className = "tr-prose-chat";
		host.innerHTML = "<h1>h1</h1><h2>h2</h2><h3>h3</h3><p>body</p><pre><code>code</code></pre>";
		document.body.appendChild(host);
		const size = (sel: string) =>
			Number.parseFloat(getComputedStyle(host.querySelector(sel) as Element).fontSize);
		const out = {
			body: size("p"),
			h1: size("h1"),
			h2: size("h2"),
			h3: size("h3"),
			pre: size("pre"),
		};
		host.remove();
		return out;
	});

	expect(measured).toEqual({ body: 14, h1: 18, h2: 14, h3: 12, pre: 11 });
});

test("typography survives a narrow mobile viewport without clipping or overflow", async ({
	page,
}) => {
	await page.setViewportSize({ width: 390, height: 780 });
	await openFixtureProject(page);
	await createWorkspaceViaDialog(page);
	await expect(page.getByTestId("center-tabs")).toBeVisible();
	const problems = await page.evaluate(() => {
		const out: string[] = [];
		for (const el of Array.from(document.querySelectorAll("*"))) {
			const style = getComputedStyle(el);
			if (!/hidden|clip/.test(style.overflowY)) continue;
			const over = el.scrollHeight - el.clientHeight;
			// Any hidden vertical overflow is a clipped line. No upper bound: a badly broken layout
			// overflowing by 300px used to slip past the old `< clientHeight + 200` guard.
			if (over > 1 && el.clientHeight > 0)
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

test("bold inside prose changes weight only — in both prose systems", async ({ page }) => {
	await openFixtureProject(page);
	await expect(page.getByTestId("welcome")).toBeVisible();

	// Each markdown surface mounts its own `tr-prose-*` root, so the shared rules are what govern them.
	// Probe both directly on a detached fragment: no agent session needed to assert the CSS they use.
	const measured = await page.evaluate(() => {
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
		const probe = (root: string) => {
			const host = document.createElement("div");
			host.className = root;
			host.innerHTML =
				"<h1>A <strong>bold</strong> title</h1>" +
				"<table><tbody><tr><td>cell <strong>bold</strong></td></tr></tbody></table>" +
				"<p>body <strong>bold</strong> text</p>" +
				"<p><em><strong>nested</strong></em></p>";
			document.body.appendChild(host);
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
		};
		return { chat: probe("tr-prose-chat"), doc: probe("tr-prose-doc") };
	});

	for (const [system, m] of Object.entries(measured)) {
		// A bold word in a heading keeps the heading's size and line-height; only the weight differs.
		expect(m.h1Strong?.size, `${system} h1 strong size`).toBe(m.h1?.size);
		expect(m.h1Strong?.lineHeight, `${system} h1 strong leading`).toBe(m.h1?.lineHeight);
		expect(m.h1Strong?.weight, `${system} h1 strong weight`).toBe("500");
		expect(m.h1?.weight, `${system} h1 weight`).toBe("600");

		// A bold word in a table cell keeps the table's size and line-height.
		expect(m.cellStrong?.size, `${system} cell strong size`).toBe(m.cell?.size);
		expect(m.cellStrong?.lineHeight, `${system} cell strong leading`).toBe(m.cell?.lineHeight);
		expect(m.cellStrong?.weight, `${system} cell strong weight`).toBe("500");

		// A bold word in body prose keeps the body typography and becomes 500.
		expect(m.bodyStrong?.size, `${system} body strong size`).toBe(m.body?.size);
		expect(m.bodyStrong?.lineHeight, `${system} body strong leading`).toBe(m.body?.lineHeight);
		expect(m.bodyStrong?.weight, `${system} body strong weight`).toBe("500");

		// Nested bold inherits family, tracking, transform and colour from its parent.
		for (const key of ["family", "spacing", "transform", "color"] as const) {
			expect(m.h1Strong?.[key], `${system} h1 strong ${key}`).toBe(m.h1?.[key]);
			expect(m.cellStrong?.[key], `${system} cell strong ${key}`).toBe(m.cell?.[key]);
			expect(m.nestedStrong?.[key], `${system} nested strong ${key}`).toBe(m.body?.[key]);
		}
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
			// The `<body>` base lives in `@layer base`, so ANY semantic class must outrank it.
			bare: probe(""),
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

	// The document base is `rootStyle` → `ui.default` (12px), and a class beats it rather than tying.
	expect(measured.bare.fontSize).toBe("12px");
	expect(measured.metadata.fontSize).toBe("10px");
});
